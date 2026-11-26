import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import {
  facilities,
  notifications,
  savedFacilities,
  supportTickets,
  userProfiles,
  users,
  vehicles,
} from "@/db/schema";
import { ok, handleApiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth";
import { listCustomerReservations } from "@/features/reservations/reservations.service";
import { listUserPaymentsAndRefunds } from "@/features/payments/payments.service";
import { listUserChargingSessions } from "@/features/charging/charging.service";

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(160).optional(),
  phone: z.string().trim().max(32).optional().nullable(),
  preferredCity: z.string().trim().max(120).optional(),
  preferredConnector: z
    .enum(["CCS2", "TYPE2_AC", "CHADEMO", "BHARAT_DC001", "BHARAT_AC001", "GB_T"])
    .optional()
    .nullable(),
  accessibilityRequired: z.boolean().optional(),
  locationConsentGranted: z.boolean().optional(),
});

export async function GET(req: Request) {
  try {
    const user = await requireAuth(req);
    const { db } = await ensureDatabaseReady();

    const [
      profileRows,
      vehicleRows,
      savedRows,
      notificationRows,
      ticketRows,
      reservationRows,
      paymentHistory,
      chargingRows,
    ] = await Promise.all([
      db.select().from(userProfiles).where(eq(userProfiles.userId, user.id)).limit(1),
      db.select().from(vehicles).where(eq(vehicles.userId, user.id)).orderBy(desc(vehicles.createdAt)),
      db
        .select({
          savedId: savedFacilities.id,
          facility: facilities,
        })
        .from(savedFacilities)
        .innerJoin(facilities, eq(savedFacilities.facilityId, facilities.id))
        .where(eq(savedFacilities.userId, user.id)),
      db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(30),
      db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.userId, user.id))
        .orderBy(desc(supportTickets.createdAt)),
      listCustomerReservations(user.id),
      listUserPaymentsAndRefunds(user.id),
      listUserChargingSessions(user.id),
    ]);

    return ok({
      user,
      profile: profileRows[0] ?? null,
      vehicles: vehicleRows,
      savedFacilities: savedRows.map((r) => r.facility),
      notifications: notificationRows,
      tickets: ticketRows,
      reservations: reservationRows,
      payments: paymentHistory.payments,
      orders: paymentHistory.orders,
      refunds: paymentHistory.refunds,
      chargingSessions: chargingRows,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireAuth(req);
    const body = updateProfileSchema.parse(await req.json());
    const { db } = await ensureDatabaseReady();

    if (body.fullName !== undefined || body.phone !== undefined) {
      await db
        .update(users)
        .set({
          ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
    }

    const [existingProfile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, user.id))
      .limit(1);

    const profileUpdates = {
      ...(body.preferredCity !== undefined ? { preferredCity: body.preferredCity } : {}),
      ...(body.preferredConnector !== undefined
        ? { preferredConnector: body.preferredConnector }
        : {}),
      ...(body.accessibilityRequired !== undefined
        ? { accessibilityRequired: body.accessibilityRequired }
        : {}),
      ...(body.locationConsentGranted !== undefined
        ? { locationConsentGranted: body.locationConsentGranted }
        : {}),
      updatedAt: new Date(),
    };

    if (existingProfile) {
      await db
        .update(userProfiles)
        .set(profileUpdates)
        .where(eq(userProfiles.userId, user.id));
    } else {
      await db.insert(userProfiles).values({
        userId: user.id,
        ...profileUpdates,
      });
    }

    return ok({ updated: true });
  } catch (err) {
    return handleApiError(err);
  }
}
