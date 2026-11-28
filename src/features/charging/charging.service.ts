import { z } from "zod";
import { and, desc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import {
  availabilityEvents,
  chargingSessions,
  chargingStations,
  connectors,
  facilities,
  notifications,
  reservations,
  vehicles,
} from "@/db/schema";
import { AppError } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { publishPlatformEvent } from "@/lib/events";
import { expireStaleHolds } from "@/features/availability/availability.service";

/**
 * Provider Adapter Interface for future OCPP 1.6J / 2.0.1 or external CPO APIs.
 * Currently backed by InternalSimulatedChargeProvider with explicit isSimulated=true disclosure.
 */
export interface EvChargerProviderAdapter {
  readonly providerName: string;
  readonly isSimulated: boolean;
  remoteStartTransaction(input: {
    ocppIdentity: string;
    connectorNumber: number;
    targetKwh: number;
  }): Promise<{ externalSessionRef: string; accepted: boolean }>;
  remoteStopTransaction(input: {
    externalSessionRef: string;
  }): Promise<{ accepted: boolean }>;
}

class InternalSimulatedChargeProvider implements EvChargerProviderAdapter {
  readonly providerName = "INTERNAL_SIMULATED_OCPP";
  readonly isSimulated = true;

  async remoteStartTransaction(input: {
    ocppIdentity: string;
    connectorNumber: number;
    targetKwh: number;
  }) {
    return {
      externalSessionRef: `SIM-${input.ocppIdentity}-C${input.connectorNumber}-${Date.now()}`,
      accepted: true,
    };
  }

  async remoteStopTransaction() {
    return { accepted: true };
  }
}

const chargeProvider: EvChargerProviderAdapter = new InternalSimulatedChargeProvider();

export const startChargingSchema = z.object({
  connectorId: z.string().uuid(),
  reservationId: z.string().uuid().optional().nullable(),
  vehicleId: z.string().uuid().optional().nullable(),
  targetKwh: z.number().min(1).max(150).default(20),
});

export async function startChargingSession(
  user: SessionUser,
  input: z.infer<typeof startChargingSchema>
) {
  const { db } = await ensureDatabaseReady();

  const [connector] = await db
    .select()
    .from(connectors)
    .where(eq(connectors.id, input.connectorId))
    .limit(1);

  if (!connector) {
    throw new AppError(404, "CONNECTOR_NOT_FOUND", "Charging connector not found");
  }
  if (connector.status === "FAULTED" || connector.status === "OFFLINE") {
    throw new AppError(
      409,
      "CONNECTOR_FAULTED",
      `Connector is ${connector.status}${connector.faultReason ? `: ${connector.faultReason}` : ""}`
    );
  }
  if (connector.status === "CHARGING") {
    throw new AppError(409, "CONNECTOR_BUSY", "Connector is already in an active charging session");
  }

  // Vehicle compatibility check when vehicleId supplied
  if (input.vehicleId) {
    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, input.vehicleId), eq(vehicles.userId, user.id)))
      .limit(1);

    if (!vehicle) {
      throw new AppError(404, "VEHICLE_NOT_FOUND", "Vehicle not found");
    }
    if (!vehicle.isElectric) {
      throw new AppError(400, "NON_EV_VEHICLE", "Selected vehicle is not an electric vehicle");
    }
    if (
      vehicle.supportedConnector &&
      vehicle.supportedConnector !== connector.standard
    ) {
      throw new AppError(
        400,
        "INCOMPATIBLE_CONNECTOR",
        `Vehicle supports ${vehicle.supportedConnector}, but connector is ${connector.standard}`
      );
    }
  }

  if (input.reservationId) {
    const [res] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, input.reservationId))
      .limit(1);
    if (!res) throw new AppError(404, "RESERVATION_NOT_FOUND", "Reservation not found");
    if (res.userId !== user.id && user.role !== "SUPER_ADMIN") {
      throw new AppError(403, "FORBIDDEN", "Not your reservation");
    }
  }

  const [station] = await db
    .select()
    .from(chargingStations)
    .where(eq(chargingStations.id, connector.stationId))
    .limit(1);

  if (!station) {
    throw new AppError(404, "STATION_NOT_FOUND", "Charging station not found");
  }

  const remote = await chargeProvider.remoteStartTransaction({
    ocppIdentity: station.ocppIdentity ?? station.id,
    connectorNumber: connector.connectorNumber,
    targetKwh: input.targetKwh,
  });

  const now = new Date();
  const initialKw = Math.round(connector.maxPowerKw * 0.82 * 10) / 10;

  const session = await db.transaction(async (tx) => {
    await tx
      .update(connectors)
      .set({ status: "CHARGING", statusUpdatedAt: now })
      .where(eq(connectors.id, connector.id));

    if (input.reservationId) {
      await tx
        .update(reservations)
        .set({ status: "ACTIVE", updatedAt: now })
        .where(eq(reservations.id, input.reservationId));
    }

    const [created] = await tx
      .insert(chargingSessions)
      .values({
        reservationId: input.reservationId ?? null,
        facilityId: connector.facilityId,
        stationId: station.id,
        connectorId: connector.id,
        userId: user.id,
        status: "ACTIVE",
        isSimulated: chargeProvider.isSimulated,
        externalSessionRef: remote.externalSessionRef,
        targetKwh: input.targetKwh,
        energyDeliveredKwh: 0.4,
        averagePowerKw: initialKw,
        sessionFeePaise: connector.sessionFeePaise,
        energyCostPaise: Math.round(0.4 * connector.pricePerKwhPaise),
        taxPaise: Math.round(
          (connector.sessionFeePaise + Math.round(0.4 * connector.pricePerKwhPaise)) * 0.18
        ),
        totalCostPaise: Math.round(
          (connector.sessionFeePaise + Math.round(0.4 * connector.pricePerKwhPaise)) * 1.18
        ),
        startedAt: now,
        telemetryLog: [
          {
            ts: now.toISOString(),
            kw: initialKw,
            kwh: 0.4,
            socPct: 24,
          },
        ],
      })
      .returning();

    await tx.insert(availabilityEvents).values({
      facilityId: connector.facilityId,
      resourceType: "CONNECTOR",
      resourceId: connector.id,
      previousStatus: connector.status,
      newStatus: "CHARGING",
      source: "EV_SIMULATOR",
    });

    return created;
  });

  publishPlatformEvent({
    type: "CHARGING_TELEMETRY",
    facilityId: connector.facilityId,
    userId: user.id,
    source: "EV_SIMULATOR",
    payload: {
      sessionId: session?.id,
      connectorId: connector.id,
      status: "ACTIVE",
      isSimulated: true,
      energyDeliveredKwh: 0.4,
      kw: initialKw,
    },
  });

  return {
    session,
    disclosure:
      "Simulated OCPP Demo Mode: no physical charger hardware is connected; energy telemetry is generated by InternalSimulatedChargeProvider.",
  };
}

