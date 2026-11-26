import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { notifications, savedFacilities, supportTickets } from "@/db/schema";
import { created, ok, handleApiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth";

const toggleSavedSchema = z.object({
  facilityId: z.string().uuid(),
});

const createTicketSchema = z.object({
  facilityId: z.string().uuid().optional().nullable(),
  reservationId: z.string().uuid().optional().nullable(),
  category: z.enum(["DISPUTE", "REFUND", "CHARGER_FAULT", "ACCESS", "OTHER"]),
  subject: z.string().trim().min(4).max(200),
  description: z.string().trim().min(10).max(2000),
});

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const body = await req.json();
    const { db } = await ensureDatabaseReady();

    if (body.action === "toggle_saved") {
      const parsed = toggleSavedSchema.parse(body);
      const [existing] = await db
        .select()
        .from(savedFacilities)
        .where(
          and(
            eq(savedFacilities.userId, user.id),
            eq(savedFacilities.facilityId, parsed.facilityId)
          )
        )
        .limit(1);

      if (existing) {
        await db.delete(savedFacilities).where(eq(savedFacilities.id, existing.id));
        return ok({ saved: false });
      }
      await db.insert(savedFacilities).values({
        userId: user.id,
        facilityId: parsed.facilityId,
      });
      return ok({ saved: true });
    }

    if (body.action === "mark_notifications_read") {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.userId, user.id));
      return ok({ updated: true });
    }

    const parsed = createTicketSchema.parse(body);
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        userId: user.id,
        facilityId: parsed.facilityId ?? null,
        reservationId: parsed.reservationId ?? null,
        category: parsed.category,
        subject: parsed.subject,
        description: parsed.description,
      })
      .returning();

    return created({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}
