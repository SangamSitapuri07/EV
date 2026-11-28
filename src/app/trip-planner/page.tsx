"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Route,
  BatteryCharging,
  MapPin,
  Flame,
  Clock,
  Zap,
  ArrowRight,
  LocateFixed,
  Navigation,
} from "lucide-react";
import { Badge, Button, Card, Input, Select, StatusPill } from "@/components/ui/primitives";

const TripCorridorMap = dynamic(
  () => import("@/components/map/trip-corridor-map").then((m) => m.TripCorridorMap),
  { ssr: false }
);

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
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  routeSource: "OSRM" | "DIRECT_FALLBACK";
  routePolyline: Array<[number, number]>;
  totalDistanceKm: number;
  estimatedDriveMinutes: number;
  effectiveRangeKm: number;
  needsChargingStop: boolean;
  recommendedStops: Array<{
    facilityId: string;
    slug: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    maxChargerKw: number;
    availableConnectors: number;
    connectorStandards: string[];
    estimatedChargeMinutes: number;
    distanceFromCorridorMidpointKm: number;
    dataSourceType: string;
  }>;
  corridorPublicStops: Array<{
    id: string;
    source: string;
    name: string;
    operator: string | null;
    address: string | null;
    latitude: number;
    longitude: number;
    maxPowerKw: number | null;
    connectorStandards: string[];
    sockets: string | null;
    pricing: string | null;
    freshnessLabel: string;
    distanceFromOriginKm: number;
    distanceFromCorridorKm: number;
    estimatedChargeMinutes: number;
    listingType: "SOURCE_LISTED";
    liveAvailabilityConnected: false;
  }>;
  dataDisclosure: string;
}

async function geocodePlace(query: string): Promise<{ lat: number; lng: number } | null> {
  const coordMatch = query
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = Number(coordMatch[1]);
    const lng = Number(coordMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!rows[0]) return null;
  return { lat: Number(rows[0].lat), lng: Number(rows[0].lon) };
}

