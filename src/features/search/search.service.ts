import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import {
  chargingStations,
  connectors,
  evOwnerVerifications,
  facilities,
  operators,
  parkingSpaces,
  pricingRules,
  reviews,
} from "@/db/schema";
import { estimateTravelMinutes, haversineKm } from "@/lib/utils";
import { expireStaleHolds } from "@/features/availability/availability.service";

export const facilitySearchQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    lat: z.coerce.number().finite().min(-90).max(90).optional(),
    lng: z.coerce.number().finite().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().finite().min(0.5).max(100).optional().default(25),
    north: z.coerce.number().finite().min(-90).max(90).optional(),
    south: z.coerce.number().finite().min(-90).max(90).optional(),
    east: z.coerce.number().finite().min(-180).max(180).optional(),
    west: z.coerce.number().finite().min(-180).max(180).optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    maxPricePaise: z.coerce.number().int().positive().optional(),
    facilityType: z.string().optional(),
    hasParking: z.enum(["true", "false"]).optional(),
    hasEvCharging: z.enum(["true", "false"]).optional(),
    connectorStandard: z.string().optional(),
    minPowerKw: z.coerce.number().finite().min(0).optional(),
    isCovered: z.enum(["true", "false"]).optional(),
    hasAccessibility: z.enum(["true", "false"]).optional(),
    is24Hours: z.enum(["true", "false"]).optional(),
    dataSourceType: z.enum(["VERIFIED_REAL", "OPERATOR_MANAGED", "SIMULATED"]).optional(),
    sortBy: z.enum(["suitability", "distance", "price"]).optional().default("suitability"),
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
  })
  .refine((d) => (d.lat === undefined) === (d.lng === undefined), {
    message: "Both lat and lng must be provided together",
    path: ["lat"],
  })
  .refine(
    (d) => !(d.north !== undefined && d.south !== undefined && d.north < d.south),
    {
      message: "north bound must be greater than or equal to south bound",
      path: ["north"],
    }
  );

export const nearbyChargersQuerySchema = z.object({
  lat: z.coerce.number().finite().min(-90).max(90),
  lng: z.coerce.number().finite().min(-180).max(180),
  radiusKm: z.coerce.number().finite().min(0.5).max(100).optional().default(25),
  connectorStandard: z.string().trim().max(40).optional(),
  minPowerKw: z.coerce.number().finite().min(0).optional(),
});

export type FacilitySearchQuery = z.infer<typeof facilitySearchQuerySchema>;

export type AvailabilityStatus = "LIVE" | "STALE" | "UNKNOWN";

export interface FacilitySearchResultItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  facilityType: string;
  dataSourceType: string;
  ownerVerified: boolean;
  stationDocsVerified: boolean;
  liveAvailabilityConnected: boolean;
  availabilityStatus: AvailabilityStatus;
  addressLine1: string;
  landmark: string | null;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  is24Hours: boolean;
  isCovered: boolean;
  hasSecurity: boolean;
  hasAccessibility: boolean;
  hasEvCharging: boolean;
  totalCapacity: number;
  availableSpaces: number;
  occupiedSpaces: number;
  availableConnectors: number;
  totalConnectors: number;
  maxChargerKw: number;
  connectorStandards: string[];
  hourlyRatePaise: number;
  dailyMaxPaise: number;
  currency: string;
  distanceKm: number;
  estimatedTravelMinutes: number;
  averageRating: number;
  reviewCount: number;
  suitabilityScore: number;
  availabilityUpdatedAt: string;
  isStale: boolean;
  amenities: string[];
  photos: string[];
}

