import { z } from "zod";
import { and, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import {
  availabilityEvents,
  connectors,
  facilities,
  notifications,
  parkingSessions,
  parkingSpaces,
  payments,
  refunds,
  reservationItems,
  reservations,
} from "@/db/schema";
import { AppError } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { type SessionUser, signQrPayload, verifyQrPayload } from "@/lib/auth";
import { publishPlatformEvent } from "@/lib/events";
import { assertFacilityAccess, assertReservationReadAccess } from "@/lib/permissions";
import { generateBookingRef } from "@/lib/utils";
import { expireStaleHolds } from "@/features/availability/availability.service";
import {
  calculatePriceEstimate,
  computeCancellationRefundPaise,
} from "@/features/pricing/pricing.service";

export const createHoldSchema = z.object({
  facilityId: z.string().uuid(),
  vehicleId: z.string().uuid().optional().nullable(),
  parkingSpaceId: z.string().uuid().optional().nullable(),
  connectorId: z.string().uuid().optional().nullable(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  estimatedKwh: z.number().min(0).max(200).optional().default(10),
  promoCode: z.string().trim().max(32).optional(),
});

export const extendReservationSchema = z.object({
  newEndTime: z.string().datetime(),
});

export const cancelReservationSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional().default("Cancelled by customer"),
});

export const ALLOWED_RESERVATION_TRANSITIONS: Record<string, string[]> = {
  PENDING_PAYMENT: ["CONFIRMED", "EXPIRED", "CANCELLED", "PAYMENT_FAILED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED"],
  CHECKED_IN: ["ACTIVE", "COMPLETED"],
  ACTIVE: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
  PAYMENT_FAILED: ["PENDING_PAYMENT", "CANCELLED"],
};

export function assertValidReservationTransition(from: string, to: string) {
  const allowed = ALLOWED_RESERVATION_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(
      409,
      "INVALID_STATE_TRANSITION",
      `Cannot transition reservation from ${from} to ${to}`
    );
  }
}

