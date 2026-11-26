import { haversineKm } from "@/lib/utils";
import type { AvailabilityStatus } from "./search.service";

export interface ExternalEvChargerStation {
  id: string;
  source: "OPENSTREETMAP_OVERPASS" | "OPEN_CHARGE_MAP";
  name: string;
  operator: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  distanceKm: number;
  connectorStandards: string[];
  maxPowerKw: number | null;
  sockets: string | null;
  ownerVerified: false;
  stationDocsVerified: false;
  liveAvailabilityConnected: false;
  availabilityStatus: AvailabilityStatus;
  availabilityUpdatedAt: string | null;
}

export interface NearbyChargersResult {
  stations: ExternalEvChargerStation[];
  center: { lat: number; lng: number };
  radiusKm: number;
  sources: {
    openChargeMap: {
      configured: boolean;
      status: "OK" | "NOT_CONFIGURED" | "UNAVAILABLE";
      message?: string;
    };
    openStreetMapOverpass: {
      status: "OK" | "UNAVAILABLE";
      message?: string;
    };
  };
}

function normalizeOsmConnectorStandards(tags: Record<string, string>): {
  standards: string[];
  maxPowerKw: number | null;
  summary: string | null;
} {
  const standards = new Set<string>();
  const socketLabels: string[] = [];
  let maxPowerKw: number | null = null;

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
    standards: Array.from(standards),
    maxPowerKw,
    summary,
  };
}

export interface OverpassElement {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
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
    const { standards, maxPowerKw, summary } = normalizeOsmConnectorStandards(tags);
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

    stations.push({
      id: `osm-${el.id}`,
      source: "OPENSTREETMAP_OVERPASS",
      name: tags.name || tags.operator || "Public EV Charging Station",
      operator: tags.operator || null,
      address: addrParts.length > 0 ? addrParts.join(", ") : null,
      latitude: pLat,
      longitude: pLng,
      distanceKm,
      connectorStandards: standards,
      maxPowerKw,
      sockets: summary,
      ownerVerified: false,
      stationDocsVerified: false,
      liveAvailabilityConnected: false,
      availabilityStatus: "UNKNOWN",
      availabilityUpdatedAt: null,
    });
  }
  return stations.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 25);
}
function mapOcmConnectionStandard(title?: string): string | null {
  if (!title) return null;
  const lower = title.toLowerCase();
  if (lower.includes("ccs")) return "CCS2";
  if (lower.includes("type 2") || lower.includes("mennekes")) return "TYPE2_AC";
  if (lower.includes("chademo")) return "CHADEMO";
  if (lower.includes("gb/t") || lower.includes("gb-t")) return "GB_T";
  return null;
}

