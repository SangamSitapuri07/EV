import { haversineKm } from "@/lib/utils";
import {
  isInsideIndiaBounds,
  queryIndiaOpenEvDataset,
} from "./india-ev-dataset";
import {
  buildOverpassBboxQuery,
  formatSourceFreshness,
  parseOverpassElementsToStations,
  type ExternalEvChargerStation,
  type NearbyChargersResult,
  type NearbyProviderError,
  type NormalizedConnectorInfo,
  type OverpassElement,
} from "./nearby-chargers.shared";

export {
  buildOverpassBboxQuery,
  parseOverpassElementsToStations,
  type ExternalEvChargerStation,
  type NearbyChargersResult,
  type NearbyProviderError,
  type NormalizedConnectorInfo,
  type OverpassElement,
};

function mapOcmConnectionStandard(title?: string): string | null {
  if (!title) return null;
  const lower = title.toLowerCase();
  if (lower.includes("ccs")) return "CCS2";
  if (lower.includes("type 2") || lower.includes("mennekes")) return "TYPE2_AC";
  if (lower.includes("chademo")) return "CHADEMO";
  if (lower.includes("gb/t") || lower.includes("gb-t")) return "GB_T";
  if (lower.includes("j1772") || lower.includes("type 1")) return "TYPE1_J1772";
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

// 5-minute server cache respects external provider rate limits (OCM / Overpass / BEE)
const CACHE_TTL_MS = 5 * 60 * 1000;
const nearbyCache = new Map<
  string,
  {
    expiresAt: number;
    rawStations: ExternalEvChargerStation[];
    sources: NearbyChargersResult["sources"];
    providerErrors: NearbyProviderError[];
    allEnabledProvidersFailed: boolean;
    attributions: string[];
  }
>();

let ocmCooldownUntil = 0;

function normalizeTextTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  const stopWords = new Set([
    "ev",
    "charging",
    "station",
    "stations",
    "charger",
    "chargers",
    "public",
    "point",
    "points",
    "evcs",
    "limited",
    "ltd",
    "pvt",
    "private",
    "india",
    "road",
    "rd",
    "near",
  ]);
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !stopWords.has(t));
}

function tokenOverlapRatio(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const setA = new Set(aTokens);
  const setB = new Set(bTokens);
  let shared = 0;
  for (const t of setA) {
    if (setB.has(t)) shared++;
  }
  return shared / Math.min(setA.size, setB.size);
}

function normalizeOperator(op: string | null | undefined): string {
  if (!op) return "";
  return op
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(limited|ltd|pvt|india|energy|energies|echarge|pulsecharge|grid|b2c)/g, "");
}

function isGenericName(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return (
    lower === "public ev charging station" ||
    lower === "ev charging station" ||
    lower === "charging station"
  );
}

function areLikelySameStation(
  a: ExternalEvChargerStation,
  b: ExternalEvChargerStation,
  gapKm: number
): boolean {
  if (gapKm > 0.15) return false;

  const opA = normalizeOperator(a.operator);
  const opB = normalizeOperator(b.operator);
  const bothHaveOps = opA.length > 0 && opB.length > 0;
  const operatorsConflict =
    bothHaveOps && opA !== opB && !opA.includes(opB) && !opB.includes(opA);
  const operatorsMatch =
    bothHaveOps && (opA === opB || opA.includes(opB) || opB.includes(opA));

  // Never combine stations owned by two different operators (e.g. HPCL vs Tata Power 60m apart)
  if (operatorsConflict) return false;

  const nameOverlap = tokenOverlapRatio(
    normalizeTextTokens(a.name),
    normalizeTextTokens(b.name)
  );
  const addrOverlap = tokenOverlapRatio(
    normalizeTextTokens(a.address),
    normalizeTextTokens(b.address)
  );

  // Nearly identical GPS pin (<= 20 m): merge if generic placeholder, matching name, or matching operator
  if (gapKm <= 0.02) {
    if (isGenericName(a.name) || isGenericName(b.name)) return true;
    if (operatorsMatch || nameOverlap >= 0.4 || addrOverlap >= 0.5) return true;
  }

  // Within 150 m: merge only when same operator AND name or street address matches
  if (operatorsMatch && (nameOverlap >= 0.4 || addrOverlap >= 0.5)) {
    return true;
  }

  // Cross-feed same landmark without operator on one side (<= 60 m and strong name match)
  if (gapKm <= 0.06 && !operatorsConflict && nameOverlap >= 0.6) {
    return true;
  }

  return false;
}

