import { eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { DEMO_EV_OWNER_EMAIL, ensureDemoEvOwnerAccount } from "@/db/demo-ev-owner";
import { users } from "@/db/schema";
import { AppError, handleApiError, ok } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { SESSION_COOKIE_NAME, signSessionToken } from "@/lib/auth";
import { checkRateLimit } from "@/lib/utils";

function isHttpsRequest(req: Request): boolean {
  const fwdProto = req.headers.get("x-forwarded-proto");
  if (fwdProto) {
    return fwdProto.split(",")[0]!.trim() === "https";
  }
  return req.url.startsWith("https://");
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    const rl = checkRateLimit(`demo-owner:${ip}`, 30, 60_000);
    if (!rl.allowed) {
      throw new AppError(429, "RATE_LIMITED", "Too many demo login attempts");
    }

    const { db } = await ensureDatabaseReady();
    await ensureDemoEvOwnerAccount(db);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, DEMO_EV_OWNER_EMAIL))
      .limit(1);

    if (!user || !user.isActive || user.deletedAt) {
      throw new AppError(500, "DEMO_OWNER_UNAVAILABLE", "Demo EV Owner account is unavailable");
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
      action: "DEMO_EV_OWNER_LOGIN",
      entityType: "USER",
      entityId: user.id,
      ipAddress: ip,
    });

    const res = ok({ user: sessionUser });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isHttpsRequest(req),
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