export async function advanceSimulatedChargingSession(params: {
  user: SessionUser;
  sessionId: string;
  kwhIncrement?: number;
  idleMinutesIncrement?: number;
}) {
  const { db } = await ensureDatabaseReady();

  const [session] = await db
    .select()
    .from(chargingSessions)
    .where(eq(chargingSessions.id, params.sessionId))
    .limit(1);

  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "Charging session not found");
  if (session.userId !== params.user.id && params.user.role === "CUSTOMER") {
    throw new AppError(403, "FORBIDDEN", "Cannot modify another user's charging session");
  }
  if (session.status !== "ACTIVE") {
    throw new AppError(409, "SESSION_NOT_ACTIVE", "Charging session is not active");
  }

  const [connector] = await db
    .select()
    .from(connectors)
    .where(eq(connectors.id, session.connectorId))
    .limit(1);

  if (!connector) throw new AppError(404, "CONNECTOR_NOT_FOUND", "Connector not found");

  const deltaKwh = params.kwhIncrement ?? Math.min(5, Math.max(1, connector.maxPowerKw / 12));
  const nextKwh = Math.min(
    session.targetKwh,
    Math.round((session.energyDeliveredKwh + deltaKwh) * 100) / 100
  );
  const nextIdle = session.idleMinutes + (params.idleMinutesIncrement ?? 0);
  const powerKw = Math.round(connector.maxPowerKw * (0.76 + Math.random() * 0.14) * 10) / 10;

  const energyCostPaise = Math.round(nextKwh * connector.pricePerKwhPaise);
  const idleFeePaise = nextIdle * connector.idleFeePerMinPaise;
  const subtotal = energyCostPaise + connector.sessionFeePaise + idleFeePaise;
  const taxPaise = Math.round(subtotal * 0.18);
  const totalCostPaise = subtotal + taxPaise;

  const socPct = Math.min(98, Math.round(24 + (nextKwh / Math.max(1, session.targetKwh)) * 70));
  const nextLog = [
    ...(session.telemetryLog ?? []),
    {
      ts: new Date().toISOString(),
      kw: nextKwh >= session.targetKwh ? 0 : powerKw,
      kwh: nextKwh,
      socPct,
    },
  ].slice(-30);

  const [updated] = await db
    .update(chargingSessions)
    .set({
      energyDeliveredKwh: nextKwh,
      averagePowerKw: powerKw,
      idleMinutes: nextIdle,
      energyCostPaise,
      idleFeePaise,
      taxPaise,
      totalCostPaise,
      telemetryLog: nextLog,
    })
    .where(eq(chargingSessions.id, session.id))
    .returning();

  publishPlatformEvent({
    type: "CHARGING_TELEMETRY",
    facilityId: session.facilityId,
    userId: session.userId,
    source: "EV_SIMULATOR",
    payload: {
      sessionId: session.id,
      connectorId: session.connectorId,
      energyDeliveredKwh: nextKwh,
      totalCostPaise,
      socPct,
    },
  });

  return { session: updated, socPct };
}

