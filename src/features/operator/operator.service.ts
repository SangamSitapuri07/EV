import { z } from "zod";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import {
  chargingSessions,
  chargingStations,
  connectors,
  facilities,
  facilityHours,
  operators,
  parkingSpaces,
  parkingZones,
  payments,
  pricingRules,
  reservations,
  users,
} from "@/db/schema";
import { AppError } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { publishPlatformEvent } from "@/lib/events";
import { assertFacilityAccess, getUserOperatorIds } from "@/lib/permissions";
import { slugify } from "@/lib/utils";

export const createFacilitySchema = z.object({
  name: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(2000),
  facilityType: z.enum([
    "MULTI_LEVEL_GARAGE",
    "SURFACE_LOT",
    "UNDERGROUND",
    "STREET_HUB",
    "DEDICATED_EV_HUB",
    "MALL_COMMERCIAL",
  ]),
  addressLine1: z.string().trim().min(4).max(255),
  landmark: z.string().trim().max(180).optional(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(4).max(20),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  is24Hours: z.boolean().default(true),
  isCovered: z.boolean().default(true),
  hasSecurity: z.boolean().default(true),
  hasAccessibility: z.boolean().default(true),
  hasEvCharging: z.boolean().default(false),
  hourlyRatePaise: z.number().int().min(500).max(200000).default(4000),
  dailyMaxPaise: z.number().int().min(1000).max(1000000).default(24000),
  initialSpacesCount: z.number().int().min(1).max(100).default(6),
  amenities: z.array(z.string()).default(["CCTV 24x7", "QR Gate"]),
});

export async function getOperatorDashboardData(user: SessionUser) {
  const { db } = await ensureDatabaseReady();
  const operatorIds =
    user.role === "SUPER_ADMIN"
      ? (await db.select({ id: operators.id }).from(operators)).map((o) => o.id)
      : await getUserOperatorIds(user.id);

  if (operatorIds.length === 0) {
    return {
      operators: [],
      facilities: [],
      spaces: [],
      connectors: [],
      reservations: [],
      analytics: {
        period: "All-time persisted data",
        totalFacilities: 0,
        totalSpaces: 0,
        availableSpaces: 0,
        occupiedOrReservedSpaces: 0,
        occupancyPct: 0,
        totalConnectors: 0,
        availableConnectors: 0,
        faultedConnectors: 0,
        activeReservations: 0,
        todayBookings: 0,
        grossRevenuePaise: 0,
        chargingEnergyKwh: 0,
        revenueByFacility: [],
        definitions: {
          occupancyPct: "(Occupied + Reserved + Held spaces) / Active spaces * 100",
          grossRevenuePaise: "Sum of captured payment transactions for operator facilities",
        },
      },
    };
  }

  const opRows = await db
    .select()
    .from(operators)
    .where(inArray(operators.id, operatorIds));

  const facRows = await db
    .select()
    .from(facilities)
    .where(and(inArray(facilities.operatorId, operatorIds), isNull(facilities.deletedAt)))
    .orderBy(desc(facilities.createdAt));

  const facIds = facRows.map((f) => f.id);
  if (facIds.length === 0) {
    return {
      operators: opRows,
      facilities: [],
      spaces: [],
      connectors: [],
      reservations: [],
      analytics: {
        period: "All-time persisted data",
        totalFacilities: 0,
        totalSpaces: 0,
        availableSpaces: 0,
        occupiedOrReservedSpaces: 0,
        occupancyPct: 0,
        totalConnectors: 0,
        availableConnectors: 0,
        faultedConnectors: 0,
        activeReservations: 0,
        todayBookings: 0,
        grossRevenuePaise: 0,
        chargingEnergyKwh: 0,
        revenueByFacility: [],
        definitions: {
          occupancyPct: "(Occupied + Reserved + Held spaces) / Active spaces * 100",
          grossRevenuePaise: "Sum of captured payment transactions for operator facilities",
        },
      },
    };
  }

  const [spaceRows, connectorRows, resRows, chargeRows] = await Promise.all([
    db.select().from(parkingSpaces).where(inArray(parkingSpaces.facilityId, facIds)),
    db.select().from(connectors).where(inArray(connectors.facilityId, facIds)),
    db
      .select()
      .from(reservations)
      .where(inArray(reservations.facilityId, facIds))
      .orderBy(desc(reservations.createdAt)),
    db.select().from(chargingSessions).where(inArray(chargingSessions.facilityId, facIds)),
  ]);

  const resIds = resRows.map((r) => r.id);
  const paymentRows =
    resIds.length > 0
      ? await db
          .select()
          .from(payments)
          .where(and(inArray(payments.reservationId, resIds), eq(payments.status, "CAPTURED")))
      : [];

  const availableSpaces = spaceRows.filter((s) => s.status === "AVAILABLE").length;
  const occupiedOrReservedSpaces = spaceRows.filter((s) =>
    ["OCCUPIED", "RESERVED", "HELD"].includes(s.status)
  ).length;
  const occupancyPct =
    spaceRows.length > 0 ? Math.round((occupiedOrReservedSpaces / spaceRows.length) * 100) : 0;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayBookings = resRows.filter((r) => new Date(r.createdAt) >= todayStart).length;
  const activeReservations = resRows.filter((r) =>
    ["CONFIRMED", "CHECKED_IN", "ACTIVE"].includes(r.status)
  ).length;

  const grossRevenuePaise = paymentRows.reduce((sum, p) => sum + p.amountPaise, 0);
  const chargingEnergyKwh =
    Math.round(chargeRows.reduce((sum, c) => sum + c.energyDeliveredKwh, 0) * 100) / 100;

  const resToFac = new Map(resRows.map((r) => [r.id, r.facilityId]));
  const revenueMap = new Map<string, number>();
  for (const p of paymentRows) {
    const fId = resToFac.get(p.reservationId);
    if (fId) {
      revenueMap.set(fId, (revenueMap.get(fId) ?? 0) + p.amountPaise);
    }
  }

  const revenueByFacility = facRows.map((f) => {
    const fSpaces = spaceRows.filter((s) => s.facilityId === f.id);
    const fBusy = fSpaces.filter((s) => s.status !== "AVAILABLE").length;
    return {
      facilityId: f.id,
      name: f.name,
      status: f.status,
      totalSpaces: fSpaces.length,
      occupancyPct: fSpaces.length > 0 ? Math.round((fBusy / fSpaces.length) * 100) : 0,
      revenuePaise: revenueMap.get(f.id) ?? 0,
      bookingsCount: resRows.filter((r) => r.facilityId === f.id).length,
    };
  });

  return {
    operators: opRows,
    facilities: facRows,
    spaces: spaceRows,
    connectors: connectorRows,
    reservations: resRows,
    analytics: {
      period: "All-time persisted transactions & live inventory snapshot",
      totalFacilities: facRows.length,
      totalSpaces: spaceRows.length,
      availableSpaces,
      occupiedOrReservedSpaces,
      occupancyPct,
      totalConnectors: connectorRows.length,
      availableConnectors: connectorRows.filter((c) => c.status === "AVAILABLE").length,
      faultedConnectors: connectorRows.filter((c) => c.status === "FAULTED").length,
      activeReservations,
      todayBookings,
      grossRevenuePaise,
      chargingEnergyKwh,
      revenueByFacility,
      definitions: {
        occupancyPct: "(Occupied + Reserved + Held spaces) / Total spaces * 100",
        grossRevenuePaise: "Sum of verified CAPTURED payment records in paise",
        chargingEnergyKwh: "Sum of energyDeliveredKwh across charging_sessions",
      },
    },
  };
}

export async function createOperatorFacility(
  user: SessionUser,
  input: z.infer<typeof createFacilitySchema>
) {
  const { db } = await ensureDatabaseReady();
  const operatorIds = await getUserOperatorIds(user.id);
  let operatorId = operatorIds[0];

  if (!operatorId && user.role === "SUPER_ADMIN") {
    const [anyOp] = await db.select({ id: operators.id }).from(operators).limit(1);
    operatorId = anyOp?.id;
  }

  if (!operatorId) {
    // Auto-create operator profile if missing for operator role
    const [newOp] = await db
      .insert(operators)
      .values({
        ownerUserId: user.id,
        businessName: `${user.fullName} Mobility Operations`,
        registrationNumber: `REG-${Date.now()}`,
        operatorType: user.role === "EV_OPERATOR" ? "EV_CHARGING" : "PARKING",
        contactEmail: user.email,
        contactPhone: "+91-98000-00000",
        status: "APPROVED",
      })
      .returning();
    operatorId = newOp?.id;
  }

  if (!operatorId) {
    throw new AppError(403, "NO_OPERATOR_PROFILE", "No operator profile linked to user");
  }

  const slug = `${slugify(input.name)}-${Date.now().toString(36).slice(-4)}`;

  const created = await db.transaction(async (tx) => {
    const [fac] = await tx
      .insert(facilities)
      .values({
        operatorId,
        slug,
        name: input.name,
        description: input.description,
        facilityType: input.facilityType,
        status: user.role === "SUPER_ADMIN" ? "ACTIVE" : "PENDING_APPROVAL",
        dataSourceType: "OPERATOR_MANAGED",
        addressLine1: input.addressLine1,
        landmark: input.landmark ?? null,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        latitude: input.latitude,
        longitude: input.longitude,
        is24Hours: input.is24Hours,
        isCovered: input.isCovered,
        hasSecurity: input.hasSecurity,
        hasAccessibility: input.hasAccessibility,
        hasEvCharging: input.hasEvCharging,
        totalCapacity: input.initialSpacesCount,
        amenities: input.amenities,
        photos: ["/images/facility-plaza.svg"],
      })
      .returning();

    if (!fac) throw new AppError(500, "FACILITY_CREATE_FAILED", "Could not create facility");

    const hoursRows = Array.from({ length: 7 }, (_, day) => ({
      facilityId: fac.id,
      dayOfWeek: day,
      openTime: input.is24Hours ? "00:00" : "06:00",
      closeTime: input.is24Hours ? "23:59" : "23:00",
      isClosed: false,
    }));
    await tx.insert(facilityHours).values(hoursRows);

    const [zone] = await tx
      .insert(parkingZones)
      .values({
        facilityId: fac.id,
        name: "Zone A - Main Deck",
        level: "Ground",
        isCovered: input.isCovered,
        supportsIndividualSpaces: true,
        aggregateCapacity: input.initialSpacesCount,
        aggregateAvailable: input.initialSpacesCount,
      })
      .returning();

    if (zone) {
      const spaceRows = Array.from({ length: input.initialSpacesCount }, (_, i) => ({
        facilityId: fac.id,
        zoneId: zone.id,
        code: `A-${String(i + 1).padStart(2, "0")}`,
        category: input.hasEvCharging && i === 0 ? ("EV_COMPATIBLE" as const) : ("STANDARD" as const),
        status: "AVAILABLE" as const,
        isEvCompatible: input.hasEvCharging && i === 0,
        isAccessible: input.hasAccessibility && i === input.initialSpacesCount - 1,
      }));
      await tx.insert(parkingSpaces).values(spaceRows);
    }

    await tx.insert(pricingRules).values({
      facilityId: fac.id,
      name: "Standard Hourly Tariff",
      hourlyRatePaise: input.hourlyRatePaise,
      dailyMaxPaise: input.dailyMaxPaise,
      minBillableMinutes: 60,
      gracePeriodMinutes: 15,
      taxBps: 1800,
    });

    if (input.hasEvCharging) {
      const [station] = await tx
        .insert(chargingStations)
        .values({
          facilityId: fac.id,
          operatorId,
          name: `${input.name} Charger Bank`,
          ocppIdentity: `OCPP-${slug.slice(0, 10).toUpperCase()}`,
          networkProvider: "INTERNAL_SIMULATED",
          isSimulated: true,
        })
        .returning();

      if (station) {
        await tx.insert(connectors).values({
          stationId: station.id,
          facilityId: fac.id,
          connectorNumber: 1,
          standard: "CCS2",
          currentType: "DC",
          maxPowerKw: 60,
          status: "AVAILABLE",
          pricePerKwhPaise: 1800,
          sessionFeePaise: 2500,
        });
      }
    }

    return fac;
  });

  await writeAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: "FACILITY_CREATED",
    entityType: "FACILITY",
    entityId: created.id,
    afterState: { name: created.name, status: created.status },
  });

  return created;
}

