import fs from "node:fs";
import path from "node:path";
import { haversineKm } from "@/lib/utils";
import {
  formatSourceFreshness,
  type ExternalEvChargerStation,
  type NormalizedConnectorInfo,
} from "./nearby-chargers.shared";

interface IndiaDatasetRow {
  id: string;
  sourceId: string;
  name: string;
  operator: string | null;
  address: string | null;
  lat: number;
  lng: number;
  connectors: NormalizedConnectorInfo[];
  connectorStandards: string[];
  maxPowerKw: number | null;
  sockets: string | null;
  totalConnectors: number | null;
  pricing: string | null;
  sources: string | null;
  lastUpdated: string | null;
}

let cachedRows: IndiaDatasetRow[] | null = null;

function parseRfc4180Csv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && content[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") {
        rows.push(row);
      }
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function mapIndiaConnectorToken(tokenRaw: string): string | null {
  const token = tokenRaw.trim().toLowerCase();
  if (!token) return null;
  if (token.startsWith("ccs2")) return "CCS2";
  if (token.startsWith("type2")) return "TYPE2_AC";
  if (token.startsWith("chademo")) return "CHADEMO";
  if (token.startsWith("gb/t") || token.startsWith("gb-t")) return "GB_T";
  if (token.startsWith("bharat ac")) return "BHARAT_AC001";
  if (token.startsWith("bharat dc")) return "BHARAT_DC001";
  if (token.startsWith("type1")) return "TYPE1_J1772";
  if (token.startsWith("3-pin")) return "THREE_PIN_15A";
  return null;
}

function parseIndiaConnectors(rawConnectors: string): {
  connectors: NormalizedConnectorInfo[];
  standards: string[];
} {
  const standards = new Set<string>();
  const connectors: NormalizedConnectorInfo[] = [];

  for (const part of rawConnectors.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [typePart, rest] = trimmed.split("@");
    const std = mapIndiaConnectorToken(typePart ?? "");
    if (std) standards.add(std);

    let powerKw: number | null = null;
    let count: number | null = null;
    if (rest) {
      const kwMatch = rest.match(/([\d.]+)\s*kw/i);
      if (kwMatch?.[1]) {
        const parsedKw = parseFloat(kwMatch[1]);
        if (Number.isFinite(parsedKw) && parsedKw > 0) powerKw = parsedKw;
      }
      const xMatch = rest.match(/x\s*(\d+)/i);
      if (xMatch?.[1]) {
        const parsedCount = parseInt(xMatch[1], 10);
        if (Number.isFinite(parsedCount) && parsedCount > 0) count = parsedCount;
      }
    }
    if (!count && typePart) {
      const xMatch = typePart.match(/x\s*(\d+)/i);
      if (xMatch?.[1]) {
        const parsedCount = parseInt(xMatch[1], 10);
        if (Number.isFinite(parsedCount) && parsedCount > 0) count = parsedCount;
      }
    }

    connectors.push({
      standard: std ?? (typePart?.trim() || "UNKNOWN"),
      powerKw,
      count,
      label: trimmed,
    });
  }

  return { connectors, standards: Array.from(standards) };
}

