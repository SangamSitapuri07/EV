"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Route,
  BatteryCharging,
  MapPin,
  Flame,
  Clock,
  Zap,
  ArrowRight,
  Info,
} from "lucide-react";
import { Badge, Button, Card, Input, Select, StatusPill } from "@/components/ui/primitives";

interface HeatmapZone {
  facilityId: string;
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  occupancyPct: number;
  demandLevel: "HIGH" | "MODERATE" | "LOW";
  availableSpaces: number;
  availableConnectors: number;
  dataSourceType: string;
}

interface TripPlanResult {
  totalDistanceKm: number;
  estimatedDriveMinutes: number;
  effectiveRangeKm: number;
  needsChargingStop: boolean;
  recommendedStops: Array<{
    facilityId: string;
    slug: string;
    name: string;
    address: string;
    maxChargerKw: number;
    availableConnectors: number;
    connectorStandards: string[];
    estimatedChargeMinutes: number;
    distanceFromCorridorMidpointKm: number;
    dataSourceType: string;
  }>;
  dataDisclosure: string;
}

const CITY_PRESETS = [
  { label: "Ludhiana Clock Tower (Origin)", lat: 30.901, lng: 75.8573 },
  { label: "Sarabha Nagar Market", lat: 30.8842, lng: 75.8172 },
  { label: "Ferozepur Road / MBD Mall", lat: 30.8768, lng: 75.7924 },
  { label: "Chandigarh Sector 17 Corridor", lat: 30.7398, lng: 76.7827 },
];

