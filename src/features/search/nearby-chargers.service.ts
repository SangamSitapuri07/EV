import { haversineKm } from "@/lib/utils";
import type { AvailabilityStatus } from "./search.service";
import {
  isInsideIndiaBounds,
  queryIndiaOpenEvDataset,
} from "./india-ev-dataset";
import {
  buildOverpassBboxQuery,
  parseOverpassElementsToStations,
  type ExternalEvChargerStation,
  type NearbyChargersResult,
  type OverpassElement,
} from "./nearby-chargers.shared";

export {
  buildOverpassBboxQuery,
  parseOverpassElementsToStations,
  type ExternalEvChargerStation,
  type NearbyChargersResult,
  type OverpassElement,
};
function mapOcmConnectionStandard(title?: string): string | null {
  if (!title) return null;
  const lower = title.toLowerCase();
  if (lower.includes("ccs")) return "CCS2";
  if (lower.includes("type 2") || lower.includes("mennekes")) return "TYPE2_AC";
  if (lower.includes("chademo")) return "CHADEMO";
  if (lower.includes("gb/t") || lower.includes("gb-t")) return "GB_T";
  return null;
}

function mapGoogleConnectorType(rawType?: string): string | null {
  if (!rawType) return null;
  const upper = rawType.toUpperCase();
  if (upper.includes("CCS_COMBO_2")) return "CCS2";
  if (upper.includes("CCS_COMBO_1")) return "CCS1";
  if (upper.includes("TYPE_2")) return "TYPE2_AC";
  if (upper.includes("CHADEMO")) return "CHADEMO";
  if (upper.includes("J1772")) return "TYPE1_J1772";
  if (upper.includes("TESLA")) return "TESLA";
  return null;
}

function mapBeeConnectorStandard(raw?: string): string | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.includes("CCS")) return "CCS2";
  if (upper.includes("TYPE_2") || upper.includes("TYPE2")) return "TYPE2_AC";
  if (upper.includes("CHADEMO")) return "CHADEMO";
  if (upper.includes("GB_T") || upper.includes("GBT")) return "GB_T";
  if (upper.includes("BHARAT_DC") || upper.includes("DC001")) return "BHARAT_DC001";
  if (upper.includes("BHARAT_AC") || upper.includes("AC001")) return "BHARAT_AC001";
  return null;
}

const nearbyCache = new Map<
  string,
  { expiresAt: number; rawStations: ExternalEvChargerStation[]; sources: NearbyChargersResult["sources"] }
>();

function deduplicateStations(stations: ExternalEvChargerStation[]): ExternalEvChargerStation[] {
  const unique: ExternalEvChargerStation[] = [];
  for (const candidate of stations) {
    const duplicate = unique.some(
      (existing) =>
        haversineKm(existing.latitude, existing.longitude, candidate.latitude, candidate.longitude) <
        0.08
    );
    if (!duplicate) unique.push(candidate);
  }
  return unique;
}