function loadIndiaOpenDataset(): IndiaDatasetRow[] {
  if (cachedRows) return cachedRows;

  const filePath = path.join(process.cwd(), "src/data/india-ev-stations.csv");
  if (!fs.existsSync(filePath)) {
    cachedRows = [];
    return cachedRows;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const rows = parseRfc4180Csv(content);
  if (rows.length < 2) {
    cachedRows = [];
    return cachedRows;
  }

  const header = rows[0]!;
  const col = (name: string) => header.indexOf(name);

  const iName = col("name");
  const iOp = col("operator");
  const iNet = col("network");
  const iState = col("state");
  const iDistrict = col("district");
  const iCity = col("city");
  const iAddress = col("address");
  const iPostcode = col("postcode");
  const iLat = col("lat");
  const iLng = col("lng");
  const iConnectors = col("connectors");
  const iMaxPower = col("max_power_kw");
  const iNPoints = col("n_points");
  const iAccess = col("access");
  const iPricing = col("pricing");
  const iSources = col("sources");
  const iNSources = col("n_sources");
  const iLastUpdated = col("last_updated");

  const parsed: IndiaDatasetRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const access = (r[iAccess] ?? "").replace(/\|/g, "").trim().toLowerCase();
    if (
      access === "20" ||
      access.includes("private") ||
      access === "no" ||
      access === "permit"
    ) {
      continue;
    }

    const lat = Number(r[iLat]);
    const lng = Number(r[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const rawAddr = (r[iAddress] ?? "").replace(/\s+/g, " ").trim();
    const rawConnectors = (r[iConnectors] ?? "").trim();
    const nSources = Number(r[iNSources] ?? "1");
    // Drop unverified single-source rows that lack both a street address and connector metadata
    if (!rawAddr && !rawConnectors && (!Number.isFinite(nSources) || nSources < 2)) {
      continue;
    }

    const city = (r[iCity] ?? "").trim();
    const district = (r[iDistrict] ?? "").trim();
    const state = (r[iState] ?? "").trim();
    const postcode = (r[iPostcode] ?? "").trim();

    const fallbackLoc = [city || district, state, postcode].filter(Boolean).join(", ");
    const address = rawAddr || fallbackLoc || null;

    const maxPowerNum = Number(r[iMaxPower]);
    const maxPowerKw =
      Number.isFinite(maxPowerNum) && maxPowerNum > 0 ? maxPowerNum : null;

    const nPointsNum = parseInt(r[iNPoints] ?? "", 10);
    const totalConnectors =
      Number.isFinite(nPointsNum) && nPointsNum > 0 ? nPointsNum : null;

    const socketsText = rawConnectors
      ? rawConnectors
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean)
          .join(" · ")
      : null;

    const operator = (r[iOp] ?? "").trim() || (r[iNet] ?? "").trim() || null;
    const { connectors, standards } = parseIndiaConnectors(rawConnectors);

    parsed.push({
      id: `india-ev-${i}`,
      sourceId: String(i),
      name: (r[iName] ?? "").trim() || operator || "Public EV Charging Station",
      operator,
      address,
      lat,
      lng,
      connectors,
      connectorStandards: standards,
      maxPowerKw,
      sockets: socketsText,
      totalConnectors,
      pricing: (r[iPricing] ?? "").trim() || null,
      sources: (r[iSources] ?? "").trim() || null,
      lastUpdated: (r[iLastUpdated] ?? "").trim() || null,
    });
  }

  cachedRows = parsed;
  return cachedRows;
}

export function isInsideIndiaBounds(lat: number, lng: number): boolean {
  return lat >= 6 && lat <= 38.5 && lng >= 67.5 && lng <= 98;
}

export function queryIndiaOpenEvDataset(params: {
  lat: number;
  lng: number;
  radiusKm: number;
}): { stations: ExternalEvChargerStation[]; totalIndexed: number } {
  const rows = loadIndiaOpenDataset();
  if (rows.length === 0) {
    return { stations: [], totalIndexed: 0 };
  }

  const latDelta = params.radiusKm / 110.574;
  const edgeLat = Math.min(89.9, Math.abs(params.lat) + latDelta);
  const cosLat = Math.max(0.05, Math.cos((edgeLat * Math.PI) / 180));
  const lngDelta = params.radiusKm / (111.32 * cosLat);

  const matches: ExternalEvChargerStation[] = [];
  for (const row of rows) {
    if (Math.abs(row.lat - params.lat) > latDelta) continue;
    if (Math.abs(row.lng - params.lng) > lngDelta) continue;

    const distanceKm = haversineKm(params.lat, params.lng, row.lat, row.lng);
    if (distanceKm > params.radiusKm) continue;

    matches.push({
      id: row.id,
      source: "INDIA_OPEN_EV_DATA",
      sourceId: row.sourceId,
      name: row.name,
      operator: row.operator,
      address: row.address,
      latitude: row.lat,
      longitude: row.lng,
      distanceKm,
      connectors: row.connectors,
      connectorStandards: row.connectorStandards,
      maxPowerKw: row.maxPowerKw,
      sockets: row.sockets,
      totalConnectors: row.totalConnectors,
      pricing: row.pricing,
      sourcesLabel: row.sources
        ? `${row.sources} · India EV Charging Dataset (ODbL v1.0)`
        : "India EV Charging Dataset (ODbL v1.0)",
      sourceUpdatedAt: row.lastUpdated,
      freshnessLabel: formatSourceFreshness(
        row.lastUpdated,
        "Dataset snapshot Nov 16, 2026"
      ),
      listingType: "SOURCE_LISTED",
      ownerVerified: false,
      stationDocsVerified: false,
      liveAvailabilityConnected: false,
      availabilityStatus: "UNKNOWN",
      availabilityUpdatedAt: row.lastUpdated,
    });
  }

  matches.sort((a, b) => a.distanceKm - b.distanceKm);
  return {
    stations: matches.slice(0, 800),
    totalIndexed: rows.length,
  };
}
