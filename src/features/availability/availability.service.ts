import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import {
  availabilityEvents,
  chargingStations,
  connectors,
  facilities,
  parkingSpaces,
  parkingZones,
  reservations,
} from "@/db/schema";
import { AppError } from "@/lib/api-response";
import { publishPlatformEvent } from "@/lib/events";

const ACTIVE_BOOKING_STATUSES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CHECKED_IN",
  "ACTIVE",
] as const;

export async function expireStaleHolds(): Promise<number> {
  const { db } = await ensureDatabaseReady();
  const now = new Date();

  const expired = await db
    .update(reservations)
    .set({
      status: "EXPIRED",
      updatedAt: now,
    })
    .where(
      and(
        eq(reservations.status, "PENDING_PAYMENT"),
        lt(reservations.holdExpiresAt, now)
      )
    )
    .returning();

  for (const row of expired) {
    if (row.parkingSpaceId) {
      await db
        .update(parkingSpaces)
        .set({ status: "AVAILABLE", statusUpdatedAt: now })
        .where(
          and(eq(parkingSpaces.id, row.parkingSpaceId), eq(parkingSpaces.status, "HELD"))
        );
    }
    if (row.connectorId) {
      await db
        .update(connectors)
        .set({ status: "AVAILABLE", statusUpdatedAt: now })
        .where(and(eq(connectors.id, row.connectorId), eq(connectors.status, "HELD")));
    }

    await db.insert(availabilityEvents).values({
      facilityId: row.facilityId,
      resourceType: row.parkingSpaceId ? "PARKING_SPACE" : "CONNECTOR",
      resourceId: row.parkingSpaceId ?? row.connectorId ?? row.facilityId,
      previousStatus: "HELD",
      newStatus: "AVAILABLE",
      source: "HOLD_EXPIRY_JOB",
    });

    publishPlatformEvent({
      type: "AVAILABILITY_CHANGED",
      facilityId: row.facilityId,
      source: "HOLD_EXPIRY_JOB",
      payload: {
        reservationId: row.id,
        reason: "HOLD_EXPIRED",
      },
    });
  }

  return expired.length;
}

export async function getFacilityAvailability(params: {
  facilityId: string;
  startTime?: Date;
  endTime?: Date;
}) {
  await expireStaleHolds();
  const { db } = await ensureDatabaseReady();

  const [facility] = await db
    .select()
    .from(facilities)
    .where(eq(facilities.id, params.facilityId))
    .limit(1);

  if (!facility || facility.deletedAt) {
    throw new AppError(404, "NOT_FOUND", "Facility not found");
  }

  const now = new Date();
  const windowStart = params.startTime ?? now;
  const windowEnd = params.endTime ?? new Date(windowStart.getTime() + 60 * 60 * 1000);

  const zones = await db
    .select()
    .from(parkingZones)
    .where(eq(parkingZones.facilityId, facility.id));

  const spaces = await db
    .select()
    .from(parkingSpaces)
    .where(and(eq(parkingSpaces.facilityId, facility.id), eq(parkingSpaces.isActive, true)));

  const stations = await db
    .select()
    .from(chargingStations)
    .where(eq(chargingStations.facilityId, facility.id));

  const facilityConnectors = await db
    .select()
    .from(connectors)
    .where(eq(connectors.facilityId, facility.id));

  // Find reservations overlapping [windowStart, windowEnd)
  const overlapping = await db
    .select({
      parkingSpaceId: reservations.parkingSpaceId,
      connectorId: reservations.connectorId,
      status: reservations.status,
      startTime: reservations.startTime,
      endTime: reservations.endTime,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.facilityId, facility.id),
        inArray(reservations.status, [...ACTIVE_BOOKING_STATUSES]),
        lt(reservations.startTime, windowEnd),
        gt(reservations.endTime, windowStart)
      )
    );

  const busySpaceIds = new Set(
    overlapping.map((o) => o.parkingSpaceId).filter((v): v is string => Boolean(v))
  );
  const busyConnectorIds = new Set(
    overlapping.map((o) => o.connectorId).filter((v): v is string => Boolean(v))
  );

  const isImmediateWindow =
    Math.abs(windowStart.getTime() - now.getTime()) <= 15 * 60 * 1000;

  const spacesWithAvailability = spaces.map((sp) => {
    const blockedByState =
      sp.status === "OUT_OF_SERVICE" ||
      (isImmediateWindow && (sp.status === "OCCUPIED" || sp.status === "HELD"));
    const blockedByWindow = busySpaceIds.has(sp.id);
    const availableForWindow = !blockedByState && !blockedByWindow;

    return {
      ...sp,
      availableForWindow,
      effectiveStatus: blockedByState
        ? sp.status
        : blockedByWindow
          ? "RESERVED"
          : "AVAILABLE",
    };
  });

  const connectorsWithAvailability = facilityConnectors.map((conn) => {
    const blockedByState =
      conn.status === "FAULTED" ||
      conn.status === "OFFLINE" ||
      (isImmediateWindow && (conn.status === "CHARGING" || conn.status === "HELD"));
    const blockedByWindow = busyConnectorIds.has(conn.id);
    const availableForWindow = !blockedByState && !blockedByWindow;

    return {
      ...conn,
      availableForWindow,
      effectiveStatus: blockedByState
        ? conn.status
        : blockedByWindow
          ? "RESERVED"
          : "AVAILABLE",
    };
  });

  const availableSpaceCount = spacesWithAvailability.filter((s) => s.availableForWindow).length;
  const availableConnectorCount = connectorsWithAvailability.filter(
    (c) => c.availableForWindow
  ).length;

  const freshnessMs = now.getTime() - new Date(facility.availabilityUpdatedAt).getTime();
  const isStale = freshnessMs > 15 * 60 * 1000;

  return {
    facilityId: facility.id,
    dataSourceType: facility.dataSourceType,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    availabilityUpdatedAt: facility.availabilityUpdatedAt,
    isStale,
    summary: {
      totalSpaces: spaces.length,
      availableSpaces: availableSpaceCount,
      occupiedSpaces: spacesWithAvailability.filter((s) => !s.availableForWindow).length,
      outOfServiceSpaces: spaces.filter((s) => s.status === "OUT_OF_SERVICE").length,
      totalConnectors: facilityConnectors.length,
      availableConnectors: availableConnectorCount,
      faultedConnectors: facilityConnectors.filter((c) => c.status === "FAULTED").length,
    },
    zones,
    spaces: spacesWithAvailability,
    stations,
    connectors: connectorsWithAvailability,
  };
}