export function deduplicateStations(
  stations: ExternalEvChargerStation[]
): ExternalEvChargerStation[] {
  const unique: ExternalEvChargerStation[] = [];
  for (const candidate of stations) {
    const existing = unique.find((item) => {
      const gapKm = haversineKm(
        item.latitude,
        item.longitude,
        candidate.latitude,
        candidate.longitude
      );
      return areLikelySameStation(item, candidate, gapKm);
    });

    if (!existing) {
      unique.push({
        ...candidate,
        connectors: [...candidate.connectors],
        connectorStandards: [...candidate.connectorStandards],
      });
      continue;
    }

    const mergedStandards = Array.from(
      new Set([...existing.connectorStandards, ...candidate.connectorStandards])
    );
    existing.connectorStandards = mergedStandards;
    if (candidate.connectors.length > 0 && existing.connectors.length === 0) {
      existing.connectors = [...candidate.connectors];
    }
    if (
      candidate.maxPowerKw !== null &&
      (existing.maxPowerKw === null || candidate.maxPowerKw > existing.maxPowerKw)
    ) {
      existing.maxPowerKw = candidate.maxPowerKw;
    }
    if (!existing.operator && candidate.operator) existing.operator = candidate.operator;
    if (!existing.address && candidate.address) existing.address = candidate.address;
    if (!existing.pricing && candidate.pricing) existing.pricing = candidate.pricing;
    if (!existing.sockets && candidate.sockets) existing.sockets = candidate.sockets;
    if (!existing.sourceUpdatedAt && candidate.sourceUpdatedAt) {
      existing.sourceUpdatedAt = candidate.sourceUpdatedAt;
      existing.freshnessLabel = candidate.freshnessLabel;
    }
    if (candidate.totalConnectors && !existing.totalConnectors) {
      existing.totalConnectors = candidate.totalConnectors;
    }
  }
  return unique;
}

