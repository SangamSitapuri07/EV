import { and, eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { idempotencyKeys } from "@/db/schema";
import { created, handleApiError, ok } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth";
import {
  createHoldSchema,
  createReservationHold,
  listCustomerReservations,
} from "@/features/reservations/reservations.service";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const user = await requireAuth(req);
    const items = await listCustomerReservations(user.id);
    return ok({ reservations: items });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const idemKey = req.headers.get("idempotency-key")?.trim();
    const route = "/api/v1/reservations";

    if (idemKey) {
      const { db } = await ensureDatabaseReady();
      const [existing] = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.key, idemKey), eq(idempotencyKeys.route, route)))
        .limit(1);

      if (existing && existing.expiresAt > new Date()) {
        return NextResponse.json(existing.responseBody, { status: existing.responseStatus });
      }
    }

    const body = createHoldSchema.parse(await req.json());
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    const result = await createReservationHold(user, body, ip);

    if (idemKey) {
      const { db } = await ensureDatabaseReady();
      await db
        .insert(idempotencyKeys)
        .values({
          key: idemKey,
          userId: user.id,
          route,
          responseStatus: 201,
          responseBody: { ok: true, data: result } as unknown as Record<string, unknown>,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .onConflictDoNothing();
    }

    return created(result);
  } catch (err) {
    return handleApiError(err);
  }
}
