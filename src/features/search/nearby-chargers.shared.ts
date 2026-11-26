import { haversineKm } from "@/lib/utils";
import type { AvailabilityStatus } from "./search.service";

export interface NormalizedConnectorInfo {
  standard: string;
  powerKw: number | null;
  count: number | null;
  label: string;
}

export interface ExternalEvChargerStation {
  id: string;
  source:
    | "INDIA_OPEN_EV_DATA"
    | "BEE_INDIA_API"
    | "OPENSTREETMAP_OVERPASS"
    | "OPEN_CHARGE_MAP";
  sourceId: string;
  name: string;
  operator: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  distanceKm: number;
  connectors: NormalizedConnectorInfo[];
  connectorStandards: string[];
  maxPowerKw: number | null;
  sockets: string | null;
  totalConnectors?: number | null;
  availableConnectors?: number | null;
  pricing?: string | null;
  sourcesLabel?: string | null;
  sourceUpdatedAt: string | null;
  freshnessLabel: string;
  listingType: "SOURCE_LISTED";
  ownerVerified: false;
  stationDocsVerified: false;
  liveAvailabilityConnected: boolean;
  availabilityStatus: AvailabilityStatus;
  availabilityUpdatedAt: string | null;
}

export interface NearbyProviderError {
  provider: string;
  code: string;
  message: string;
}

export interface NearbyChargersResult {
  stations: ExternalEvChargerStation[];
  center: { lat: number; lng: number };
  radiusKm: number;
  sources: {
    indiaOpenDataset: {
      status: "OK" | "SKIPPED" | "UNAVAILABLE";
      count: number;
      message?: string;
    };
    beeIndiaApi: {
      status: "OK" | "SKIPPED" | "UNAVAILABLE";
      message?: string;
    };
    openChargeMap: {
      configured: boolean;
      status: "OK" | "SKIPPED" | "NOT_CONFIGURED" | "UNAVAILABLE";
      message?: string;
    };
    openStreetMapOverpass: {
      status: "OK" | "SKIPPED" | "UNAVAILABLE";
      message?: string;
    };
  };
  providerErrors: NearbyProviderError[];
  allEnabledProvidersFailed: boolean;
  attributions: string[];
}

export interface OverpassElement {
  type?: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  timestamp?: string;
  tags?: Record<string, string>;
}

export function formatSourceFreshness(
  isoOrDate: string | null | undefined,
  fallbackLabel = "Freshness unknown"
): string {
  if (!isoOrDate) return fallbackLabel;
  const parsed = Date.parse(isoOrDate);
  if (!Number.isFinite(parsed)) return fallbackLabel;
  const formatted = new Date(parsed).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `Updated ${formatted}`;
}

function normalizeOsmConnectorStandards(tags: Record<string, string>): {
  connectors: NormalizedConnectorInfo[];
  standards: string[];
  maxPowerKw: number | null;
  summary: string | null;
} {
  const standards = new Set<string>();
  const socketLabels: string[] = [];
  const connectors: NormalizedConnectorInfo[] = [];
  let maxPowerKw: number | null = null;

  const mapRawKey = (rawKey: string): string => {
    if (rawKey.includes("type2")) return "TYPE2_AC";
    if (rawKey.includes("ccs") || rawKey.includes("combo")) return "CCS2";
    if (rawKey.includes("chademo")) return "CHADEMO";
    if (rawKey.includes("gb_t") || rawKey.includes("gbt")) return "GB_T";
    return rawKey.toUpperCase();
  };

  for (const [k, v] of Object.entries(tags)) {
    if (!k.startsWith("socket:")) continue;
    const rawKey = k.slice("socket:".length).toLowerCase();

    if (rawKey.includes("type2")) standards.add("TYPE2_AC");
    else if (rawKey.includes("ccs") || rawKey.includes("combo")) standards.add("CCS2");
    else if (rawKey.includes("chademo")) standards.add("CHADEMO");
    else if (rawKey.includes("gb_t") || rawKey.includes("gbt")) standards.add("GB_T");

    if (rawKey.endsWith(":output")) {
      const kw = parseFloat(v);
      if (Number.isFinite(kw) && kw > 0) {
        maxPowerKw = maxPowerKw === null ? kw : Math.max(maxPowerKw, kw);
      }
      continue;
    }

    if (!rawKey.includes(":")) {
      const std = mapRawKey(rawKey);
      const countNum = parseInt(v, 10);
      const outputStr = tags[`socket:${rawKey}:output`];
      const powerKw = outputStr ? parseFloat(outputStr) : NaN;
      connectors.push({
        standard: std,
        powerKw: Number.isFinite(powerKw) && powerKw > 0 ? powerKw : null,
        count: Number.isFinite(countNum) && countNum > 0 ? countNum : null,
        label: `${rawKey.toUpperCase()} (${v})`,
      });
      socketLabels.push(`${rawKey.toUpperCase()} (${v})`);
    }
  }

  const summary =
    socketLabels.length > 0
      ? `Connectors: ${socketLabels.join(", ")}`
      : tags.capacity
        ? `Capacity: ${tags.capacity}`
        : null;

  return {
    connectors,
    standards: Array.from(standards),
    maxPowerKw,
    summary,
  };
}

