import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { seedIfEmpty } from "@/db/seed-data";
import { auditLogs, oauthAccounts, userProfiles, users } from "@/db/schema";
import {
  createGoogleAuthorizationRequest,
  handleGoogleOAuthCallback,
  isGoogleOAuthConfigured,
  resolveOrCreateGoogleUser,
  sanitizeRelativeRedirect,
} from "@/features/auth/google-oauth.service";
import { verifySessionToken } from "@/lib/auth";

describe("Google OAuth 2.0 / OIDC (PKCE, CSRF State & Account Linking)", () => {
  beforeAll(async () => {
    const { db } = await ensureDatabaseReady();
    await seedIfEmpty(db);
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    vi.restoreAllMocks();
  });

  it("reports unconfigured when GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET are absent", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(isGoogleOAuthConfigured()).toBe(false);

    process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    expect(isGoogleOAuthConfigured()).toBe(true);
  });

  it("sanitizes redirectTo to prevent open-redirect attacks", () => {
    expect(sanitizeRelativeRedirect("/explore")).toBe("/explore");
    expect(sanitizeRelativeRedirect("/facilities/sarabha-nagar-central-plaza")).toBe(
      "/facilities/sarabha-nagar-central-plaza"
    );
    expect(sanitizeRelativeRedirect("https://evil.example.com")).toBe("/dashboard");
    expect(sanitizeRelativeRedirect("//evil.example.com")).toBe("/dashboard");
    expect(sanitizeRelativeRedirect(null)).toBe("/dashboard");
  });

  it("builds a valid PKCE S256 Google authorization URL and signed state cookie", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

    const req = new Request("https://preview.example.com/api/v1/auth/google?redirectTo=/explore", {
      headers: { host: "preview.example.com", "x-forwarded-proto": "https" },
    });

    const { authorizationUrl, stateCookieJwt } = await createGoogleAuthorizationRequest({
      req,
      redirectTo: "/explore",
    });

    const parsed = new URL(authorizationUrl);
    expect(parsed.origin).toBe("https://accounts.google.com");
    expect(parsed.pathname).toBe("/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id.apps.googleusercontent.com");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe("openid email profile");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("code_challenge")).toBeTruthy();
    expect(parsed.searchParams.get("state")).toBeTruthy();
    expect(stateCookieJwt).toBeTruthy();
  });

  it("rejects OAuth callback with mismatched CSRF state", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

    const req = new Request("http://localhost:3000/api/v1/auth/google");
    const { stateCookieJwt } = await createGoogleAuthorizationRequest({ req });

    await expect(
      handleGoogleOAuthCallback({
        req: new Request("http://localhost:3000/api/v1/auth/google/callback?code=abc&state=tampered"),
        code: "abc",
        state: "tampered",
        stateCookieToken: stateCookieJwt,
      })
    ).rejects.toThrow(/CSRF state mismatch/i);
  });

  it("rejects unverified Google email addresses", async () => {
    await expect(
      resolveOrCreateGoogleUser({
        profile: {
          sub: "google-sub-unverified",
          email: "unverified@gmail.com",
          emailVerified: false,
          name: "Unverified User",
        },
      })
    ).rejects.toThrow(/not verified/i);
  });

  it("provisions a new CUSTOMER user + profile + oauth_accounts on first Google sign-in and reuses it on repeat login", async () => {
    const email = `google.driver.${Date.now()}@gmail.com`;
    const sub = `google-sub-${Date.now()}`;

    const first = await resolveOrCreateGoogleUser({
      profile: {
        sub,
        email,
        emailVerified: true,
        name: "Ananya Verma",
        picture: "https://lh3.googleusercontent.com/a/example",
      },
      ipAddress: "127.0.0.1",
    });

    expect(first.isNewUser).toBe(true);
    expect(first.user.role).toBe("CUSTOMER");
    expect(first.user.emailVerified).toBe(true);

    const decodedSession = await verifySessionToken(first.sessionToken);
    expect(decodedSession?.id).toBe(first.user.id);
    expect(decodedSession?.email).toBe(email);

    const { db } = await ensureDatabaseReady();
    const [profileRow] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, first.user.id))
      .limit(1);
    expect(profileRow).toBeDefined();

    const [oauthRow] = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.providerAccountId, sub))
      .limit(1);
    expect(oauthRow?.provider).toBe("google");

    // Second sign-in reuses exact same user without creating duplicate
    const second = await resolveOrCreateGoogleUser({
      profile: {
        sub,
        email,
        emailVerified: true,
        name: "Ananya Verma",
      },
      ipAddress: "127.0.0.1",
    });
    expect(second.isNewUser).toBe(false);
    expect(second.user.id).toBe(first.user.id);

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, first.user.id));
    expect(logs.some((l) => l.action === "USER_REGISTERED_OAUTH")).toBe(true);
    expect(logs.some((l) => l.action === "USER_LOGIN_GOOGLE")).toBe(true);
  });

  it("links Google sign-in to an existing verified account by email", async () => {
    const { db } = await ensureDatabaseReady();
    const [existingCustomer] = await db
      .select()
      .from(users)
      .where(eq(users.email, "customer@smartmobility.test"))
      .limit(1);
    expect(existingCustomer).toBeDefined();

    const linked = await resolveOrCreateGoogleUser({
      profile: {
        sub: `google-linked-${Date.now()}`,
        email: "customer@smartmobility.test",
        emailVerified: true,
        name: "Aarav Sharma",
      },
    });

    expect(linked.isNewUser).toBe(false);
    expect(linked.user.id).toBe(existingCustomer!.id);
  });
});
