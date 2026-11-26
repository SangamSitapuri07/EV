import fs from "node:fs";
import path from "node:path";
import { haversineKm } from "@/lib/utils";
import type { ExternalEvChargerStation } from "./nearby-chargers.shared";

interface IndiaDatasetRow {
  id: string;
  name: string;
  operator: string | null;
  address: string | null;
  lat: number;
  lng: number;
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

function mapIndiaConnectorStandards(rawConnectors: string): string[] {
  const standards = new Set<string>();
  for (const part of rawConnectors.split(";")) {
    const token = part.split("@")[0]?.trim().toLowerCase() ?? "";
    if (!token) continue;
    if (token.startsWith("ccs2")) standards.add("CCS2");
    else if (token.startsWith("type2")) standards.add("TYPE2_AC");
    else if (token.startsWith("chademo")) standards.add("CHADEMO");
    else if (token.startsWith("gb/t") || token.startsWith("gb-t")) standards.add("GB_T");
    else if (token.startsWith("bharat ac")) standards.add("BHARAT_AC001");
    else if (token.startsWith("bharat dc")) standards.add("BHARAT_DC001");
    else if (token.startsWith("type1")) standards.add("TYPE1_J1772");
    else if (token.startsWith("3-pin")) standards.add("THREE_PIN_15A");
  }
  return Array.from(standards);
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
  const iPricing = col("pricing");
  const iSources = col("sources");
  const iLastUpdated = col("last_updated");

  const parsed: IndiaDatasetRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const lat = Number(r[iLat]);
    const lng = Number(r[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const rawAddr = (r[iAddress] ?? "").replace(/\s+/g, " ").trim();
    const city = (r[iCity] ?? "").trim();
    const district = (r[iDistrict] ?? "").trim();
    const state = (r[iState] ?? "").trim();
    const postcode = (r[iPostcode] ?? "").trim();

    const fallbackLoc = [city || district, state, postcode].filter(Boolean).join(", ");
    const address = rawAddr || fallbackLoc || null;

    const rawConnectors = (r[iConnectors] ?? "").trim();
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

    parsed.push({
      id: `india-ev-${i}`,
      name: (r[iName] ?? "").trim() || operator || "Public EV Charging Station",
      operator,
      address,
      lat,
      lng,
      connectorStandards: mapIndiaConnectorStandards(rawConnectors),
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
      name: row.name,
      operator: row.operator,
      address: row.address,
      latitude: row.lat,
      longitude: row.lng,
      distanceKm,
      connectorStandards: row.connectorStandards,
      maxPowerKw: row.maxPowerKw,
      sockets: row.sockets,
      totalConnectors: row.totalConnectors,
      pricing: row.pricing,
      sourcesLabel: row.sources,
      ownerVerified: false,
      stationDocsVerified: false,
      liveAvailabilityConnected: false,
      availabilityStatus: "UNKNOWN",
      availabilityUpdatedAt: row.lastUpdated,
    });
  }

  matches.sort((a, b) => a.distanceKm - b.distanceKm);
  return {
    stations: matches.slice(0, 120),
    totalIndexed: rows.length,
  };
}