export async function discoverNearbyExternalEvChargers(params: {
  lat: number;
  lng: number;
  radiusKm: number;
  connectorStandard?: string;
  minPowerKw?: number;
  fetchFn?: typeof fetch;
  includeLocalIndiaDataset?: boolean;
  includeBeeIndiaApi?: boolean;
}): Promise<NearbyChargersResult> {
  const fetchImpl = params.fetchFn ?? fetch;
  const enableLocalDataset = params.includeLocalIndiaDataset ?? !params.fetchFn;
  const enableBeeApi = params.includeBeeIndiaApi ?? !params.fetchFn;
  const googlePlacesKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  const ocmKey = process.env.OPEN_CHARGE_MAP_API_KEY?.trim();
  const useCache = !params.fetchFn;
  const cacheKey = `${params.lat.toFixed(3)},${params.lng.toFixed(3)},${params.radiusKm},${Boolean(googlePlacesKey)},${Boolean(ocmKey)}`;

  const applyFilters = (raw: ExternalEvChargerStation[]) =>
    raw
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
      .slice(0, 60);

  if (useCache) {
    const cached = nearbyCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        stations: applyFilters(cached.rawStations),
        center: { lat: params.lat, lng: params.lng },
        radiusKm: params.radiusKm,
        sources: cached.sources,
      };
    }
  }

  const fetchGooglePlaces = async (): Promise<{
    stations: ExternalEvChargerStation[];
    status: NearbyChargersResult["sources"]["googlePlaces"];
  }> => {
    if (!googlePlacesKey) {
      return {
        stations: [],
        status: {
          configured: false,
          status: "NOT_CONFIGURED",
          message:
            "GOOGLE_PLACES_API_KEY is not configured; commercial stations from Google Places are disabled.",
        },
      };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const res = await fetchImpl("https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": googlePlacesKey,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location,places.evChargeOptions",
        },
        body: JSON.stringify({
          includedTypes: ["electric_vehicle_charging_station"],
          maxResultCount: 20,
          locationRestriction: {
            circle: {
              center: { latitude: params.lat, longitude: params.lng },
              // Google Places searchNearby restricts circle radius to 50,000 meters
              radius: Math.min(50000, Math.max(500, Math.round(params.radiusKm * 1000))),
            },
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return {
          stations: [],
          status: {
            configured: true,
            status: "UNAVAILABLE",
            message: `Google Places API returned HTTP ${res.status}`,
          },
        };
      }

      const json = (await res.json()) as {
        places?: Array<{
          id?: string;
          displayName?: { text?: string };
          formattedAddress?: string;
          location?: { latitude?: number; longitude?: number };
          evChargeOptions?: {
            connectorCount?: number;
            connectorAggregation?: Array<{
              type?: string;
              maxChargeRateKw?: number;
              count?: number;
              availableCount?: number;
              availabilityLastUpdateTime?: string;
            }>;
          };
        }>;
      };

      const nowMs = Date.now();
      const list: ExternalEvChargerStation[] = [];
      for (const place of json.places ?? []) {
        const pLat = place.location?.latitude;
        const pLng = place.location?.longitude;
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

        const aggs = place.evChargeOptions?.connectorAggregation ?? [];
        const standards = Array.from(
          new Set(
            aggs
              .map((a) => mapGoogleConnectorType(a.type))
              .filter((x): x is string => x !== null)
          )
        );
        const maxPowerKw = aggs.reduce<number | null>((acc, a) => {
          if (typeof a.maxChargeRateKw !== "number" || !Number.isFinite(a.maxChargeRateKw)) {
            return acc;
          }
          return acc === null ? a.maxChargeRateKw : Math.max(acc, a.maxChargeRateKw);
        }, null);

        const totalConn =
          place.evChargeOptions?.connectorCount ??
          (aggs.length > 0 ? aggs.reduce((s, a) => s + (a.count ?? 0), 0) : null);
        const hasAvailCounts = aggs.some((a) => typeof a.availableCount === "number");
        const availConn = hasAvailCounts
          ? aggs.reduce((s, a) => s + (a.availableCount ?? 0), 0)
          : null;
        const lastUpdate =
          aggs.find((a) => typeof a.availabilityLastUpdateTime === "string")
            ?.availabilityLastUpdateTime ?? null;
        const isStale = lastUpdate ? nowMs - new Date(lastUpdate).getTime() > 15 * 60 * 1000 : false;

        const availabilityStatus: AvailabilityStatus = !hasAvailCounts
          ? "UNKNOWN"
          : isStale
            ? "STALE"
            : "LIVE";

        list.push({
          id: `gplaces-${place.id ?? `${pLat}-${pLng}`}`,
          source: "GOOGLE_PLACES",
          name: place.displayName?.text?.trim() || "EV Charging Station",
          operator: null,
          address: place.formattedAddress ?? null,
          latitude: pLat,
          longitude: pLng,
          distanceKm,
          connectorStandards: standards,
          maxPowerKw,
          sockets:
            standards.length > 0
              ? `${standards.join(", ")}${maxPowerKw ? ` · ${Math.round(maxPowerKw)} kW` : ""}`
              : null,
          totalConnectors: totalConn,
          availableConnectors: availConn,
          ownerVerified: false,
          stationDocsVerified: false,
          liveAvailabilityConnected: hasAvailCounts,
          availabilityStatus,
          availabilityUpdatedAt: lastUpdate,
        });
      }

      return {
        stations: list,
        status: { configured: true, status: "OK" },
      };
    } catch {
      return {
        stations: [],
        status: {
          configured: true,
          status: "UNAVAILABLE",
          message: "Google Places API request failed or timed out.",
        },
      };
    }
  };

  const fetchOcm = async (): Promise<{
    stations: ExternalEvChargerStation[];
    status: NearbyChargersResult["sources"]["openChargeMap"];
  }> => {
    if (!ocmKey) {
      return {
        stations: [],
        status: {
          configured: false,
          status: "NOT_CONFIGURED",
          message:
            "OPEN_CHARGE_MAP_API_KEY is not configured; using OpenStreetMap Overpass public data.",
        },
      };
    }

    try {
      const url = new URL("https://api.openchargemap.io/v3/poi/");
      url.searchParams.set("output", "json");
      url.searchParams.set("latitude", String(params.lat));
      url.searchParams.set("longitude", String(params.lng));
      url.searchParams.set("distance", String(params.radiusKm));
      url.searchParams.set("distanceunit", "KM");
      url.searchParams.set("maxresults", "100");
      url.searchParams.set("compact", "false");
      url.searchParams.set("verbose", "false");
      url.searchParams.set("key", ocmKey);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetchImpl(url.toString(), {
        headers: {
          "User-Agent": "ParkSmart-EV-Finder/1.0",
          "X-API-Key": ocmKey,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return {
          stations: [],
          status: {
            configured: true,
            status: "UNAVAILABLE",
            message: `Open Charge Map returned HTTP ${res.status}`,
          },
        };
      }

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

      const list: ExternalEvChargerStation[] = [];
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

        list.push({
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

      return {
        stations: list,
        status: { configured: true, status: "OK" },
      };
    } catch {
      return {
        stations: [],
        status: {
          configured: true,
          status: "UNAVAILABLE",
          message: "Open Charge Map request failed or timed out.",
        },
      };
    }
  };

  const fetchOverpass = async (): Promise<{
    stations: ExternalEvChargerStation[];
    status: NearbyChargersResult["sources"]["openStreetMapOverpass"];
  }> => {
    const overpassQuery = buildOverpassBboxQuery(params.lat, params.lng, params.radiusKm);
    const endpoints = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ];

    let lastStatus: NearbyChargersResult["sources"]["openStreetMapOverpass"] = {
      status: "UNAVAILABLE",
      message: "OpenStreetMap Overpass API could not be reached.",
    };

    for (const endpoint of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
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
          lastStatus = {
            status: "UNAVAILABLE",
            message: `OpenStreetMap Overpass returned HTTP ${res.status}`,
          };
          continue;
        }

        const json = (await res.json()) as {
          elements?: OverpassElement[];
          remark?: string;
        };
        if (json.remark) {
          lastStatus = {
            status: "UNAVAILABLE",
            message: `OpenStreetMap Overpass returned an incomplete response: ${json.remark}`,
          };
          continue;
        }

        const parsedOsm = parseOverpassElementsToStations({
          elements: json.elements ?? [],
          lat: params.lat,
          lng: params.lng,
          radiusKm: params.radiusKm,
        });

        return {
          stations: parsedOsm,
          status: { status: "OK" },
        };
      } catch {
        lastStatus = {
          status: "UNAVAILABLE",
          message: "Could not reach OpenStreetMap Overpass API from the server.",
        };
      }
    }

    return { stations: [], status: lastStatus };
  };

  const fetchBeeIndiaApi = async (): Promise<{
    stations: ExternalEvChargerStation[];
    status: NearbyChargersResult["sources"]["beeIndiaApi"];
  }> => {
    if (!enableBeeApi || !isInsideIndiaBounds(params.lat, params.lng)) {
      return {
        stations: [],
        status: {
          status: "SKIPPED",
          message: !enableBeeApi
            ? "Skipped in mock fetch mode."
            : "Coordinates outside India; BEE India directory skipped.",
        },
      };
    }

    try {
      const url = new URL("https://ev-charging-stations-api.vercel.app/v1/stations/near");
      url.searchParams.set("lat", String(params.lat));
      url.searchParams.set("lng", String(params.lng));
      url.searchParams.set("radius", String(Math.min(100, Math.max(0.5, params.radiusKm))));
      url.searchParams.set("limit", "60");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "ParkSmart-EV-Finder/1.0",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return {
          stations: [],
          status: {
            status: "UNAVAILABLE",
            message: `BEE India EV API returned HTTP ${res.status}`,
          },
        };
      }

      const json = (await res.json()) as {
        success?: boolean;
        data?: Array<{
          id?: string;
          name?: string;
          operator?: string;
          address?: string;
          city?: string;
          state?: string;
          latitude?: number;
          longitude?: number;
          max_power_kw?: number;
          total_chargers?: number;
          standards?: string[];
        }>;
      };

      const list: ExternalEvChargerStation[] = [];
      for (const item of json.data ?? []) {
        const pLat = item.latitude;
        const pLng = item.longitude;
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
            (item.standards ?? [])
              .map((s) => mapBeeConnectorStandard(s))
              .filter((x): x is string => x !== null)
          )
        );
        const maxPowerKw =
          typeof item.max_power_kw === "number" && Number.isFinite(item.max_power_kw)
            ? item.max_power_kw
            : null;

        const addrParts = [item.address, item.city, item.state].filter(Boolean);
        list.push({
          id: `bee-${item.id ?? `${pLat}-${pLng}`}`,
          source: "BEE_INDIA_API",
          name: item.name?.trim() || item.operator?.trim() || "Public EV Charging Station",
          operator: item.operator?.trim() || null,
          address: addrParts.length > 0 ? addrParts.join(", ") : null,
          latitude: pLat,
          longitude: pLng,
          distanceKm,
          connectorStandards: standards,
          maxPowerKw,
          sockets:
            standards.length > 0
              ? `${standards.join(", ")}${maxPowerKw ? ` · ${Math.round(maxPowerKw)} kW` : ""}`
              : maxPowerKw
                ? `Up to ${Math.round(maxPowerKw)} kW`
                : null,
          totalConnectors:
            typeof item.total_chargers === "number" ? item.total_chargers : null,
          sourcesLabel: "BEE (Ministry of Power)",
          ownerVerified: false,
          stationDocsVerified: false,
          liveAvailabilityConnected: false,
          availabilityStatus: "UNKNOWN",
          availabilityUpdatedAt: null,
        });
      }

      return {
        stations: list,
        status: { status: "OK" },
      };
    } catch {
      return {
        stations: [],
        status: {
          status: "UNAVAILABLE",
          message: "BEE India free EV API could not be reached.",
        },
      };
    }
  };

  // Query local 28,553-station India Open EV Dataset + free online feeds in parallel
  const localIndiaResult =
    enableLocalDataset && isInsideIndiaBounds(params.lat, params.lng)
      ? queryIndiaOpenEvDataset({
          lat: params.lat,
          lng: params.lng,
          radiusKm: params.radiusKm,
        })
      : { stations: [], totalIndexed: 0 };

  const indiaOpenDatasetStatus: NearbyChargersResult["sources"]["indiaOpenDataset"] =
    !enableLocalDataset || !isInsideIndiaBounds(params.lat, params.lng)
      ? { status: "SKIPPED", count: 0 }
      : localIndiaResult.totalIndexed > 0
        ? { status: "OK", count: localIndiaResult.stations.length }
        : { status: "UNAVAILABLE", count: 0 };

  const [googleRes, beeIndiaRes, ocmRes, overpassRes] = await Promise.all([
    fetchGooglePlaces(),
    fetchBeeIndiaApi(),
    fetchOcm(),
    fetchOverpass(),
  ]);
  const merged = deduplicateStations([
    ...googleRes.stations,
    ...localIndiaResult.stations,
    ...beeIndiaRes.stations,
    ...ocmRes.stations,
    ...overpassRes.stations,
  ]);
  const sources: NearbyChargersResult["sources"] = {
    indiaOpenDataset: indiaOpenDatasetStatus,
    beeIndiaApi: beeIndiaRes.status,
    googlePlaces: googleRes.status,
    openChargeMap: ocmRes.status,
    openStreetMapOverpass: overpassRes.status,
  };

  if (
    useCache &&
    (indiaOpenDatasetStatus.status === "OK" ||
      beeIndiaRes.status.status === "OK" ||
      googleRes.status.status === "OK" ||
      ocmRes.status.status === "OK" ||
      overpassRes.status.status === "OK")
  ) {
    nearbyCache.set(cacheKey, {
      expiresAt: Date.now() + 60_000,
      rawStations: merged,
      sources,
    });
  }

  return {
    stations: applyFilters(merged),
    center: { lat: params.lat, lng: params.lng },
    radiusKm: params.radiusKm,
    sources,
  };
}
