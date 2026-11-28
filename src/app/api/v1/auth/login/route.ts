import { z } from "zod";
import { eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { users } from "@/db/schema";
import { AppError, ok, handleApiError } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import {
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifyPassword,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/utils";

const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    const rl = checkRateLimit(`login:${ip}`, 30, 60_000);
    if (!rl.allowed) {
      throw new AppError(429, "RATE_LIMITED", "Too many login attempts");
    }

    const body = loginSchema.parse(await req.json());
    const { db } = await ensureDatabaseReady();

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    if (!user || !user.isActive || user.deletedAt) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    await db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    const sessionUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      emailVerified: user.emailVerified,
    };

    const token = await signSessionToken(sessionUser);

    await writeAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: "USER_LOGIN",
      entityType: "USER",
      entityId: user.id,
      ipAddress: ip,
    });

    const res = ok({ user: sessionUser });
    const isHttps =
      req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ||
      req.url.startsWith("https://");
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isHttps,
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