export function clearNearbyChargersCacheForTests() {
  nearbyCache.clear();
  ocmCooldownUntil = 0;
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
  includeOpenChargeMap?: boolean;
  includeOverpass?: boolean;
}): Promise<NearbyChargersResult> {
  const fetchImpl = params.fetchFn ?? fetch;
  const enableLocalDataset = params.includeLocalIndiaDataset ?? !params.fetchFn;
  const enableBeeApi = params.includeBeeIndiaApi ?? !params.fetchFn;
  const enableOcm = params.includeOpenChargeMap ?? true;
  const enableOverpass = params.includeOverpass ?? true;
  const ocmKey = process.env.OPEN_CHARGE_MAP_API_KEY?.trim();

  const useCache =
    !params.fetchFn &&
    params.includeLocalIndiaDataset === undefined &&
    params.includeBeeIndiaApi === undefined &&
    params.includeOpenChargeMap === undefined &&
    params.includeOverpass === undefined;
  const cacheKey = `${params.lat.toFixed(3)},${params.lng.toFixed(3)},${params.radiusKm},${Boolean(ocmKey)}`;

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
      .slice(0, 500);

  if (useCache) {
    const cached = nearbyCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        stations: applyFilters(cached.rawStations),
        center: { lat: params.lat, lng: params.lng },
        radiusKm: params.radiusKm,
        sources: cached.sources,
        providerErrors: cached.providerErrors,
        allEnabledProvidersFailed: cached.allEnabledProvidersFailed,
        attributions: cached.attributions,
      };
    }
  }

  const fetchOcm = async (): Promise<{
    stations: ExternalEvChargerStation[];
    status: NearbyChargersResult["sources"]["openChargeMap"];
  }> => {
    if (!enableOcm) {
      return {
        stations: [],
        status: {
          configured: Boolean(ocmKey),
          status: "SKIPPED",
          message: "Open Charge Map skipped for this request.",
        },
      };
    }
    if (!ocmKey) {
      return {
        stations: [],
        status: {
          configured: false,
          status: "NOT_CONFIGURED",
          message:
            "OPEN_CHARGE_MAP_API_KEY is not configured; set it on the server to query Open Charge Map.",
        },
      };
    }
    if (Date.now() < ocmCooldownUntil) {
      return {
        stations: [],
        status: {
          configured: true,
          status: "UNAVAILABLE",
          message: "Open Charge Map rate-limit cooldown active; retrying shortly.",
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

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      // Pass API key strictly in header (never in URL query string) per security best practices
      const res = await fetchImpl(url.toString(), {
        headers: {
          "User-Agent": "ParkSmart-EV-Finder/1.0",
          "X-API-Key": ocmKey,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status === 403) {
        ocmCooldownUntil = Date.now() + 60_000;
        return {
          stations: [],
          status: {
            configured: true,
            status: "UNAVAILABLE",
            message: `Open Charge Map rate-limited or rejected key (HTTP ${res.status}).`,
          },
        };
      }

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
        UsageCost?: string;
        DataProvider?: { Title?: string; License?: string };
        AddressInfo?: {
          Title?: string;
          AddressLine1?: string;
          Town?: string;
          StateOrProvince?: string;
          Postcode?: string;
          Latitude?: number;
          Longitude?: number;
        };
        OperatorInfo?: { Title?: string };
        Connections?: Array<{
          PowerKW?: number;
          Quantity?: number;
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

        const connectors: NormalizedConnectorInfo[] = [];
        const standardsSet = new Set<string>();
        let totalConnectors = 0;
        let hasConnCount = false;

        for (const conn of poi.Connections ?? []) {
          const title = conn.ConnectionType?.Title?.trim();
          const std = mapOcmConnectionStandard(title);
          if (std) standardsSet.add(std);
          const kw =
            typeof conn.PowerKW === "number" && Number.isFinite(conn.PowerKW) && conn.PowerKW > 0
              ? conn.PowerKW
              : null;
          const qty =
            typeof conn.Quantity === "number" && Number.isFinite(conn.Quantity) && conn.Quantity > 0
              ? conn.Quantity
              : null;
          if (qty) {
            totalConnectors += qty;
            hasConnCount = true;
          }
          if (title || std || kw) {
            connectors.push({
              standard: std ?? (title || "UNKNOWN"),
              powerKw: kw,
              count: qty,
              label: `${title ?? std ?? "Connector"}${kw ? ` (${kw} kW)` : ""}`,
            });
          }
        }

        const standards = Array.from(standardsSet);
        const maxPowerKw = connectors.reduce<number | null>((acc, c) => {
          if (c.powerKw === null) return acc;
          return acc === null ? c.powerKw : Math.max(acc, c.powerKw);
        }, null);

        const sourceUpdatedAt = poi.DateLastStatusUpdate ?? null;
        const pricing = poi.UsageCost?.trim() || null;

        list.push({
          id: `ocm-${poi.ID}`,
          source: "OPEN_CHARGE_MAP",
          sourceId: String(poi.ID),
          name: poi.AddressInfo?.Title?.trim() || "Public EV Charging Station",
          operator: poi.OperatorInfo?.Title?.trim() || null,
          address:
            [
              poi.AddressInfo?.AddressLine1,
              poi.AddressInfo?.Town,
              poi.AddressInfo?.StateOrProvince,
              poi.AddressInfo?.Postcode,
            ]
              .filter(Boolean)
              .join(", ") || null,
          latitude: pLat,
          longitude: pLng,
          distanceKm,
          connectors,
          connectorStandards: standards,
          maxPowerKw,
          sockets:
            standards.length > 0
              ? `Connectors: ${standards.join(", ")}${maxPowerKw ? ` (up to ${maxPowerKw} kW)` : ""}`
              : null,
          totalConnectors: hasConnCount ? totalConnectors : null,
          pricing,
          sourcesLabel: poi.DataProvider?.Title
            ? `Open Charge Map · ${poi.DataProvider.Title}`
            : "Open Charge Map contributors (CC BY 4.0)",
          sourceUpdatedAt,
          freshnessLabel: formatSourceFreshness(
            sourceUpdatedAt,
            "Open Charge Map listing"
          ),
          listingType: "SOURCE_LISTED",
          ownerVerified: false,
          stationDocsVerified: false,
          liveAvailabilityConnected: false,
          availabilityStatus: "UNKNOWN",
          availabilityUpdatedAt: null,
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
    if (!enableOverpass) {
      return {
        stations: [],
        status: {
          status: "SKIPPED",
          message: "OpenStreetMap Overpass skipped for this request.",
        },
      };
    }

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
            ? "Community BEE snapshot API skipped for this request."
            : "Coordinates outside India; BEE India directory skipped.",
        },
      };
    }

    try {
      const url = new URL("https://ev-charging-stations-api.vercel.app/v1/stations/near");
      url.searchParams.set("lat", String(params.lat));
      url.searchParams.set("lng", String(params.lng));
      url.searchParams.set("radius", String(Math.min(100, Math.max(0.5, params.radiusKm))));
      url.searchParams.set("limit", "100");

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
            message: `Community BEE directory API returned HTTP ${res.status}`,
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

      const beeSnapshotIso = "2025-10-26T00:00:00.000Z";
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
        const connectors: NormalizedConnectorInfo[] = standards.map((std) => ({
          standard: std,
          powerKw: maxPowerKw,
          count: null,
          label: maxPowerKw ? `${std} (${maxPowerKw} kW)` : std,
        }));

        const addrParts = [item.address, item.city, item.state].filter(Boolean);
        const rawId = item.id ?? `${pLat}-${pLng}`;
        list.push({
          id: `bee-${rawId}`,
          source: "BEE_INDIA_API",
          sourceId: rawId,
          name: item.name?.trim() || item.operator?.trim() || "Public EV Charging Station",
          operator: item.operator?.trim() || null,
          address: addrParts.length > 0 ? addrParts.join(", ") : null,
          latitude: pLat,
          longitude: pLng,
          distanceKm,
          connectors,
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
          pricing: null,
          sourcesLabel: "BEE Oct 2025 directory (community API, not official BEE)",
          sourceUpdatedAt: beeSnapshotIso,
          freshnessLabel: "BEE snapshot Oct 26, 2025",
          listingType: "SOURCE_LISTED",
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
          message: "Community BEE directory API could not be reached.",
        },
      };
    }
  };

  // Query local 24.5k-station India Open EV Dataset + external feeds in parallel
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
      ? {
          status: "SKIPPED",
          count: 0,
          message: !enableLocalDataset
            ? "Local India dataset skipped for this request."
            : "Coordinates outside India.",
        }
      : localIndiaResult.totalIndexed > 0
        ? { status: "OK", count: localIndiaResult.stations.length }
        : {
            status: "UNAVAILABLE",
            count: 0,
            message: "Local India EV CSV dataset could not be loaded.",
          };

  const [beeIndiaRes, ocmRes, overpassRes] = await Promise.all([
    fetchBeeIndiaApi(),
    fetchOcm(),
    fetchOverpass(),
  ]);

  const merged = deduplicateStations([
    ...localIndiaResult.stations,
    ...beeIndiaRes.stations,
    ...ocmRes.stations,
    ...overpassRes.stations,
  ]);

  const sources: NearbyChargersResult["sources"] = {
    indiaOpenDataset: indiaOpenDatasetStatus,
    beeIndiaApi: beeIndiaRes.status,
    openChargeMap: ocmRes.status,
    openStreetMapOverpass: overpassRes.status,
  };

  const providerErrors: NearbyProviderError[] = [];
  if (indiaOpenDatasetStatus.status === "UNAVAILABLE") {
    providerErrors.push({
      provider: "indiaOpenDataset",
      code: "DATASET_UNAVAILABLE",
      message: indiaOpenDatasetStatus.message ?? "Local India EV dataset unavailable.",
    });
  }
  if (beeIndiaRes.status.status === "UNAVAILABLE") {
    providerErrors.push({
      provider: "beeIndiaApi",
      code: "BEE_API_UNAVAILABLE",
      message: beeIndiaRes.status.message ?? "Community BEE directory API unavailable.",
    });
  }
  if (ocmRes.status.configured && ocmRes.status.status === "UNAVAILABLE") {
    providerErrors.push({
      provider: "openChargeMap",
      code: "OCM_UNAVAILABLE",
      message: ocmRes.status.message ?? "Open Charge Map API unavailable.",
    });
  }
  if (overpassRes.status.status === "UNAVAILABLE") {
    providerErrors.push({
      provider: "openStreetMapOverpass",
      code: "OVERPASS_UNAVAILABLE",
      message: overpassRes.status.message ?? "OpenStreetMap Overpass API unavailable.",
    });
  }

  const anyEnabledSucceeded =
    indiaOpenDatasetStatus.status === "OK" ||
    beeIndiaRes.status.status === "OK" ||
    ocmRes.status.status === "OK" ||
    overpassRes.status.status === "OK";

  const anyProviderFailed = providerErrors.length > 0;
  const allEnabledProvidersFailed = !anyEnabledSucceeded && anyProviderFailed;

  const attributions: string[] = [];
  if (indiaOpenDatasetStatus.status === "OK") {
    attributions.push(
      "India EV Charging Dataset (ODbL v1.0 — Kia/Numocity, MG eHUB, ChargeZone, Ather Grid, Bolt.Earth)"
    );
  }
  if (beeIndiaRes.status.status === "OK") {
    attributions.push(
      "Bureau of Energy Efficiency (BEE) Oct 2025 directory via community REST snapshot (not an official BEE service)"
    );
  }
  if (ocmRes.status.status === "OK") {
    attributions.push("Open Charge Map contributors (CC BY 4.0, openchargemap.org)");
  }
  if (overpassRes.status.status === "OK") {
    attributions.push("OpenStreetMap contributors (ODbL)");
  }

  if (useCache && anyEnabledSucceeded) {
    nearbyCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      rawStations: merged,
      sources,
      providerErrors,
      allEnabledProvidersFailed,
      attributions,
    });
  }

  return {
    stations: applyFilters(merged),
    center: { lat: params.lat, lng: params.lng },
    radiusKm: params.radiusKm,
    sources,
    providerErrors,
    allEnabledProvidersFailed,
    attributions,
  };
}
