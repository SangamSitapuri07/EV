import { z } from "zod";
import { eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { users } from "@/db/schema";
import { AppError, ok, handleApiError } from "@/lib/api-response";
import { generateOpaqueToken, hashPassword } from "@/lib/auth";

const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

const recoverSchema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("request"),
    email: z.string().email().toLowerCase().trim(),
  }),
  z.object({
    step: z.literal("confirm"),
    token: z.string().min(10),
    newPassword: z.string().min(8).max(128),
  }),
]);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { db } = await ensureDatabaseReady();

    if ("token" in body && !("step" in body)) {
      const parsed = verifyEmailSchema.parse(body);
      const [u] = await db
        .select()
        .from(users)
        .where(eq(users.verificationToken, parsed.token))
        .limit(1);
      if (!u) throw new AppError(400, "INVALID_TOKEN", "Invalid verification token");
      await db
        .update(users)
        .set({ emailVerified: true, verificationToken: null, updatedAt: new Date() })
        .where(eq(users.id, u.id));
      return ok({ verified: true, email: u.email });
    }

    const parsed = recoverSchema.parse(body);
    if (parsed.step === "request") {
      const [u] = await db
        .select()
        .from(users)
        .where(eq(users.email, parsed.email))
        .limit(1);
      if (!u) {
        return ok({ requested: true });
      }
      const token = generateOpaqueToken();
      await db
        .update(users)
        .set({
          resetToken: token,
          resetTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
          updatedAt: new Date(),
        })
        .where(eq(users.id, u.id));

      return ok({
        requested: true,
        sandboxResetToken: process.env.NODE_ENV !== "production" ? token : undefined,
      });
    }

    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.resetToken, parsed.token))
      .limit(1);
    if (!u || !u.resetTokenExpiresAt || u.resetTokenExpiresAt < new Date()) {
      throw new AppError(400, "INVALID_OR_EXPIRED_TOKEN", "Reset token invalid or expired");
    }

    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(parsed.newPassword),
        resetToken: null,
        resetTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, u.id));

    return ok({ passwordUpdated: true });
  } catch (err) {
    return handleApiError(err);
  }
}