export async function stopChargingSession(params: {
  user: SessionUser;
  sessionId: string;
}) {
  const { db } = await ensureDatabaseReady();

  const [session] = await db
    .select()
    .from(chargingSessions)
    .where(eq(chargingSessions.id, params.sessionId))
    .limit(1);

  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "Charging session not found");
  if (session.userId !== params.user.id && params.user.role === "CUSTOMER") {
    throw new AppError(403, "FORBIDDEN", "Cannot stop another user's charging session");
  }
  if (session.status !== "ACTIVE") {
    throw new AppError(409, "SESSION_NOT_ACTIVE", "Charging session already ended");
  }

  await chargeProvider.remoteStopTransaction({
    externalSessionRef: session.externalSessionRef ?? session.id,
  });

  const now = new Date();
  const ended = await db.transaction(async (tx) => {
    const [updatedSession] = await tx
      .update(chargingSessions)
      .set({ status: "COMPLETED", endedAt: now })
      .where(eq(chargingSessions.id, session.id))
      .returning();

    await tx
      .update(connectors)
      .set({ status: "AVAILABLE", statusUpdatedAt: now })
      .where(eq(connectors.id, session.connectorId));

    if (session.reservationId) {
      await tx
        .update(reservations)
        .set({
          status: "COMPLETED",
          checkedOutAt: now,
          finalAmountPaise: session.totalCostPaise,
          updatedAt: now,
        })
        .where(eq(reservations.id, session.reservationId));
    }

    await tx.insert(availabilityEvents).values({
      facilityId: session.facilityId,
      resourceType: "CONNECTOR",
      resourceId: session.connectorId,
      previousStatus: "CHARGING",
      newStatus: "AVAILABLE",
      source: "EV_SIMULATOR",
    });

    await tx.insert(notifications).values({
      userId: session.userId,
      type: "CHARGING_COMPLETED",
      title: "EV Charging Session Completed",
      body: `Delivered ${session.energyDeliveredKwh} kWh. Final bill: INR ${(session.totalCostPaise / 100).toFixed(2)}.`,
    });

    return updatedSession;
  });

  await writeAuditLog({
    actorUserId: params.user.id,
    actorRole: params.user.role,
    action: "EV_SESSION_STOPPED",
    entityType: "CHARGING_SESSION",
    entityId: session.id,
    afterState: {
      energyDeliveredKwh: session.energyDeliveredKwh,
      totalCostPaise: session.totalCostPaise,
    },
  });

  publishPlatformEvent({
    type: "AVAILABILITY_CHANGED",
    facilityId: session.facilityId,
    source: "EV_SIMULATOR",
    payload: {
      resourceType: "CONNECTOR",
      resourceId: session.connectorId,
      newStatus: "AVAILABLE",
    },
  });

  return ended;
}

export async function listUserChargingSessions(userId: string) {
  const { db } = await ensureDatabaseReady();
  return db
    .select()
    .from(chargingSessions)
    .where(eq(chargingSessions.userId, userId))
    .orderBy(desc(chargingSessions.startedAt));
}

