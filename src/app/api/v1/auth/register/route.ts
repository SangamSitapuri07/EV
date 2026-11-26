import { z } from "zod";
import { eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { operators, userProfiles, users } from "@/db/schema";
import { AppError, created, handleApiError } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import {
  generateOpaqueToken,
  hashPassword,
  SESSION_COOKIE_NAME,
  signSessionToken,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/utils";

const registerSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(7).max(32).optional(),
  role: z.enum(["CUSTOMER", "PARKING_OPERATOR", "EV_OPERATOR"]).default("CUSTOMER"),
  businessName: z.string().trim().min(2).max(180).optional(),
  registrationNumber: z.string().trim().min(3).max(100).optional(),
});

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    const rl = checkRateLimit(`register:${ip}`, 20, 60_000);
    if (!rl.allowed) {
      throw new AppError(429, "RATE_LIMITED", "Too many registration attempts");
    }

    const body = registerSchema.parse(await req.json());
    const { db } = await ensureDatabaseReady();

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    if (existing) {
      throw new AppError(409, "EMAIL_EXISTS", "An account with this email already exists");
    }

    const passwordHash = await hashPassword(body.password);
    const verificationToken = generateOpaqueToken();

    const createdUser = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: body.email,
          passwordHash,
          fullName: body.fullName,
          phone: body.phone ?? null,
          role: body.role,
          emailVerified: false,
          verificationToken,
        })
        .returning();

      if (!u) throw new AppError(500, "USER_CREATE_FAILED", "Could not register user");

      await tx.insert(userProfiles).values({
        userId: u.id,
        preferredCity: "Ludhiana",
      });

      if (body.role === "PARKING_OPERATOR" || body.role === "EV_OPERATOR") {
        await tx.insert(operators).values({
          ownerUserId: u.id,
          businessName: body.businessName || `${body.fullName} Mobility Pvt Ltd`,
          registrationNumber: body.registrationNumber || `REG-${Date.now()}`,
          operatorType: body.role === "EV_OPERATOR" ? "EV_CHARGING" : "PARKING",
          contactEmail: body.email,
          contactPhone: body.phone || "+91-98000-00000",
          status: "PENDING_VERIFICATION",
        });
      }

      return u;
    });

    const sessionUser = {
      id: createdUser.id,
      email: createdUser.email,
      fullName: createdUser.fullName,
      role: createdUser.role,
      emailVerified: createdUser.emailVerified,
    };

    const token = await signSessionToken(sessionUser);

    await writeAuditLog({
      actorUserId: createdUser.id,
      actorRole: createdUser.role,
      action: "USER_REGISTERED",
      entityType: "USER",
      entityId: createdUser.id,
      afterState: { email: createdUser.email, role: createdUser.role },
      ipAddress: ip,
    });

    const res = created({
      user: sessionUser,
      verificationPreviewToken:
        process.env.NODE_ENV !== "production" ? verificationToken : undefined,
    });

    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