export async function createReservationHold(
  user: SessionUser,
  input: z.infer<typeof createHoldSchema>,
  ipAddress?: string | null
) {
  await expireStaleHolds();

  const startTime = new Date(input.startTime);
  const endTime = new Date(input.endTime);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
    throw new AppError(400, "INVALID_WINDOW", "End time must be after start time");
  }

  if (!input.parkingSpaceId && !input.connectorId) {
    throw new AppError(
      400,
      "RESOURCE_REQUIRED",
      "Select at least one parking space or EV connector"
    );
  }

  const { db } = await ensureDatabaseReady();

  const [facility] = await db
    .select()
    .from(facilities)
    .where(and(eq(facilities.id, input.facilityId), eq(facilities.status, "ACTIVE")))
    .limit(1);

  if (!facility) {
    throw new AppError(404, "FACILITY_UNAVAILABLE", "Active facility not found");
  }

  const holdTtlSeconds = Number(process.env.HOLD_TTL_SECONDS ?? 600);
  const holdExpiresAt = new Date(Date.now() + holdTtlSeconds * 1000);
  const bookingReference = generateBookingRef();

  // Pre-fetch space category & compute authoritative server pricing before opening the serialized DB transaction
  let preSpaceCategory: typeof parkingSpaces.$inferSelect.category | undefined;
  if (input.parkingSpaceId) {
    const [sp] = await db
      .select({ category: parkingSpaces.category })
      .from(parkingSpaces)
      .where(eq(parkingSpaces.id, input.parkingSpaceId))
      .limit(1);
    preSpaceCategory = sp?.category;
  }

  const price = await calculatePriceEstimate({
    facilityId: facility.id,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    spaceCategory: preSpaceCategory,
    connectorId: input.connectorId ?? null,
    estimatedKwh: input.estimatedKwh,
    promoCode: input.promoCode,
  });

  const createdReservation = await db.transaction(async (tx) => {
    let lockedSpace: typeof parkingSpaces.$inferSelect | undefined;
    let lockedConnector: typeof connectors.$inferSelect | undefined;

    if (input.parkingSpaceId) {
      // Row-level pessimistic lock (FOR UPDATE) to prevent race conditions under concurrency
      const spaceLockRes = await tx.execute(
        sql`SELECT * FROM parking_spaces WHERE id = ${input.parkingSpaceId} AND facility_id = ${facility.id} FOR UPDATE`
      );
      const rawSpace = spaceLockRes.rows?.[0] as Record<string, unknown> | undefined;
      if (!rawSpace) {
        throw new AppError(404, "SPACE_NOT_FOUND", "Parking space not found at this facility");
      }
      if (rawSpace.status === "OUT_OF_SERVICE" || !rawSpace.is_active) {
        throw new AppError(409, "SPACE_OUT_OF_SERVICE", "Selected space is out of service");
      }

      const isImmediate = Math.abs(startTime.getTime() - Date.now()) <= 15 * 60 * 1000;
      if (isImmediate && (rawSpace.status === "OCCUPIED" || rawSpace.status === "HELD")) {
        throw new AppError(409, "SPACE_BUSY", "Selected space is currently occupied or held");
      }

      const [spaceRow] = await tx
        .select()
        .from(parkingSpaces)
        .where(eq(parkingSpaces.id, input.parkingSpaceId))
        .limit(1);
      lockedSpace = spaceRow;

      // Overlap check inside serialized transaction
      const overlaps = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.parkingSpaceId, input.parkingSpaceId),
            inArray(reservations.status, [
              "PENDING_PAYMENT",
              "CONFIRMED",
              "CHECKED_IN",
              "ACTIVE",
            ]),
            lt(reservations.startTime, endTime),
            gt(reservations.endTime, startTime)
          )
        )
        .limit(1);

      if (overlaps.length > 0) {
        throw new AppError(
          409,
          "SPACE_CONFLICT",
          "Parking space is already held or reserved for this time window"
        );
      }
    }

    if (input.connectorId) {
      const connLockRes = await tx.execute(
        sql`SELECT * FROM connectors WHERE id = ${input.connectorId} AND facility_id = ${facility.id} FOR UPDATE`
      );
      const rawConn = connLockRes.rows?.[0] as Record<string, unknown> | undefined;
      if (!rawConn) {
        throw new AppError(404, "CONNECTOR_NOT_FOUND", "EV connector not found at this facility");
      }
      if (rawConn.status === "FAULTED" || rawConn.status === "OFFLINE") {
        throw new AppError(409, "CONNECTOR_UNAVAILABLE", "Selected EV connector is faulted or offline");
      }

      const isImmediate = Math.abs(startTime.getTime() - Date.now()) <= 15 * 60 * 1000;
      if (isImmediate && (rawConn.status === "CHARGING" || rawConn.status === "HELD")) {
        throw new AppError(409, "CONNECTOR_BUSY", "Selected EV connector is currently in use or held");
      }

      const [connRow] = await tx
        .select()
        .from(connectors)
        .where(eq(connectors.id, input.connectorId))
        .limit(1);
      lockedConnector = connRow;

      const connOverlaps = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.connectorId, input.connectorId),
            inArray(reservations.status, [
              "PENDING_PAYMENT",
              "CONFIRMED",
              "CHECKED_IN",
              "ACTIVE",
            ]),
            lt(reservations.startTime, endTime),
            gt(reservations.endTime, startTime)
          )
        )
        .limit(1);

      if (connOverlaps.length > 0) {
        throw new AppError(
          409,
          "CONNECTOR_CONFLICT",
          "Selected EV connector is already held or reserved for this time window"
        );
      }
    }

    const reservationType =
      input.parkingSpaceId && input.connectorId
        ? "COMBINED"
        : input.connectorId
          ? "EV_CHARGING"
          : "PARKING";

    const [resRow] = await tx
      .insert(reservations)
      .values({
        bookingReference,
        userId: user.id,
        facilityId: facility.id,
        vehicleId: input.vehicleId ?? null,
        parkingSpaceId: input.parkingSpaceId ?? null,
        connectorId: input.connectorId ?? null,
        reservationType,
        status: "PENDING_PAYMENT",
        startTime,
        endTime,
        holdExpiresAt,
        currency: price.currency,
        estimatedParkingPaise: price.parkingBasePaise,
        estimatedChargingPaise: price.chargingEstimatePaise,
        platformFeePaise: price.platformFeePaise,
        taxPaise: price.taxPaise,
        discountPaise: price.discountPaise,
        totalEstimatedPaise: price.totalEstimatedPaise,
        priceBreakdown: price as unknown as Record<string, unknown>,
      })
      .returning();

    if (!resRow) {
      throw new AppError(500, "RESERVATION_CREATE_FAILED", "Could not create reservation");
    }

    const items: Array<typeof reservationItems.$inferInsert> = [];
    if (lockedSpace) {
      items.push({
        reservationId: resRow.id,
        itemType: "PARKING_SPACE",
        description: `Parking Space ${lockedSpace.code} (${lockedSpace.category})`,
        quantity: Math.max(1, Math.round((price.billableMinutes / 60) * 10) / 10),
        unitAmountPaise: price.hourlyRatePaise,
        totalAmountPaise: price.parkingBasePaise,
      });
    }
    if (lockedConnector) {
      items.push({
        reservationId: resRow.id,
        itemType: "EV_CONNECTOR",
        description: `EV Connector #${lockedConnector.connectorNumber} (${lockedConnector.standard}, ${lockedConnector.maxPowerKw}kW)`,
        quantity: input.estimatedKwh || 10,
        unitAmountPaise: lockedConnector.pricePerKwhPaise,
        totalAmountPaise: price.chargingEstimatePaise,
      });
    }
    if (items.length > 0) {
      await tx.insert(reservationItems).values(items);
    }

    // Put immediate holds on space/connector if window starts soon
    const isNearTerm = startTime.getTime() - Date.now() <= 30 * 60 * 1000;
    if (isNearTerm && lockedSpace && lockedSpace.status === "AVAILABLE") {
      await tx
        .update(parkingSpaces)
        .set({ status: "HELD", statusUpdatedAt: new Date() })
        .where(eq(parkingSpaces.id, lockedSpace.id));
    }
    if (isNearTerm && lockedConnector && lockedConnector.status === "AVAILABLE") {
      await tx
        .update(connectors)
        .set({ status: "HELD", statusUpdatedAt: new Date() })
        .where(eq(connectors.id, lockedConnector.id));
    }

    await tx.insert(availabilityEvents).values({
      facilityId: facility.id,
      resourceType: lockedSpace ? "PARKING_SPACE" : "CONNECTOR",
      resourceId: lockedSpace?.id ?? lockedConnector?.id ?? facility.id,
      previousStatus: "AVAILABLE",
      newStatus: "HELD",
      source: "RESERVATION_ENGINE",
    });

    return { reservation: resRow, price };
  });

  await writeAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: "RESERVATION_HOLD_CREATED",
    entityType: "RESERVATION",
    entityId: createdReservation.reservation.id,
    afterState: {
      bookingReference,
      totalEstimatedPaise: createdReservation.reservation.totalEstimatedPaise,
    },
    ipAddress,
  });

  publishPlatformEvent({
    type: "AVAILABILITY_CHANGED",
    facilityId: facility.id,
    source: "RESERVATION_ENGINE",
    payload: {
      reservationId: createdReservation.reservation.id,
      bookingReference,
      status: "HELD",
    },
  });

  return createdReservation;
}