export async function listEvPumpsWithAvailability(params?: {
  startTime?: string;
  endTime?: string;
  standard?: string;
  minKw?: number;
  q?: string;
}) {
  await expireStaleHolds();
  const { db } = await ensureDatabaseReady();
  if (process.env.VITEST !== "true") {
    const { ensureDemoEvOwnerAccount } = await import("@/db/demo-ev-owner");
    await ensureDemoEvOwnerAccount(db);
  }

  const start = params?.startTime
    ? new Date(params.startTime)
    : new Date(Date.now() + 15 * 60_000);
  const end = params?.endTime
    ? new Date(params.endTime)
    : new Date(start.getTime() + 2 * 3600_000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new AppError(400, "INVALID_WINDOW", "End time must be after start time");
  }

  const activeFacs = await db
    .select()
    .from(facilities)
    .where(
      and(
        eq(facilities.status, "ACTIVE"),
        eq(facilities.hasEvCharging, true),
        isNull(facilities.deletedAt)
      )
    );

  if (activeFacs.length === 0) {
    return {
      window: { startTime: start.toISOString(), endTime: end.toISOString() },
      pumps: [],
    };
  }

  const facIds = activeFacs.map((f) => f.id);
  const [stationRows, connectorRows, overlappingRes] = await Promise.all([
    db.select().from(chargingStations).where(inArray(chargingStations.facilityId, facIds)),
    db.select().from(connectors).where(inArray(connectors.facilityId, facIds)),
    db
      .select()
      .from(reservations)
      .where(
        and(
          inArray(reservations.facilityId, facIds),
          inArray(reservations.status, [
            "PENDING_PAYMENT",
            "CONFIRMED",
            "CHECKED_IN",
            "ACTIVE",
          ]),
          lt(reservations.startTime, end),
          gt(reservations.endTime, start)
        )
      ),
  ]);

  const busyConnectorIds = new Set(
    overlappingRes.map((r) => r.connectorId).filter((id): id is string => Boolean(id))
  );

  const isNearTerm = Math.abs(start.getTime() - Date.now()) <= 15 * 60_000;
  const facMap = new Map(activeFacs.map((f) => [f.id, f]));
  const queryText = params?.q?.trim().toLowerCase();

  const pumps = stationRows
    .map((station) => {
      const fac = facMap.get(station.facilityId);
      if (!fac) return null;

      if (queryText) {
        const hay = `${station.name} ${fac.name} ${fac.addressLine1} ${fac.city} ${station.ocppIdentity}`.toLowerCase();
        if (!hay.includes(queryText)) return null;
      }

      const guns = connectorRows
        .filter((c) => c.stationId === station.id)
        .filter((c) => {
          if (params?.standard && params.standard !== "ALL" && c.standard !== params.standard) {
            return false;
          }
          if (params?.minKw && c.maxPowerKw < params.minKw) {
            return false;
          }
          return true;
        })
        .map((c) => {
          const isOperational = c.status !== "FAULTED" && c.status !== "OFFLINE";
          const busyImmediate = isNearTerm && (c.status === "CHARGING" || c.status === "HELD");
          const isAvailableForWindow =
            isOperational && !busyImmediate && !busyConnectorIds.has(c.id);

          return {
            id: c.id,
            connectorNumber: c.connectorNumber,
            standard: c.standard,
            currentType: c.currentType,
            maxPowerKw: c.maxPowerKw,
            status: c.status,
            faultReason: c.faultReason,
            pricePerKwhPaise: c.pricePerKwhPaise,
            sessionFeePaise: c.sessionFeePaise,
            idleFeePerMinPaise: c.idleFeePerMinPaise,
            isAvailableForWindow,
          };
        });

      if (guns.length === 0) return null;

      return {
        stationId: station.id,
        stationName: station.name,
        ocppIdentity: station.ocppIdentity,
        networkProvider: station.networkProvider,
        isSimulated: station.isSimulated,
        facilityId: fac.id,
        facilitySlug: fac.slug,
        facilityName: fac.name,
        addressLine1: fac.addressLine1,
        city: fac.city,
        dataSourceType: fac.dataSourceType,
        is24Hours: fac.is24Hours,
        amenities: fac.amenities,
        freeCount: guns.filter((g) => g.isAvailableForWindow).length,
        totalCount: guns.length,
        connectors: guns,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return {
    window: { startTime: start.toISOString(), endTime: end.toISOString() },
    pumps,
  };
}