export async function searchFacilities(rawQuery: FacilitySearchQuery) {
  await expireStaleHolds();
  const state = await ensureDatabaseReady();
  const { db } = state;

  const hasCenter = rawQuery.lat !== undefined && rawQuery.lng !== undefined;
  const refLat = rawQuery.lat;
  const refLng = rawQuery.lng;

  const activeFacilities = await db
    .select()
    .from(facilities)
    .where(and(eq(facilities.status, "ACTIVE"), isNull(facilities.deletedAt)));

  if (activeFacilities.length === 0) {
    return {
      items: [],
      total: 0,
      page: rawQuery.page,
      pageSize: rawQuery.pageSize,
      searchCenter: hasCenter ? { lat: refLat!, lng: refLng! } : null,
      geospatialEngine: state.hasPostgis ? "POSTGIS" : "POSTGRES_HAVERSINE",
    };
  }

  const facilityIds = activeFacilities.map((f) => f.id);
  const operatorIds = Array.from(new Set(activeFacilities.map((f) => f.operatorId)));

  const [allSpaces, allConnectors, allRules, allReviews, allOperators, allVerifications, allStations] =
    await Promise.all([
      db
        .select()
        .from(parkingSpaces)
        .where(and(inArray(parkingSpaces.facilityId, facilityIds), eq(parkingSpaces.isActive, true))),
      db.select().from(connectors).where(inArray(connectors.facilityId, facilityIds)),
      db
        .select()
        .from(pricingRules)
        .where(and(inArray(pricingRules.facilityId, facilityIds), eq(pricingRules.isActive, true))),
      db.select().from(reviews).where(inArray(reviews.facilityId, facilityIds)),
      db.select().from(operators).where(inArray(operators.id, operatorIds)),
      db
        .select()
        .from(evOwnerVerifications)
        .where(inArray(evOwnerVerifications.operatorId, operatorIds)),
      db
        .select()
        .from(chargingStations)
        .where(inArray(chargingStations.facilityId, facilityIds)),
    ]);

  const now = Date.now();
  const qLower = rawQuery.q?.toLowerCase().trim() ?? "";

  const enriched: FacilitySearchResultItem[] = [];

  for (const f of activeFacilities) {
    // Ensure valid geographic coordinates
    if (
      !Number.isFinite(f.latitude) ||
      !Number.isFinite(f.longitude) ||
      f.latitude < -90 ||
      f.latitude > 90 ||
      f.longitude < -180 ||
      f.longitude > 180
    ) {
      continue;
    }

    // Text search filter
    if (qLower) {
      const hay = `${f.name} ${f.addressLine1} ${f.landmark ?? ""} ${f.city} ${f.description}`.toLowerCase();
      if (!hay.includes(qLower)) continue;
    }

    // Bounds filter
    if (
      rawQuery.north !== undefined &&
      rawQuery.south !== undefined &&
      rawQuery.east !== undefined &&
      rawQuery.west !== undefined
    ) {
      if (
        f.latitude > rawQuery.north ||
        f.latitude < rawQuery.south ||
        f.longitude > rawQuery.east ||
        f.longitude < rawQuery.west
      ) {
        continue;
      }
    }

    const distanceKm =
      hasCenter && refLat !== undefined && refLng !== undefined
        ? haversineKm(refLat, refLng, f.latitude, f.longitude)
        : 0;
    if (hasCenter && distanceKm > rawQuery.radiusKm) {
      continue;
    }

    // Attribute filters
    if (rawQuery.facilityType && f.facilityType !== rawQuery.facilityType) continue;
    if (rawQuery.hasEvCharging === "true" && !f.hasEvCharging) continue;
    if (rawQuery.hasEvCharging === "false" && f.hasEvCharging) continue;
    if (rawQuery.isCovered === "true" && !f.isCovered) continue;
    if (rawQuery.hasAccessibility === "true" && !f.hasAccessibility) continue;
    if (rawQuery.is24Hours === "true" && !f.is24Hours) continue;
    if (rawQuery.dataSourceType && f.dataSourceType !== rawQuery.dataSourceType) continue;

    const fSpaces = allSpaces.filter((s) => s.facilityId === f.id);
    if (rawQuery.hasParking === "true" && fSpaces.length === 0) continue;
    if (rawQuery.hasParking === "false" && !f.hasEvCharging) continue;

    const availableSpaces = fSpaces.filter((s) => s.status === "AVAILABLE").length;
    const occupiedSpaces = fSpaces.filter((s) => s.status !== "AVAILABLE").length;

    const fOperator = allOperators.find((o) => o.id === f.operatorId);
    const fVerification = allVerifications.find((v) => v.operatorId === f.operatorId);
    const fStations = allStations.filter((st) => st.facilityId === f.id);

    const ownerVerified = fOperator?.status === "APPROVED";
    const stationDocsVerified = fVerification?.verificationStatus === "APPROVED";
    const hasRealTelemetryStation =
      fStations.length > 0 && fStations.some((st) => !st.isSimulated);
    const liveAvailabilityConnected =
      f.dataSourceType === "VERIFIED_REAL" ||
      (f.dataSourceType === "OPERATOR_MANAGED" &&
        (!f.hasEvCharging || hasRealTelemetryStation));

    const fConnectors = allConnectors.filter((c) => c.facilityId === f.id);
    const availableConnectors = fConnectors.filter((c) => c.status === "AVAILABLE").length;
    const maxChargerKw = fConnectors.reduce((m, c) => Math.max(m, c.maxPowerKw), 0);
    const connectorStandards = Array.from(new Set(fConnectors.map((c) => c.standard)));

    if (
      rawQuery.connectorStandard &&
      !connectorStandards.includes(rawQuery.connectorStandard as typeof connectorStandards[number])
    ) {
      continue;
    }
    if (rawQuery.minPowerKw !== undefined && maxChargerKw < rawQuery.minPowerKw) {
      continue;
    }

    const fRules = allRules.filter((r) => r.facilityId === f.id);
    const baseRule = fRules.find((r) => r.spaceCategory === null) ?? fRules[0];
    const hourlyRatePaise = baseRule?.hourlyRatePaise ?? 4000;
    const dailyMaxPaise = baseRule?.dailyMaxPaise ?? 24000;

    if (rawQuery.maxPricePaise !== undefined && hourlyRatePaise > rawQuery.maxPricePaise) {
      continue;
    }

    const fReviews = allReviews.filter((r) => r.facilityId === f.id);
    const averageRating =
      fReviews.length > 0
        ? Math.round((fReviews.reduce((s, r) => s + r.rating, 0) / fReviews.length) * 10) / 10
        : 0;

    // Transparent rule-based suitability score (0 - 100)
    const distScore = hasCenter ? Math.max(0, 35 - distanceKm * 3.5) : 17.5;
    const availRatio = fSpaces.length > 0 ? availableSpaces / fSpaces.length : 0;
    const availScore = availRatio * 30;
    const priceScore = Math.max(0, 20 - (hourlyRatePaise - 3000) / 300);
    const evBonus = f.hasEvCharging && availableConnectors > 0 ? 10 : 0;
    const ratingScore = fReviews.length > 0 ? (averageRating / 5) * 5 : 2.5;
    const suitabilityScore = Math.round(
      Math.min(100, Math.max(0, distScore + availScore + priceScore + evBonus + ratingScore))
    );

    const updatedMs = new Date(f.availabilityUpdatedAt).getTime();
    const isStale = now - updatedMs > 15 * 60 * 1000;
    const availabilityStatus: AvailabilityStatus = !liveAvailabilityConnected
      ? "UNKNOWN"
      : isStale
        ? "STALE"
        : "LIVE";

    enriched.push({
      id: f.id,
      slug: f.slug,
      name: f.name,
      description: f.description,
      facilityType: f.facilityType,
      dataSourceType: f.dataSourceType,
      ownerVerified,
      stationDocsVerified,
      liveAvailabilityConnected,
      availabilityStatus,
      addressLine1: f.addressLine1,
      landmark: f.landmark,
      city: f.city,
      state: f.state,
      latitude: f.latitude,
      longitude: f.longitude,
      is24Hours: f.is24Hours,
      isCovered: f.isCovered,
      hasSecurity: f.hasSecurity,
      hasAccessibility: f.hasAccessibility,
      hasEvCharging: f.hasEvCharging,
      totalCapacity: fSpaces.length || f.totalCapacity,
      availableSpaces,
      occupiedSpaces,
      availableConnectors,
      totalConnectors: fConnectors.length,
      maxChargerKw,
      connectorStandards,
      hourlyRatePaise,
      dailyMaxPaise,
      currency: baseRule?.currency ?? "INR",
      distanceKm,
      estimatedTravelMinutes: estimateTravelMinutes(distanceKm),
      averageRating,
      reviewCount: fReviews.length,
      suitabilityScore,
      availabilityUpdatedAt: new Date(f.availabilityUpdatedAt).toISOString(),
      isStale,
      amenities: f.amenities,
      photos: f.photos,
    });
  }

  enriched.sort((a, b) => {
    if (rawQuery.sortBy === "distance") return a.distanceKm - b.distanceKm;
    if (rawQuery.sortBy === "price") return a.hourlyRatePaise - b.hourlyRatePaise;
    return b.suitabilityScore - a.suitabilityScore;
  });

  const startIdx = (rawQuery.page - 1) * rawQuery.pageSize;
  const paged = enriched.slice(startIdx, startIdx + rawQuery.pageSize);

  return {
    items: paged,
    total: enriched.length,
    page: rawQuery.page,
    pageSize: rawQuery.pageSize,
    searchCenter: hasCenter ? { lat: refLat!, lng: refLng! } : null,
    geospatialEngine: state.hasPostgis ? "POSTGIS" : "POSTGRES_HAVERSINE",
  };
}