export default function TripPlannerPage() {
  const [zones, setZones] = useState<HeatmapZone[]>([]);
  const [heatmapDisclaimer, setHeatmapDisclaimer] = useState<string>("");
  const [originIdx, setOriginIdx] = useState("0");
  const [destIdx, setDestIdx] = useState("3");
  const [soc, setSoc] = useState("24");
  const [vehicleRangeKm, setVehicleRangeKm] = useState("340");
  const [connector, setConnector] = useState("CCS2");
  const [plan, setPlan] = useState<TripPlanResult | null>(null);
  const [planning, setPlanning] = useState(false);

  useEffect(() => {
    fetch("/api/v1/insights/heatmap")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setZones(j.data.zones ?? []);
          setHeatmapDisclaimer(j.data.disclaimer ?? "");
        }
      })
      .catch(() => {});
  }, []);

  async function handlePlanTrip(e: React.FormEvent) {
    e.preventDefault();
    setPlanning(true);
    const origin = CITY_PRESETS[Number(originIdx)]!;
    const dest = CITY_PRESETS[Number(destIdx)]!;
    try {
      const res = await fetch("/api/v1/insights/ev-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originLat: origin.lat,
          originLng: origin.lng,
          destLat: dest.lat,
          destLng: dest.lng,
          currentBatteryPct: Number(soc),
          vehicleRangeKm: Number(vehicleRangeKm),
          connectorStandard: connector,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setPlan(json.data);
      }
    } finally {
      setPlanning(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">Rule-Based Analytics + Live DB State</Badge>
          <Badge variant="info">Transparent Approximations</Badge>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Route className="h-6 w-6 text-emerald-700" />
          EV Trip Charge Planner &amp; City Occupancy Heatmap
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Calculate SoC range margins along your corridor, locate compatible DC fast chargers, and inspect real-time facility load.
        </p>
      </div>

      {/* EV Trip Planner */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-5 p-6 space-y-4">
          <h2 className="font-bold text-slate-900 flex items-center gap-2">
            <BatteryCharging className="h-5 w-5 text-amber-600" />
            Plan En-Route Charging Stop
          </h2>
          <form onSubmit={handlePlanTrip} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Origin</label>
              <Select value={originIdx} onChange={(e) => setOriginIdx(e.target.value)}>
                {CITY_PRESETS.map((p, idx) => (
                  <option key={p.label} value={idx}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Destination</label>
              <Select value={destIdx} onChange={(e) => setDestIdx(e.target.value)}>
                {CITY_PRESETS.map((p, idx) => (
                  <option key={p.label} value={idx}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Current Battery (%)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={soc}
                  onChange={(e) => setSoc(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Full Range (km)
                </label>
                <Input
                  type="number"
                  min={50}
                  max={1000}
                  value={vehicleRangeKm}
                  onChange={(e) => setVehicleRangeKm(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Connector Standard
              </label>
              <Select value={connector} onChange={(e) => setConnector(e.target.value)}>
                <option value="CCS2">CCS2 (DC Fast)</option>
                <option value="TYPE2_AC">Type 2 AC</option>
                <option value="CHADEMO">CHAdeMO</option>
                <option value="BHARAT_DC001">Bharat DC-001</option>
              </Select>
            </div>
            <Button type="submit" variant="emerald" className="w-full" disabled={planning}>
              {planning ? "Computing Corridor Stops..." : "Compute Recommended Stops"}
            </Button>
          </form>
        </Card>

        <div className="lg:col-span-7 space-y-4">
          {!plan ? (
            <Card className="p-8 text-center text-sm text-slate-600 h-full flex flex-col justify-center">
              Choose an origin, destination, and battery State-of-Charge on the left to evaluate compatible EV hubs.
            </Card>
          ) : (
            <Card className="p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-bold text-slate-900">Route Energy Assessment</h3>
                  <p className="text-xs text-slate-600">
                    Direct distance: <strong>{plan.totalDistanceKm} km</strong> (~{plan.estimatedDriveMinutes} min) · Effective range:{" "}
                    <strong>{plan.effectiveRangeKm} km</strong>
                  </p>
                </div>
                <Badge variant={plan.needsChargingStop ? "warning" : "success"}>
                  {plan.needsChargingStop
                    ? "Charging Stop Recommended"
                    : "Range Sufficient (+15% Reserve)"}
                </Badge>
              </div>

              <div className="space-y-3">
                {plan.recommendedStops.map((stop) => (
                  <div
                    key={stop.facilityId}
                    className="rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{stop.name}</span>
                        <Badge variant="info">{stop.maxChargerKw} kW</Badge>
                        <Badge variant="neutral">{stop.dataSourceType}</Badge>
                      </div>
                      <div className="text-xs text-slate-600 flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> {stop.address} ·{" "}
                        {stop.distanceFromCorridorMidpointKm} km from midpoint
                      </div>
                      <div className="text-xs text-emerald-700 font-medium">
                        {stop.availableConnectors} free connector(s) · {stop.connectorStandards.join(", ")}
                      </div>
                    </div>
                    <div className="text-right space-y-1.5">
                      <div className="text-xs text-slate-600 flex items-center sm:justify-end gap-1">
                        <Clock className="h-3.5 w-3.5" /> ~{stop.estimatedChargeMinutes} min stop
                      </div>
                      <Link href={`/facilities/${stop.slug}`}>
                        <Button size="sm" variant="primary">
                          Reserve Charger <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600 flex items-start gap-2">
                <Info className="h-4 w-4 shrink-0 text-slate-500 mt-0.5" />
                {plan.dataDisclosure}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* City-Wide Occupancy Heatmap */}
      <Card className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <Flame className="h-5 w-5 text-amber-600" />
              City-Wide Parking &amp; EV Demand Heatmap
            </h2>
            {heatmapDisclaimer && <p className="text-xs text-slate-600">{heatmapDisclaimer}</p>}
          </div>
          <Badge variant="neutral">{zones.length} Active Hubs Monitored</Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {zones.map((cell) => {
            const heatColor =
              cell.demandLevel === "HIGH"
                ? "border-red-300 bg-red-50/40"
                : cell.demandLevel === "MODERATE"
                  ? "border-amber-300 bg-amber-50/40"
                  : "border-emerald-300 bg-emerald-50/40";
            return (
              <div key={cell.facilityId} className={`rounded-xl border p-4 space-y-3 ${heatColor}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-900">{cell.name}</div>
                    <div className="text-xs text-slate-600">{cell.city}</div>
                  </div>
                  <StatusPill
                    status={
                      cell.demandLevel === "HIGH"
                        ? "OCCUPIED"
                        : cell.demandLevel === "MODERATE"
                          ? "HELD"
                          : "AVAILABLE"
                    }
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>Current Occupancy</span>
                    <span className="font-bold">{cell.occupancyPct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/80 overflow-hidden border border-slate-200">
                    <div
                      className={`h-full ${
                        cell.demandLevel === "HIGH"
                          ? "bg-red-500"
                          : cell.demandLevel === "MODERATE"
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.min(100, cell.occupancyPct)}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-700">
                  <span>
                    Free bays: <strong>{cell.availableSpaces}</strong>
                  </span>
                  <Badge variant="neutral">{cell.dataSourceType}</Badge>
                </div>

                {cell.availableConnectors > 0 && (
                  <div className="text-xs text-amber-800 flex items-center gap-1 font-medium">
                    <Zap className="h-3.5 w-3.5" />
                    {cell.availableConnectors} EV connector(s) free
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
