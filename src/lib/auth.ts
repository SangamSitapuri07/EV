import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { ensureDatabaseReady } from "@/db";
import { users } from "@/db/schema";
import { AppError } from "./api-response";

export const SESSION_COOKIE_NAME = "sm_session";

export type UserRole = "CUSTOMER" | "PARKING_OPERATOR" | "EV_OPERATOR" | "SUPER_ADMIN";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  emailVerified: boolean;
}

function getSecretKey(): Uint8Array {
  const secret =
    process.env.AUTH_SECRET || "dev-only-replace-with-32-char-random-secret-key";
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    sub: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    emailVerified: user.emailVerified,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (!payload.sub || !payload.email || !payload.role) return null;
    return {
      id: String(payload.sub),
      email: String(payload.email),
      fullName: String(payload.fullName ?? ""),
      role: payload.role as UserRole,
      emailVerified: Boolean(payload.emailVerified),
    };
  } catch {
    return null;
  }
}

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  redirectTo: string;
}

export async function signOAuthStateToken(payload: OAuthStatePayload): Promise<string> {
  return new SignJWT({
    state: payload.state,
    codeVerifier: payload.codeVerifier,
    redirectTo: payload.redirectTo,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getSecretKey());
}

export async function verifyOAuthStateToken(token: string): Promise<OAuthStatePayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.state !== "string" ||
      typeof payload.codeVerifier !== "string" ||
      typeof payload.redirectTo !== "string"
    ) {
      return null;
    }
    return {
      state: payload.state,
      codeVerifier: payload.codeVerifier,
      redirectTo: payload.redirectTo,
    };
  } catch {
    return null;
  }
}

export async function getSessionUser(request?: Request): Promise<SessionUser | null> {
  let token: string | undefined;

  if (request) {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    }
    if (!token) {
      const cookieHeader = request.headers.get("cookie") ?? "";
      const match = cookieHeader
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
      if (match) {
        token = decodeURIComponent(match.slice(SESSION_COOKIE_NAME.length + 1));
      }
    }
  } else {
    try {
      const store = await cookies();
      token = store.get(SESSION_COOKIE_NAME)?.value;
    } catch {
      return null;
    }
  }

  if (!token) return null;
  const parsed = await verifySessionToken(token);
  if (!parsed) return null;

  // Verify user is still active in DB
  const { db } = await ensureDatabaseReady();
  const [dbUser] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      emailVerified: users.emailVerified,
      isActive: users.isActive,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, parsed.id))
    .limit(1);

  if (!dbUser || !dbUser.isActive || dbUser.deletedAt) {
    return null;
  }

  return {
    id: dbUser.id,
    email: dbUser.email,
    fullName: dbUser.fullName,
    role: dbUser.role,
    emailVerified: dbUser.emailVerified,
  };
}

export async function requireAuth(request?: Request): Promise<SessionUser> {
  const user = await getSessionUser(request);
  if (!user) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }
  return user;
}

export async function requireRole(
  roles: UserRole[],
  request?: Request
): Promise<SessionUser> {
  const user = await requireAuth(request);
  if (!roles.includes(user.role)) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to perform this action");
  }
  return user;
}

export function generateOpaqueToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function signQrPayload(payload: { reservationId: string; bookingReference: string }): string {
  const secret = process.env.QR_SIGNING_SECRET || "dev-only-replace-with-32-char-qr-signing-secret";
  const body = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return Buffer.from(JSON.stringify({ ...payload, sig })).toString("base64url");
}

export function verifyQrPayload(
  token: string
): { reservationId: string; bookingReference: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf-8")) as {
      reservationId?: string;
      bookingReference?: string;
      sig?: string;
    };
    if (!decoded.reservationId || !decoded.bookingReference || !decoded.sig) return null;
    const secret = process.env.QR_SIGNING_SECRET || "dev-only-replace-with-32-char-qr-signing-secret";
    const expected = crypto
      .createHmac("sha256", secret)
      .update(
        JSON.stringify({
          reservationId: decoded.reservationId,
          bookingReference: decoded.bookingReference,
        })
      )
      .digest("hex");
    if (decoded.sig.length !== expected.length) return null;
    const valid = crypto.timingSafeEqual(Buffer.from(decoded.sig), Buffer.from(expected));
    if (!valid) return null;
    return {
      reservationId: decoded.reservationId,
      bookingReference: decoded.bookingReference,
    };
  } catch {
    return null;
  }
}