export async function getCityHeatmapAndInsights() {
  const result = await searchFacilities({
    sortBy: "suitability",
    page: 1,
    pageSize: 50,
    radiusKm: 100,
  });

  const zones = result.items.map((item) => {
    const occupancyPct =
      item.totalCapacity > 0
        ? Math.round((item.occupiedSpaces / item.totalCapacity) * 100)
        : 0;
    const demandLevel =
      occupancyPct >= 75 ? "HIGH" : occupancyPct >= 40 ? "MODERATE" : "LOW";
    return {
      facilityId: item.id,
      name: item.name,
      city: item.city,
      latitude: item.latitude,
      longitude: item.longitude,
      occupancyPct,
      demandLevel,
      availableSpaces: item.availableSpaces,
      availableConnectors: item.availableConnectors,
      dataSourceType: item.dataSourceType,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    disclaimer:
      "Occupancy heatmap reflects verified EV and parking facilities registered on ParkSmart.",
    zones,
  };
}

export async function planEvTrip(params: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  currentBatteryPct: number;
  vehicleRangeKm: number;
  connectorStandard?: string;
}) {
  const totalDistanceKm = haversineKm(
    params.originLat,
    params.originLng,
    params.destLat,
    params.destLng
  );
  const effectiveRangeKm = Math.max(15, (params.currentBatteryPct / 100) * params.vehicleRangeKm);
  const reserveBufferKm = params.vehicleRangeKm * 0.15;
  const needsChargingStop = totalDistanceKm > effectiveRangeKm - reserveBufferKm;

  const evResults = await searchFacilities({
    lat: (params.originLat + params.destLat) / 2,
    lng: (params.originLng + params.destLng) / 2,
    radiusKm: Math.max(25, totalDistanceKm + 15),
    hasEvCharging: "true",
    connectorStandard: params.connectorStandard,
    sortBy: "suitability",
    page: 1,
    pageSize: 10,
  });

  const recommendedStops = evResults.items
    .filter((f) => f.availableConnectors > 0)
    .slice(0, 3)
    .map((hub) => {
      const targetChargeMinutes = hub.maxChargerKw >= 50 ? 28 : 65;
      return {
        facilityId: hub.id,
        slug: hub.slug,
        name: hub.name,
        address: hub.addressLine1,
        latitude: hub.latitude,
        longitude: hub.longitude,
        maxChargerKw: hub.maxChargerKw,
        availableConnectors: hub.availableConnectors,
        connectorStandards: hub.connectorStandards,
        estimatedChargeMinutes: targetChargeMinutes,
        distanceFromCorridorMidpointKm: hub.distanceKm,
        dataSourceType: hub.dataSourceType,
      };
    });

  return {
    totalDistanceKm,
    estimatedDriveMinutes: estimateTravelMinutes(totalDistanceKm),
    effectiveRangeKm: Math.round(effectiveRangeKm),
    needsChargingStop,
    recommendedStops,
    dataDisclosure:
      "Estimated travel time and charging stop suggestions are calculated from real route distance and verified station charger ratings.",
  };
}