export async function getReservationDetails(user: SessionUser, reservationId: string) {
  await expireStaleHolds();
  const { db } = await ensureDatabaseReady();

  const [res] = await db
    .select()
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .limit(1);

  if (!res) {
    throw new AppError(404, "NOT_FOUND", "Reservation not found");
  }

  await assertReservationReadAccess(user, res);

  const [facility] = await db
    .select()
    .from(facilities)
    .where(eq(facilities.id, res.facilityId))
    .limit(1);

  const [space] = res.parkingSpaceId
    ? await db
        .select()
        .from(parkingSpaces)
        .where(eq(parkingSpaces.id, res.parkingSpaceId))
        .limit(1)
    : [];

  const [connector] = res.connectorId
    ? await db.select().from(connectors).where(eq(connectors.id, res.connectorId)).limit(1)
    : [];

  const items = await db
    .select()
    .from(reservationItems)
    .where(eq(reservationItems.reservationId, res.id));

  const paymentRows = await db
    .select()
    .from(payments)
    .where(eq(payments.reservationId, res.id));

  const refundRows = await db
    .select()
    .from(refunds)
    .where(eq(refunds.reservationId, res.id));

  const qrPayload =
    res.status === "CONFIRMED" || res.status === "CHECKED_IN" || res.status === "ACTIVE"
      ? signQrPayload({ reservationId: res.id, bookingReference: res.bookingReference })
      : null;

  return {
    reservation: res,
    facility: facility ?? null,
    space: space ?? null,
    connector: connector ?? null,
    items,
    payments: paymentRows,
    refunds: refundRows,
    qrPayload,
  };
}