export function buildOverpassBboxQuery(lat: number, lng: number, radiusKm: number): string {
  const clampedKm = Math.min(100, Math.max(0.5, radiusKm));
  const latDelta = clampedKm / 111.0;
  const cosLat = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const lngDelta = clampedKm / (111.0 * cosLat);

  const south = Math.max(-90, lat - latDelta).toFixed(5);
  const north = Math.min(90, lat + latDelta).toFixed(5);
  const west = Math.max(-180, lng - lngDelta).toFixed(5);
  const east = Math.min(180, lng + lngDelta).toFixed(5);

  return `[out:json][timeout:8];(node["amenity"="charging_station"](${south},${west},${north},${east});way["amenity"="charging_station"](${south},${west},${north},${east}););out center 80;`;
}

export function parseOverpassElementsToStations(params: {
  elements: OverpassElement[];
  lat: number;
  lng: number;
  radiusKm: number;
  connectorStandard?: string;
  minPowerKw?: number;
}): ExternalEvChargerStation[] {
  const stations: ExternalEvChargerStation[] = [];
  for (const el of params.elements) {
    const pLat = el.lat ?? el.center?.lat;
    const pLng = el.lon ?? el.center?.lon;
    if (
      typeof pLat !== "number" ||
      typeof pLng !== "number" ||
      !Number.isFinite(pLat) ||
      !Number.isFinite(pLng)
    ) {
      continue;
    }
    const distanceKm = haversineKm(params.lat, params.lng, pLat, pLng);
    if (distanceKm > params.radiusKm) continue;

    const tags = el.tags ?? {};
    const { connectors, standards, maxPowerKw, summary } = normalizeOsmConnectorStandards(tags);
    const addrParts = [
      tags["addr:street"],
      tags["addr:city"] || tags["addr:town"] || tags["addr:suburb"],
    ].filter(Boolean);

    if (params.connectorStandard) {
      if (standards.length === 0 || !standards.includes(params.connectorStandard)) {
        continue;
      }
    }
    if (params.minPowerKw !== undefined && params.minPowerKw > 0) {
      if (maxPowerKw === null || maxPowerKw < params.minPowerKw) continue;
    }

    const pricing = tags.charge?.trim() || (tags.fee && tags.fee !== "no" ? `Fee: ${tags.fee}` : null);
    const sourceUpdatedAt = el.timestamp ?? null;

    stations.push({
      id: `osm-${el.id}`,
      source: "OPENSTREETMAP_OVERPASS",
      sourceId: el.type ? `${el.type}/${el.id}` : String(el.id),
      name: tags.name || tags.operator || "Public EV Charging Station",
      operator: tags.operator || null,
      address: addrParts.length > 0 ? addrParts.join(", ") : null,
      latitude: pLat,
      longitude: pLng,
      distanceKm,
      connectors,
      connectorStandards: standards,
      maxPowerKw,
      sockets: summary,
      pricing,
      sourcesLabel: "OpenStreetMap contributors (ODbL)",
      sourceUpdatedAt,
      freshnessLabel: formatSourceFreshness(sourceUpdatedAt, "OpenStreetMap listing"),
      listingType: "SOURCE_LISTED",
      ownerVerified: false,
      stationDocsVerified: false,
      liveAvailabilityConnected: false,
      availabilityStatus: "UNKNOWN",
      availabilityUpdatedAt: null,
    });
  }
  return stations.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 250);
}