export default function TripPlannerPage() {
  const [zones, setZones] = useState<HeatmapZone[]>([]);
  const [heatmapDisclaimer, setHeatmapDisclaimer] = useState<string>("");
  const [originQuery, setOriginQuery] = useState("");
  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [destQuery, setDestQuery] = useState("");
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [soc, setSoc] = useState("24");
  const [vehicleRangeKm, setVehicleRangeKm] = useState("340");
  const [connector, setConnector] = useState("CCS2");
  const [plan, setPlan] = useState<TripPlanResult | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function handleUseCurrentGps() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setOriginCoords(coords);
        setOriginQuery(`${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
        setError(null);
      },
      () => {
        setError("Location access declined. Enter your origin city or address manually.");
      }
    );
  }

  function fillQuickCorridor(
    fromLabel: string,
    from: { lat: number; lng: number },
    toLabel: string,
    to: { lat: number; lng: number }
  ) {
    setOriginQuery(fromLabel);
    setOriginCoords(from);
    setDestQuery(toLabel);
    setDestCoords(to);
    setError(null);
  }

  async function handlePlanTrip(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPlanning(true);
    try {
      const origin = originCoords ?? (await geocodePlace(originQuery));
      const dest = destCoords ?? (await geocodePlace(destQuery));
      if (!origin || !dest) {
        setError("Could not locate origin or destination. Enter a valid city/address or use GPS.");
        return;
      }

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
      } else {
        setError(json.error?.message || "Could not plan trip");
      }
    } catch {
      setError("Network error planning trip");
    } finally {
      setPlanning(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Route className="h-6 w-6 text-emerald-600" />
          EV Route Planner &amp; Live Occupancy Heatmap
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          Plan charging stops along your road corridor using real GPS / city search, public EV
          directories, and ParkSmart bookable hubs.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-12 items-start">
        <Card className="lg:col-span-7 p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <BatteryCharging className="h-5 w-5 text-amber-600" />
              EV Corridor Range &amp; Stop Planner
            </h2>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() =>
                  fillQuickCorridor(
                    "Ludhiana, Punjab",
                    { lat: 30.901, lng: 75.8573 },
                    "Chandigarh, India",
                    { lat: 30.7333, lng: 76.7794 }
                  )
                }
                className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Ludhiana → Chandigarh
              </button>
              <button
                type="button"
                onClick={() =>
                  fillQuickCorridor(
                    "Jalandhar, Punjab",
                    { lat: 31.326, lng: 75.5762 },
                    "Amritsar, Punjab",
                    { lat: 31.634, lng: 74.8723 }
                  )
                }
                className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Jalandhar → Amritsar
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handlePlanTrip} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Origin Address or GPS Coordinates
              </label>
              <div className="flex gap-2">
                <Input
                  value={originQuery}
                  onChange={(e) => {
                    setOriginQuery(e.target.value);
                    setOriginCoords(null);
                  }}
                  placeholder="Enter starting city / address"
                  required
                />
                <Button type="button" variant="outline" size="sm" onClick={handleUseCurrentGps}>
                  <LocateFixed className="h-4 w-4" />
                  GPS
                </Button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Destination Address / City
              </label>
              <Input
                value={destQuery}
                onChange={(e) => {
                  setDestQuery(e.target.value);
                  setDestCoords(null);
                }}
                placeholder="Enter destination city / address"
                required
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Battery SoC (%)
                </label>
                <Input
                  type="number"
                  min={5}
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
                  min={80}
                  max={900}
                  value={vehicleRangeKm}
                  onChange={(e) => setVehicleRangeKm(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Connector
                </label>
                <Select value={connector} onChange={(e) => setConnector(e.target.value)}>
                  <option value="CCS2">CCS2 (DC Fast)</option>
                  <option value="TYPE2_AC">Type 2 AC</option>
                  <option value="CHADEMO">CHAdeMO</option>
                  <option value="ALL">All Connectors</option>
                </Select>
              </div>
            </div>

            <Button type="submit" variant="emerald" className="w-full" disabled={planning}>
              {planning ? "Calculating Corridor..." : "Calculate Charging Stops"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          {plan && (
            <div className="space-y-4 border-t border-slate-200 pt-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-slate-100 p-3">
                  <div className="text-[11px] text-slate-500">Route Distance</div>
                  <div className="font-bold text-slate-900">{plan.totalDistanceKm} km</div>
                </div>
                <div className="rounded-xl bg-slate-100 p-3">
                  <div className="text-[11px] text-slate-500">Est. Drive</div>
                  <div className="font-bold text-slate-900">{plan.estimatedDriveMinutes} min</div>
                </div>
                <div className="rounded-xl bg-slate-100 p-3">
                  <div className="text-[11px] text-slate-500">Usable Range</div>
                  <div className="font-bold text-emerald-700">{plan.effectiveRangeKm} km</div>
                </div>
              </div>

              <div className="rounded-lg bg-slate-900 p-3 text-xs text-white flex flex-wrap items-center justify-between gap-2">
                <span>
                  {plan.needsChargingStop
                    ? "Charging stop recommended before reaching destination"
                    : "Sufficient range — reserve a corridor or destination charger if needed"}
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="neutral">
                    {plan.routeSource === "OSRM" ? "OSRM Road Route" : "Direct Corridor"}
                  </Badge>
                  <Badge variant={plan.needsChargingStop ? "warning" : "success"}>
                    {plan.needsChargingStop ? "Stop Needed" : "Direct"}
                  </Badge>
                </div>
              </div>

              {/* Interactive Corridor Map */}
              <TripCorridorMap
                origin={plan.origin}
                destination={plan.destination}
                routePolyline={plan.routePolyline}
                bookableStops={plan.recommendedStops}
                publicStops={plan.corridorPublicStops}
              />

              {/* Bookable ParkSmart Corridor Stops */}
              {plan.recommendedStops.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-800">
                    Bookable ParkSmart Hubs Near Route ({plan.recommendedStops.length})
                  </div>
                  {plan.recommendedStops.map((stop) => (
                    <div
                      key={stop.facilityId}
                      className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm text-slate-900">{stop.name}</span>
                          {stop.dataSourceType === "SIMULATED" && (
                            <Badge variant="warning">Demo Hub</Badge>
                          )}
                        </div>
                        <div className="text-xs text-slate-600">
                          {stop.address} · {stop.maxChargerKw} kW ({stop.connectorStandards.join(", ")})
                        </div>
                        <div className="text-xs text-emerald-700 font-semibold flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5" />~{stop.estimatedChargeMinutes} min stop ·{" "}
                          {stop.availableConnectors} connectors free
                        </div>
                      </div>
                      <Link href={`/facilities/${stop.slug}`}>
                        <Button size="sm" variant="emerald">
                          Reserve
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}

              {/* Public EV Directory Corridor Stops */}
              <div className="space-y-2.5">
                <div className="text-xs font-bold text-slate-800">
                  Public EV Charging Stops Along Corridor ({plan.corridorPublicStops.length})
                </div>
                {plan.corridorPublicStops.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No public directory chargers matched your connector filter within 15 km of this
                    corridor. Try selecting &quot;All Connectors&quot; or check the Live Map.
                  </p>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {plan.corridorPublicStops.map((stop) => (
                      <div
                        key={stop.id}
                        className="rounded-xl border border-slate-200 p-3.5 space-y-1.5 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-bold text-slate-900">{stop.name}</span>
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                            Directory
                          </span>
                        </div>
                        <div className="text-slate-600">
                          {stop.distanceFromOriginKm} km from start ({stop.distanceFromCorridorKm} km
                          off route)
                          {stop.operator ? ` · ${stop.operator}` : ""}
                        </div>
                        <div className="text-slate-700 font-medium">
                          {stop.maxPowerKw ? `${stop.maxPowerKw} kW` : "Power unknown"}
                          {stop.sockets ? ` · ${stop.sockets}` : ""}
                          {stop.pricing ? ` · ${stop.pricing}` : ""}
                        </div>
                        {stop.address && (
                          <div className="text-[11px] text-slate-500 line-clamp-1">
                            {stop.address}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
                          <span className="text-[10px] font-semibold text-slate-500">
                            Live availability not connected
                          </span>
                          <Link
                            href={`/explore?lat=${stop.latitude}&lng=${stop.longitude}&stationId=${encodeURIComponent(stop.id)}`}
                            className="inline-flex items-center gap-1 font-bold text-blue-700 hover:underline"
                          >
                            <Navigation className="h-3 w-3" />
                            Navigate on Map →
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-[11px] text-slate-500">{plan.dataDisclosure}</p>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-5 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <Flame className="h-5 w-5 text-red-500" />
              Hub Occupancy Heatmap
            </h2>
            <Link href="/explore" className="text-xs font-semibold text-emerald-700 hover:underline">
              Open Live GPS Map →
            </Link>
          </div>

          {zones.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
              No EV/parking hubs registered in the database yet.
            </div>
          ) : (
            <div className="space-y-3">
              {zones.map((z) => (
                <div key={z.facilityId} className="rounded-xl border border-slate-200 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-slate-400" />
                      <span className="font-bold text-sm text-slate-900">{z.name}</span>
                      {z.dataSourceType === "SIMULATED" && (
                        <Badge variant="warning">Demo</Badge>
                      )}
                    </div>
                    <StatusPill
                      status={
                        z.demandLevel === "HIGH"
                          ? "FAULTED"
                          : z.demandLevel === "MODERATE"
                            ? "HELD"
                            : "AVAILABLE"
                      }
                    />
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        z.occupancyPct >= 75
                          ? "bg-red-500"
                          : z.occupancyPct >= 40
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.max(6, z.occupancyPct)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>
                      Occupancy: <strong>{z.occupancyPct}%</strong> ({z.demandLevel} demand)
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span>{z.availableSpaces} bays free</span>
                      <span className="text-amber-700 font-semibold flex items-center gap-0.5">
                        <Zap className="h-3.5 w-3.5" />
                        {z.availableConnectors} EV
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {heatmapDisclaimer && (
            <p className="text-[11px] text-slate-500">{heatmapDisclaimer}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
