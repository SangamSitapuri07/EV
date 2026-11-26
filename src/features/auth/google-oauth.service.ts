import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ensureDatabaseReady } from "@/db";
import { oauthAccounts, userProfiles, users } from "@/db/schema";
import { AppError } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import {
  hashPassword,
  signOAuthStateToken,
  signSessionToken,
  verifyOAuthStateToken,
  type SessionUser,
} from "@/lib/auth";

export const OAUTH_STATE_COOKIE_NAME = "sm_oauth_state";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_JWKS_URI = new URL("https://www.googleapis.com/oauth2/v3/certs");

let cachedGoogleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getGoogleJwks() {
  if (!cachedGoogleJwks) {
    cachedGoogleJwks = createRemoteJWKSet(GOOGLE_JWKS_URI);
  }
  return cachedGoogleJwks;
}

export function isGoogleOAuthConfigured(): boolean {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return Boolean(id && secret);
}

function getGoogleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new AppError(
      503,
      "GOOGLE_OAUTH_NOT_CONFIGURED",
      "Google OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are not configured on this server."
    );
  }
  return { clientId, clientSecret };
}

/**
 * Prevent open-redirect attacks by only permitting relative in-app paths.
 */
export function sanitizeRelativeRedirect(raw?: string | null): string {
  if (!raw) return "/dashboard";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("://")) {
    return "/dashboard";
  }
  return trimmed;
}

export function resolveRequestOrigin(req: Request): string {
  const url = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host") || url.host;
  const proto = forwardedProto || url.protocol.replace(":", "") || "http";
  return `${proto}://${host}`;
}

export function getGoogleRedirectUri(req: Request): string {
  const override = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (override) return override;
  const base = process.env.APP_URL?.trim() || resolveRequestOrigin(req);
  return `${base.replace(/\/+$/, "")}/api/v1/auth/google/callback`;
}

export async function createGoogleAuthorizationRequest(params: {
  req: Request;
  redirectTo?: string | null;
}) {
  const { clientId } = getGoogleCredentials();
  const redirectUri = getGoogleRedirectUri(params.req);
  const safeRedirectTo = sanitizeRelativeRedirect(params.redirectTo);

  // Cryptographic CSRF state + PKCE S256 verifier
  const state = crypto.randomBytes(32).toString("hex");
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  const stateCookieJwt = await signOAuthStateToken({
    state,
    codeVerifier,
    redirectTo: safeRedirectTo,
  });

  const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("access_type", "online");
  authUrl.searchParams.set("prompt", "select_account");

  return {
    authorizationUrl: authUrl.toString(),
    stateCookieJwt,
  };
}

export interface VerifiedGoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string | null;
}

export async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId: string
): Promise<VerifiedGoogleProfile> {
  const { payload } = await jwtVerify(idToken, getGoogleJwks(), {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: expectedClientId,
  });

  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    !payload.sub ||
    !payload.email
  ) {
    throw new AppError(401, "INVALID_GOOGLE_TOKEN", "Google ID token missing subject or email");
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase().trim(),
    emailVerified: Boolean(payload.email_verified),
    name:
      typeof payload.name === "string" && payload.name.trim().length > 0
        ? payload.name.trim()
        : payload.email.split("@")[0] ?? "Driver",
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}