export async function updateParkingSpaceStatus(params: {
  facilityId: string;
  spaceId: string;
  status: "AVAILABLE" | "OCCUPIED" | "OUT_OF_SERVICE" | "RESERVED";
  source?: string;
}) {
  const { db } = await ensureDatabaseReady();
  const [existing] = await db
    .select()
    .from(parkingSpaces)
    .where(and(eq(parkingSpaces.id, params.spaceId), eq(parkingSpaces.facilityId, params.facilityId)))
    .limit(1);

  if (!existing) {
    throw new AppError(404, "SPACE_NOT_FOUND", "Parking space not found");
  }

  const now = new Date();
  const [updated] = await db
    .update(parkingSpaces)
    .set({ status: params.status, statusUpdatedAt: now })
    .where(eq(parkingSpaces.id, existing.id))
    .returning();

  await db
    .update(facilities)
    .set({ availabilityUpdatedAt: now, updatedAt: now })
    .where(eq(facilities.id, params.facilityId));

  await db.insert(availabilityEvents).values({
    facilityId: params.facilityId,
    resourceType: "PARKING_SPACE",
    resourceId: existing.id,
    previousStatus: existing.status,
    newStatus: params.status,
    source: params.source ?? "OPERATOR",
  });

  publishPlatformEvent({
    type: "AVAILABILITY_CHANGED",
    facilityId: params.facilityId,
    source: params.source ?? "OPERATOR",
    payload: {
      resourceType: "PARKING_SPACE",
      resourceId: existing.id,
      code: existing.code,
      previousStatus: existing.status,
      newStatus: params.status,
    },
  });

  return updated;
}

export async function updateConnectorStatus(params: {
  facilityId: string;
  connectorId: string;
  status: "AVAILABLE" | "CHARGING" | "FAULTED" | "OFFLINE" | "RESERVED";
  faultReason?: string | null;
  source?: string;
}) {
  const { db } = await ensureDatabaseReady();
  const [existing] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.id, params.connectorId), eq(connectors.facilityId, params.facilityId)))
    .limit(1);

  if (!existing) {
    throw new AppError(404, "CONNECTOR_NOT_FOUND", "Connector not found");
  }

  const now = new Date();
  const [updated] = await db
    .update(connectors)
    .set({
      status: params.status,
      faultReason: params.status === "FAULTED" ? (params.faultReason ?? "Reported fault") : null,
      statusUpdatedAt: now,
    })
    .where(eq(connectors.id, existing.id))
    .returning();

  await db
    .update(facilities)
    .set({ availabilityUpdatedAt: now, updatedAt: now })
    .where(eq(facilities.id, params.facilityId));

  await db.insert(availabilityEvents).values({
    facilityId: params.facilityId,
    resourceType: "CONNECTOR",
    resourceId: existing.id,
    previousStatus: existing.status,
    newStatus: params.status,
    source: params.source ?? "OPERATOR",
  });

  publishPlatformEvent({
    type: "AVAILABILITY_CHANGED",
    facilityId: params.facilityId,
    source: params.source ?? "OPERATOR",
    payload: {
      resourceType: "CONNECTOR",
      resourceId: existing.id,
      standard: existing.standard,
      previousStatus: existing.status,
      newStatus: params.status,
      faultReason: updated?.faultReason ?? null,
    },
  });

  return updated;
}

export async function simulateCityAvailabilityPulse(): Promise<{
  updatedCount: number;
  changes: Array<{ facilityId: string; resourceType: string; code: string; status: string }>;
}> {
  const { db } = await ensureDatabaseReady();
  const activeFacilities = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(eq(facilities.status, "ACTIVE"));

  const changes: Array<{ facilityId: string; resourceType: string; code: string; status: string }> =
    [];

  for (const f of activeFacilities.slice(0, 3)) {
    const spaces = await db
      .select()
      .from(parkingSpaces)
      .where(
        and(
          eq(parkingSpaces.facilityId, f.id),
          sql`${parkingSpaces.status} IN ('AVAILABLE', 'OCCUPIED')`
        )
      );

    if (spaces.length > 2) {
      const target = spaces[Math.floor(Math.random() * spaces.length)]!;
      const nextStatus = target.status === "AVAILABLE" ? "OCCUPIED" : "AVAILABLE";
      await updateParkingSpaceStatus({
        facilityId: f.id,
        spaceId: target.id,
        status: nextStatus,
        source: "SIMULATOR",
      });
      changes.push({
        facilityId: f.id,
        resourceType: "PARKING_SPACE",
        code: target.code,
        status: nextStatus,
      });
    }
  }

  return { updatedCount: changes.length, changes };
}