export async function discoverNearbyExternalEvChargers(params: {
  lat: number;
  lng: number;
  radiusKm: number;
  connectorStandard?: string;
  minPowerKw?: number;
  fetchFn?: typeof fetch;
}): Promise<NearbyChargersResult> {
  const fetchImpl = params.fetchFn ?? fetch;
  const stations: ExternalEvChargerStation[] = [];
  const ocmKey = process.env.OPEN_CHARGE_MAP_API_KEY?.trim();

  let ocmStatus: NearbyChargersResult["sources"]["openChargeMap"] = {
    configured: Boolean(ocmKey),
    status: ocmKey ? "OK" : "NOT_CONFIGURED",
    message: ocmKey
      ? undefined
      : "OPEN_CHARGE_MAP_API_KEY is not configured; using OpenStreetMap Overpass public data.",
  };

  if (ocmKey) {
    try {
      const url = new URL("https://api.openchargemap.io/v3/poi/");
      url.searchParams.set("output", "json");
      url.searchParams.set("latitude", String(params.lat));
      url.searchParams.set("longitude", String(params.lng));
      url.searchParams.set("distance", String(params.radiusKm));
      url.searchParams.set("distanceunit", "KM");
      url.searchParams.set("maxresults", "25");
      url.searchParams.set("compact", "true");
      url.searchParams.set("verbose", "false");
      url.searchParams.set("key", ocmKey);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetchImpl(url.toString(), {
        headers: {
          "User-Agent": "ParkSmart-EV-Finder/1.0",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        ocmStatus = {
          configured: true,
          status: "UNAVAILABLE",
          message: `Open Charge Map returned HTTP ${res.status}`,
        };
      } else {
        const pois = (await res.json()) as Array<{
          ID: number;
          DateLastStatusUpdate?: string;
          AddressInfo?: {
            Title?: string;
            AddressLine1?: string;
            Town?: string;
            Latitude?: number;
            Longitude?: number;
          };
          OperatorInfo?: { Title?: string };
          Connections?: Array<{
            PowerKW?: number;
            ConnectionType?: { Title?: string };
          }>;
        }>;

        for (const poi of pois) {
          const pLat = poi.AddressInfo?.Latitude;
          const pLng = poi.AddressInfo?.Longitude;
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

          const standards = Array.from(
            new Set(
              (poi.Connections ?? [])
                .map((c) => mapOcmConnectionStandard(c.ConnectionType?.Title))
                .filter((x): x is string => x !== null)
            )
          );
          const maxPowerKw = (poi.Connections ?? []).reduce<number | null>((acc, c) => {
            if (typeof c.PowerKW !== "number" || !Number.isFinite(c.PowerKW)) return acc;
            return acc === null ? c.PowerKW : Math.max(acc, c.PowerKW);
          }, null);

          stations.push({
            id: `ocm-${poi.ID}`,
            source: "OPEN_CHARGE_MAP",
            name: poi.AddressInfo?.Title?.trim() || "Public EV Charging Station",
            operator: poi.OperatorInfo?.Title?.trim() || null,
            address:
              [poi.AddressInfo?.AddressLine1, poi.AddressInfo?.Town]
                .filter(Boolean)
                .join(", ") || null,
            latitude: pLat,
            longitude: pLng,
            distanceKm,
            connectorStandards: standards,
            maxPowerKw,
            sockets:
              standards.length > 0
                ? `Connectors: ${standards.join(", ")}${maxPowerKw ? ` (up to ${maxPowerKw} kW)` : ""}`
                : null,
            ownerVerified: false,
            stationDocsVerified: false,
            liveAvailabilityConnected: false,
            availabilityStatus: "UNKNOWN",
            availabilityUpdatedAt: poi.DateLastStatusUpdate ?? null,
          });
        }
      }
    } catch {
      ocmStatus = {
        configured: true,
        status: "UNAVAILABLE",
        message: "Open Charge Map request failed or timed out.",
      };
    }
  }

  // OpenStreetMap Overpass public charging_station query
  let overpassStatus: NearbyChargersResult["sources"]["openStreetMapOverpass"] = {
    status: "UNAVAILABLE",
    message: "OpenStreetMap Overpass API could not be reached.",
  };

  const radiusMeters = Math.min(25000, Math.max(500, Math.round(params.radiusKm * 1000)));
  const overpassQuery = `[out:json][timeout:12];(node["amenity"="charging_station"](around:${radiusMeters},${params.lat},${params.lng});way["amenity"="charging_station"](around:${radiusMeters},${params.lat},${params.lng}););out center 40;`;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetchImpl(
        `${endpoint}?data=${encodeURIComponent(overpassQuery)}`,
        {
          method: "GET",
          headers: {
            "User-Agent": "ParkSmart-EV-Finder/1.0",
            Accept: "application/json",
          },
          signal: controller.signal,
        }
      );
      clearTimeout(timer);

      if (!res.ok) {
        overpassStatus = {
          status: "UNAVAILABLE",
          message: `OpenStreetMap Overpass returned HTTP ${res.status}`,
        };
        continue;
      }

      const json = (await res.json()) as {
        elements?: OverpassElement[];
      };

      const parsedOsm = parseOverpassElementsToStations({
        elements: json.elements ?? [],
        lat: params.lat,
        lng: params.lng,
        radiusKm: params.radiusKm,
      });
      stations.push(...parsedOsm);

      overpassStatus = { status: "OK" };
      break;
    } catch {
      overpassStatus = {
        status: "UNAVAILABLE",
        message: "Could not reach OpenStreetMap Overpass API from the server.",
      };
    }
  }

  // Apply optional connector / power filters
  const filtered = stations
    .filter((s) => {
      if (params.connectorStandard && s.connectorStandards.length > 0) {
        if (!s.connectorStandards.includes(params.connectorStandard)) return false;
      }
      if (params.connectorStandard && s.connectorStandards.length === 0) {
        return false;
      }
      if (params.minPowerKw !== undefined && params.minPowerKw > 0) {
        if (s.maxPowerKw === null || s.maxPowerKw < params.minPowerKw) return false;
      }
      return true;
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 25);

  return {
    stations: filtered,
    center: { lat: params.lat, lng: params.lng },
    radiusKm: params.radiusKm,
    sources: {
      openChargeMap: ocmStatus,
      openStreetMapOverpass: overpassStatus,
    },
  };
}