export async function resolveOrCreateGoogleUser(params: {
  profile: VerifiedGoogleProfile;
  ipAddress?: string;
}): Promise<{ user: SessionUser; sessionToken: string; isNewUser: boolean }> {
  if (!params.profile.emailVerified) {
    throw new AppError(
      403,
      "EMAIL_NOT_VERIFIED",
      "Google account email address is not verified."
    );
  }

  const normalizedEmail = params.profile.email.toLowerCase().trim();
  const { db } = await ensureDatabaseReady();

  // 1. Check existing OAuth link by (provider, providerAccountId)
  const [existingOAuth] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, "google"),
        eq(oauthAccounts.providerAccountId, params.profile.sub)
      )
    )
    .limit(1);

  let userRow: typeof users.$inferSelect | undefined;
  let isNewUser = false;

  if (existingOAuth) {
    const [found] = await db
      .select()
      .from(users)
      .where(eq(users.id, existingOAuth.userId))
      .limit(1);
    userRow = found;

    await db
      .update(oauthAccounts)
      .set({
        email: normalizedEmail,
        avatarUrl: params.profile.picture ?? existingOAuth.avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(oauthAccounts.id, existingOAuth.id));
  } else {
    // 2. Match existing user by verified email to link cleanly
    const [byEmail] = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (byEmail) {
      userRow = byEmail;
      if (!byEmail.isActive || byEmail.deletedAt) {
        throw new AppError(403, "ACCOUNT_DISABLED", "This account has been disabled.");
      }

      if (!byEmail.emailVerified) {
        await db
          .update(users)
          .set({ emailVerified: true, updatedAt: new Date() })
          .where(eq(users.id, byEmail.id));
      }

      await db.insert(oauthAccounts).values({
        userId: byEmail.id,
        provider: "google",
        providerAccountId: params.profile.sub,
        email: normalizedEmail,
        avatarUrl: params.profile.picture ?? null,
      });

      await writeAuditLog({
        actorUserId: byEmail.id,
        actorRole: byEmail.role,
        action: "USER_OAUTH_LINKED",
        entityType: "USER",
        entityId: byEmail.id,
        afterState: { provider: "google", email: normalizedEmail },
        ipAddress: params.ipAddress,
      });
    } else {
      // 3. Provision a brand-new CUSTOMER account
      isNewUser = true;
      const randomUnusablePassword = `oauth-google-${crypto.randomBytes(32).toString("hex")}`;
      const passwordHash = await hashPassword(randomUnusablePassword);

      const [createdUser] = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          passwordHash,
          fullName: params.profile.name,
          role: "CUSTOMER",
          emailVerified: true,
          isActive: true,
        })
        .returning();

      if (!createdUser) {
        throw new AppError(500, "USER_CREATE_FAILED", "Could not create OAuth user");
      }

      await db.insert(userProfiles).values({
        userId: createdUser.id,
        preferredCity: "Ludhiana",
      });

      await db.insert(oauthAccounts).values({
        userId: createdUser.id,
        provider: "google",
        providerAccountId: params.profile.sub,
        email: normalizedEmail,
        avatarUrl: params.profile.picture ?? null,
      });

      await writeAuditLog({
        actorUserId: createdUser.id,
        actorRole: createdUser.role,
        action: "USER_REGISTERED_OAUTH",
        entityType: "USER",
        entityId: createdUser.id,
        afterState: { provider: "google", email: normalizedEmail },
        ipAddress: params.ipAddress,
      });

      userRow = createdUser;
    }
  }

  if (!userRow || !userRow.isActive || userRow.deletedAt) {
    throw new AppError(403, "ACCOUNT_DISABLED", "This account has been disabled.");
  }

  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userRow.id));

  const sessionUser: SessionUser = {
    id: userRow.id,
    email: userRow.email,
    fullName: userRow.fullName,
    role: userRow.role,
    emailVerified: true,
  };

  const sessionToken = await signSessionToken(sessionUser);

  await writeAuditLog({
    actorUserId: sessionUser.id,
    actorRole: sessionUser.role,
    action: "USER_LOGIN_GOOGLE",
    entityType: "USER",
    entityId: sessionUser.id,
    ipAddress: params.ipAddress,
  });

  return { user: sessionUser, sessionToken, isNewUser };
}

export async function handleGoogleOAuthCallback(params: {
  req: Request;
  code: string;
  state: string;
  stateCookieToken: string;
}) {
  const { clientId, clientSecret } = getGoogleCredentials();
  const parsedCookie = await verifyOAuthStateToken(params.stateCookieToken);

  if (!parsedCookie || !params.state) {
    throw new AppError(400, "OAUTH_STATE_INVALID", "Missing or expired OAuth state cookie");
  }

  // Constant-time CSRF state comparison
  const a = Buffer.from(parsedCookie.state);
  const b = Buffer.from(params.state);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError(400, "OAUTH_STATE_MISMATCH", "OAuth CSRF state mismatch");
  }

  const redirectUri = getGoogleRedirectUri(params.req);
  const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: parsedCookie.codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    throw new AppError(401, "OAUTH_TOKEN_EXCHANGE_FAILED", "Google token exchange failed");
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    id_token?: string;
  };

  let profile: VerifiedGoogleProfile;
  if (tokenData.id_token) {
    profile = await verifyGoogleIdToken(tokenData.id_token, clientId);
  } else if (tokenData.access_token) {
    const userInfoRes = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userInfoRes.ok) {
      throw new AppError(401, "OAUTH_USERINFO_FAILED", "Could not fetch Google user profile");
    }
    const info = (await userInfoRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!info.sub || !info.email) {
      throw new AppError(401, "INVALID_GOOGLE_PROFILE", "Google user profile incomplete");
    }
    profile = {
      sub: info.sub,
      email: info.email.toLowerCase().trim(),
      emailVerified: Boolean(info.email_verified),
      name: info.name?.trim() || info.email.split("@")[0] || "Driver",
      picture: info.picture ?? null,
    };
  } else {
    throw new AppError(401, "OAUTH_NO_TOKEN", "Google did not return an ID or access token");
  }

  const ipAddress = params.req.headers.get("x-forwarded-for") ?? "local";
  const result = await resolveOrCreateGoogleUser({ profile, ipAddress });

  const roleDefaultTarget =
    result.user.role === "SUPER_ADMIN"
      ? "/admin"
      : result.user.role === "CUSTOMER"
        ? "/dashboard"
        : "/operator";

  const finalRedirect =
    parsedCookie.redirectTo === "/dashboard" && result.user.role !== "CUSTOMER"
      ? roleDefaultTarget
      : sanitizeRelativeRedirect(parsedCookie.redirectTo);

  return {
    ...result,
    redirectTo: finalRedirect,
  };
}