export async function listCustomerReservations(userId: string) {
  await expireStaleHolds();
  const { db } = await ensureDatabaseReady();

  const rows = await db
    .select()
    .from(reservations)
    .where(eq(reservations.userId, userId))
    .orderBy(desc(reservations.createdAt));

  if (rows.length === 0) return [];

  const facilityIds = Array.from(new Set(rows.map((r) => r.facilityId)));
  const facilityRows = await db
    .select()
    .from(facilities)
    .where(inArray(facilities.id, facilityIds));

  const fMap = new Map(facilityRows.map((f) => [f.id, f]));

  return rows.map((r) => ({
    ...r,
    facilityName: fMap.get(r.facilityId)?.name ?? "Facility",
    facilityCity: fMap.get(r.facilityId)?.city ?? "",
    facilityAddress: fMap.get(r.facilityId)?.addressLine1 ?? "",
    qrPayload:
      r.status === "CONFIRMED" || r.status === "CHECKED_IN" || r.status === "ACTIVE"
        ? signQrPayload({ reservationId: r.id, bookingReference: r.bookingReference })
        : null,
  }));
}

export async function extendReservation(
  user: SessionUser,
  reservationId: string,
  newEndTimeIso: string
) {
  const { db } = await ensureDatabaseReady();
  const newEndTime = new Date(newEndTimeIso);

  const [existing] = await db
    .select()
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .limit(1);

  if (!existing) {
    throw new AppError(404, "NOT_FOUND", "Reservation not found");
  }
  await assertReservationReadAccess(user, existing);

  if (!["CONFIRMED", "CHECKED_IN", "ACTIVE"].includes(existing.status)) {
    throw new AppError(
      409,
      "CANNOT_EXTEND",
      `Cannot extend reservation in status ${existing.status}`
    );
  }
  if (newEndTime <= existing.endTime) {
    throw new AppError(400, "INVALID_EXTENSION", "New end time must be after current end time");
  }

  // Check overlap for extension window [existing.endTime, newEndTime)
  if (existing.parkingSpaceId) {
    const spaceConflict = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.parkingSpaceId, existing.parkingSpaceId),
          ne(reservations.id, existing.id),
          inArray(reservations.status, ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN", "ACTIVE"]),
          lt(reservations.startTime, newEndTime),
          gt(reservations.endTime, existing.endTime)
        )
      )
      .limit(1);
    if (spaceConflict.length > 0) {
      throw new AppError(409, "EXTENSION_CONFLICT", "Space is reserved by another booking");
    }
  }

  const newPrice = await calculatePriceEstimate({
    facilityId: existing.facilityId,
    startTime: existing.startTime.toISOString(),
    endTime: newEndTime.toISOString(),
    connectorId: existing.connectorId,
    estimatedKwh: 0,
  });

  const extraPaise = Math.max(0, newPrice.totalEstimatedPaise - existing.totalEstimatedPaise);

  const [updated] = await db
    .update(reservations)
    .set({
      endTime: newEndTime,
      totalEstimatedPaise: newPrice.totalEstimatedPaise,
      estimatedParkingPaise: newPrice.parkingBasePaise,
      platformFeePaise: newPrice.platformFeePaise,
      taxPaise: newPrice.taxPaise,
      priceBreakdown: newPrice as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, existing.id))
    .returning();

  if (extraPaise > 0) {
    await db.insert(reservationItems).values({
      reservationId: existing.id,
      itemType: "EXTENSION",
      description: `Time extension until ${newEndTime.toISOString()}`,
      quantity: 1,
      unitAmountPaise: extraPaise,
      totalAmountPaise: extraPaise,
    });
  }

  await writeAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: "RESERVATION_EXTENDED",
    entityType: "RESERVATION",
    entityId: existing.id,
    beforeState: { endTime: existing.endTime, totalEstimatedPaise: existing.totalEstimatedPaise },
    afterState: { endTime: newEndTime, totalEstimatedPaise: newPrice.totalEstimatedPaise },
  });

  return { reservation: updated, extraPaise, price: newPrice };
}