export async function addOperatorConnector(
  user: SessionUser,
  facilityId: string,
  input: {
    standard: "CCS2" | "TYPE2_AC" | "CHADEMO" | "BHARAT_DC001" | "BHARAT_AC001" | "GB_T";
    maxPowerKw: number;
    pricePerKwhPaise: number;
  }
) {
  const { facility } = await assertFacilityAccess(user, facilityId);
  const { db } = await ensureDatabaseReady();

  let [station] = await db
    .select()
    .from(chargingStations)
    .where(eq(chargingStations.facilityId, facility.id))
    .limit(1);

  if (!station) {
    const [createdStation] = await db
      .insert(chargingStations)
      .values({
        facilityId: facility.id,
        operatorId: facility.operatorId,
        name: `${facility.name} EV Station`,
        ocppIdentity: `OCPP-${facility.id.slice(0, 8).toUpperCase()}`,
        networkProvider: "INTERNAL_SIMULATED",
        isSimulated: true,
      })
      .returning();
    station = createdStation;
  }

  if (!station) throw new AppError(500, "STATION_ERROR", "Unable to locate station");

  const existingConnectors = await db
    .select()
    .from(connectors)
    .where(eq(connectors.stationId, station.id));

  const nextNum = existingConnectors.length + 1;
  const currentType = input.standard === "TYPE2_AC" || input.standard === "BHARAT_AC001" ? "AC" : "DC";

  const [conn] = await db
    .insert(connectors)
    .values({
      stationId: station.id,
      facilityId: facility.id,
      connectorNumber: nextNum,
      standard: input.standard,
      currentType,
      maxPowerKw: input.maxPowerKw,
      pricePerKwhPaise: input.pricePerKwhPaise,
      status: "AVAILABLE",
    })
    .returning();

  await db
    .update(facilities)
    .set({ hasEvCharging: true, availabilityUpdatedAt: new Date() })
    .where(eq(facilities.id, facility.id));

  publishPlatformEvent({
    type: "AVAILABILITY_CHANGED",
    facilityId: facility.id,
    source: "OPERATOR",
    payload: { connectorId: conn?.id, action: "CONNECTOR_ADDED" },
  });

  return conn;
}