export async function cancelReservation(
  user: SessionUser,
  reservationId: string,
  reason: string
) {
  const { db } = await ensureDatabaseReady();

  const [existing] = await db
    .select()
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .limit(1);

  if (!existing) {
    throw new AppError(404, "NOT_FOUND", "Reservation not found");
  }
  await assertReservationReadAccess(user, existing);
  assertValidReservationTransition(existing.status, "CANCELLED");

  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(reservations)
      .set({
        status: "CANCELLED",
        cancelledAt: now,
        cancellationReason: reason,
        updatedAt: now,
      })
      .where(eq(reservations.id, existing.id))
      .returning();

    if (existing.parkingSpaceId) {
      await tx
        .update(parkingSpaces)
        .set({ status: "AVAILABLE", statusUpdatedAt: now })
        .where(
          and(
            eq(parkingSpaces.id, existing.parkingSpaceId),
            inArray(parkingSpaces.status, ["HELD", "RESERVED"])
          )
        );
    }
    if (existing.connectorId) {
      await tx
        .update(connectors)
        .set({ status: "AVAILABLE", statusUpdatedAt: now })
        .where(
          and(
            eq(connectors.id, existing.connectorId),
            inArray(connectors.status, ["HELD", "RESERVED"])
          )
        );
    }

    // Check captured payment for eligible refund
    const [capturedPayment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.reservationId, existing.id), eq(payments.status, "CAPTURED")))
      .limit(1);

    let refundRecord: typeof refunds.$inferSelect | null = null;
    let refundPolicyNote = "No payment captured; hold released.";

    if (capturedPayment) {
      const calc = computeCancellationRefundPaise({
        paidAmountPaise: capturedPayment.amountPaise,
        startTime: existing.startTime,
        cancelledAt: now,
        operatorFault:
          user.role === "PARKING_OPERATOR" ||
          user.role === "EV_OPERATOR" ||
          user.role === "SUPER_ADMIN",
      });
      refundPolicyNote = calc.policyNote;

      if (calc.refundPaise > 0) {
        const [rf] = await tx
          .insert(refunds)
          .values({
            paymentId: capturedPayment.id,
            reservationId: existing.id,
            gatewayRefundId: `rfnd_sandbox_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            amountPaise: calc.refundPaise,
            currency: capturedPayment.currency,
            reason,
            status: "PROCESSED",
            initiatedByUserId: user.id,
            processedAt: now,
          })
          .returning();

        refundRecord = rf ?? null;

        await tx
          .update(payments)
          .set({
            status:
              calc.refundPaise >= capturedPayment.amountPaise
                ? "REFUNDED"
                : "PARTIALLY_REFUNDED",
          })
          .where(eq(payments.id, capturedPayment.id));
      }
    }

    await tx.insert(notifications).values({
      userId: existing.userId,
      type: "RESERVATION_CANCELLED",
      title: `Booking ${existing.bookingReference} Cancelled`,
      body: refundRecord
        ? `Cancelled. Refund of INR ${(refundRecord.amountPaise / 100).toFixed(2)} processed.`
        : refundPolicyNote,
    });

    return { reservation: updated, refund: refundRecord, refundPolicyNote };
  });

  await writeAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: "RESERVATION_CANCELLED",
    entityType: "RESERVATION",
    entityId: existing.id,
    beforeState: { status: existing.status },
    afterState: { status: "CANCELLED", refundId: result.refund?.id ?? null },
  });

  publishPlatformEvent({
    type: "RESERVATION_UPDATED",
    facilityId: existing.facilityId,
    userId: existing.userId,
    source: "RESERVATION_ENGINE",
    payload: { reservationId: existing.id, status: "CANCELLED" },
  });

  return result;
}

export async function validateQrAndCheckIn(params: {
  actor: SessionUser;
  qrToken?: string;
  bookingReference?: string;
  facilityId?: string;
}) {
  const { db } = await ensureDatabaseReady();

  let targetReservation: typeof reservations.$inferSelect | undefined;

  if (params.qrToken) {
    const parsed = verifyQrPayload(params.qrToken);
    if (!parsed) {
      throw new AppError(400, "INVALID_QR_SIGNATURE", "QR code signature verification failed");
    }
    const [row] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, parsed.reservationId))
      .limit(1);
    targetReservation = row;
  } else if (params.bookingReference) {
    const [row] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.bookingReference, params.bookingReference.trim().toUpperCase()))
      .limit(1);
    targetReservation = row;
  } else {
    throw new AppError(400, "QR_OR_REF_REQUIRED", "Provide a QR token or booking reference");
  }

  if (!targetReservation) {
    throw new AppError(404, "RESERVATION_NOT_FOUND", "Booking not found");
  }

  // Server-side ownership check: operator must manage this facility (or customer checking self in? Only operators/admins validate gate QR)
  await assertFacilityAccess(params.actor, targetReservation.facilityId);
  if (params.facilityId && params.facilityId !== targetReservation.facilityId) {
    throw new AppError(400, "WRONG_FACILITY", "QR code belongs to a different facility");
  }

  assertValidReservationTransition(targetReservation.status, "CHECKED_IN");

  // Also ensure payment was captured
  const [captured] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, targetReservation.id), eq(payments.status, "CAPTURED")))
    .limit(1);

  if (!captured) {
    throw new AppError(402, "PAYMENT_REQUIRED", "Reservation does not have a verified payment");
  }

  const now = new Date();

  const session = await db.transaction(async (tx) => {
    await tx
      .update(reservations)
      .set({ status: "CHECKED_IN", checkedInAt: now, updatedAt: now })
      .where(eq(reservations.id, targetReservation.id));

    if (targetReservation.parkingSpaceId) {
      await tx
        .update(parkingSpaces)
        .set({ status: "OCCUPIED", statusUpdatedAt: now })
        .where(eq(parkingSpaces.id, targetReservation.parkingSpaceId));
    }

    const [ps] = await tx
      .insert(parkingSessions)
      .values({
        reservationId: targetReservation.id,
        facilityId: targetReservation.facilityId,
        parkingSpaceId: targetReservation.parkingSpaceId,
        userId: targetReservation.userId,
        checkedInByUserId: params.actor.id,
        status: "ACTIVE",
        entryTime: now,
      })
      .returning();

    await tx.insert(notifications).values({
      userId: targetReservation.userId,
      type: "CHECKED_IN",
      title: `Checked in — ${targetReservation.bookingReference}`,
      body: "Gate QR validated. Your parking session is now active.",
    });

    return ps;
  });

  await writeAuditLog({
    actorUserId: params.actor.id,
    actorRole: params.actor.role,
    action: "GATE_QR_CHECK_IN",
    entityType: "RESERVATION",
    entityId: targetReservation.id,
    afterState: { sessionId: session?.id, checkedInAt: now.toISOString() },
  });

  publishPlatformEvent({
    type: "AVAILABILITY_CHANGED",
    facilityId: targetReservation.facilityId,
    source: "GATE_CHECK_IN",
    payload: {
      reservationId: targetReservation.id,
      parkingSpaceId: targetReservation.parkingSpaceId,
      status: "OCCUPIED",
    },
  });

  return { reservationId: targetReservation.id, bookingReference: targetReservation.bookingReference, session };
}

export async function checkOutParkingSession(params: {
  actor: SessionUser;
  reservationId: string;
}) {
  const { db } = await ensureDatabaseReady();

  const [res] = await db
    .select()
    .from(reservations)
    .where(eq(reservations.id, params.reservationId))
    .limit(1);

  if (!res) {
    throw new AppError(404, "NOT_FOUND", "Reservation not found");
  }

  await assertFacilityAccess(params.actor, res.facilityId);
  if (!["CHECKED_IN", "ACTIVE"].includes(res.status)) {
    throw new AppError(409, "NOT_CHECKED_IN", "Reservation is not currently checked in");
  }

  const now = new Date();
  const graceMinutes = 15;
  const overstayRaw = Math.max(0, Math.round((now.getTime() - res.endTime.getTime()) / 60_000));
  const overstayMinutes = overstayRaw > graceMinutes ? overstayRaw - graceMinutes : 0;
  // Overstay fee: INR 1.50/min (150 paise/min)
  const overstayFeePaise = overstayMinutes * 150;
  const finalAmountPaise = res.totalEstimatedPaise + overstayFeePaise;

  const updated = await db.transaction(async (tx) => {
    const [updatedRes] = await tx
      .update(reservations)
      .set({
        status: "COMPLETED",
        checkedOutAt: now,
        finalAmountPaise,
        updatedAt: now,
      })
      .where(eq(reservations.id, res.id))
      .returning();

    await tx
      .update(parkingSessions)
      .set({
        status: "COMPLETED",
        exitTime: now,
        overstayMinutes,
        overstayFeePaise,
        reconciledAmountPaise: finalAmountPaise,
      })
      .where(eq(parkingSessions.reservationId, res.id));

    if (res.parkingSpaceId) {
      await tx
        .update(parkingSpaces)
        .set({ status: "AVAILABLE", statusUpdatedAt: now })
        .where(eq(parkingSpaces.id, res.parkingSpaceId));
    }

    if (res.connectorId) {
      await tx
        .update(connectors)
        .set({ status: "AVAILABLE", statusUpdatedAt: now })
        .where(
          and(
            eq(connectors.id, res.connectorId),
            inArray(connectors.status, ["HELD", "RESERVED", "CHARGING"])
          )
        );
    }

    if (overstayFeePaise > 0) {
      await tx.insert(reservationItems).values({
        reservationId: res.id,
        itemType: "OVERSTAY_FEE",
        description: `Overstay charge (${overstayMinutes} min after ${graceMinutes}m grace)`,
        quantity: overstayMinutes,
        unitAmountPaise: 150,
        totalAmountPaise: overstayFeePaise,
      });
    }

    await tx.insert(notifications).values({
      userId: res.userId,
      type: "SESSION_COMPLETED",
      title: `Session Completed — ${res.bookingReference}`,
      body: `Final reconciled total: INR ${(finalAmountPaise / 100).toFixed(2)}.`,
    });

    return updatedRes;
  });

  publishPlatformEvent({
    type: "AVAILABILITY_CHANGED",
    facilityId: res.facilityId,
    source: "GATE_CHECK_OUT",
    payload: {
      reservationId: res.id,
      parkingSpaceId: res.parkingSpaceId,
      status: "AVAILABLE",
    },
  });

  return {
    reservation: updated,
    overstayMinutes,
    overstayFeePaise,
    finalAmountPaise,
  };
}