export async function getEvPumpsDashboardData(user: SessionUser) {
  const { db } = await ensureDatabaseReady();
  const operatorIds =
    user.role === "SUPER_ADMIN"
      ? (await db.select({ id: operators.id }).from(operators)).map((o) => o.id)
      : await getUserOperatorIds(user.id);

  if (operatorIds.length === 0) {
    return {
      facilities: [],
      pumps: [],
      preOrders: [],
      chargingSessions: [],
      metrics: {
        totalPumps: 0,
        totalGuns: 0,
        availableGuns: 0,
        chargingGuns: 0,
        faultedGuns: 0,
        upcomingPreOrders: 0,
        activeSessions: 0,
        totalEnergyKwh: 0,
        totalEvRevenuePaise: 0,
      },
    };
  }

  const facRows = await db
    .select()
    .from(facilities)
    .where(and(inArray(facilities.operatorId, operatorIds), isNull(facilities.deletedAt)));

  const facIds = facRows.map((f) => f.id);
  if (facIds.length === 0) {
    return {
      facilities: [],
      pumps: [],
      preOrders: [],
      chargingSessions: [],
      metrics: {
        totalPumps: 0,
        totalGuns: 0,
        availableGuns: 0,
        chargingGuns: 0,
        faultedGuns: 0,
        upcomingPreOrders: 0,
        activeSessions: 0,
        totalEnergyKwh: 0,
        totalEvRevenuePaise: 0,
      },
    };
  }

  const [stationRows, connectorRows, resRows, chargeRows] = await Promise.all([
    db.select().from(chargingStations).where(inArray(chargingStations.facilityId, facIds)),
    db.select().from(connectors).where(inArray(connectors.facilityId, facIds)),
    db
      .select()
      .from(reservations)
      .where(inArray(reservations.facilityId, facIds))
      .orderBy(desc(reservations.startTime)),
    db
      .select()
      .from(chargingSessions)
      .where(inArray(chargingSessions.facilityId, facIds))
      .orderBy(desc(chargingSessions.startedAt)),
  ]);

  const evReservations = resRows.filter(
    (r) =>
      r.connectorId !== null ||
      r.reservationType === "EV_CHARGING" ||
      r.reservationType === "COMBINED"
  );

  const userIds = Array.from(new Set(evReservations.map((r) => r.userId)));
  const userRows =
    userIds.length > 0
      ? await db
          .select({ id: users.id, fullName: users.fullName, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const facMap = new Map(facRows.map((f) => [f.id, f]));
  const connMap = new Map(connectorRows.map((c) => [c.id, c]));

  const evResIds = evReservations.map((r) => r.id);
  const paymentRows =
    evResIds.length > 0
      ? await db
          .select()
          .from(payments)
          .where(and(inArray(payments.reservationId, evResIds), eq(payments.status, "CAPTURED")))
      : [];

  const pumps = stationRows.map((st) => {
    const fac = facMap.get(st.facilityId);
    const guns = connectorRows.filter((c) => c.stationId === st.id);
    return {
      stationId: st.id,
      stationName: st.name,
      ocppIdentity: st.ocppIdentity,
      networkProvider: st.networkProvider,
      isSimulated: st.isSimulated,
      facilityId: st.facilityId,
      facilityName: fac?.name ?? "EV Hub",
      facilityCity: fac?.city ?? "",
      facilityStatus: fac?.status ?? "ACTIVE",
      connectors: guns,
    };
  });

  const preOrders = evReservations.map((r) => {
    const driver = userMap.get(r.userId);
    const fac = facMap.get(r.facilityId);
    const gun = r.connectorId ? connMap.get(r.connectorId) : undefined;
    return {
      id: r.id,
      bookingReference: r.bookingReference,
      facilityId: r.facilityId,
      facilityName: fac?.name ?? "EV Hub",
      connectorId: r.connectorId,
      connectorLabel: gun
        ? `#${gun.connectorNumber} · ${gun.standard} (${gun.maxPowerKw}kW)`
        : "Standard EV Bay",
      customerName: driver?.fullName ?? "Driver",
      customerEmail: driver?.email ?? "",
      status: r.status,
      reservationType: r.reservationType,
      startTime: r.startTime,
      endTime: r.endTime,
      totalEstimatedPaise: r.totalEstimatedPaise,
      finalAmountPaise: r.finalAmountPaise,
    };
  });

  const sessionCostPaise = chargeRows.reduce((s, c) => s + c.totalCostPaise, 0);
  const capturedEvPaise = paymentRows.reduce((s, p) => s + p.amountPaise, 0);

  return {
    facilities: facRows,
    pumps,
    preOrders,
    chargingSessions: chargeRows,
    metrics: {
      totalPumps: pumps.length,
      totalGuns: connectorRows.length,
      availableGuns: connectorRows.filter((c) => c.status === "AVAILABLE").length,
      chargingGuns: connectorRows.filter((c) => c.status === "CHARGING").length,
      faultedGuns: connectorRows.filter((c) => c.status === "FAULTED" || c.status === "OFFLINE")
        .length,
      upcomingPreOrders: evReservations.filter((r) =>
        ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN", "ACTIVE"].includes(r.status)
      ).length,
      activeSessions: chargeRows.filter((c) => c.status === "ACTIVE").length,
      totalEnergyKwh:
        Math.round(chargeRows.reduce((s, c) => s + c.energyDeliveredKwh, 0) * 100) / 100,
      totalEvRevenuePaise: Math.max(capturedEvPaise, sessionCostPaise),
    },
  };
}
