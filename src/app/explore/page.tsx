"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  MapPin,
  Zap,
  Radio,
  AlertCircle,
  Scale,
  X,
  LocateFixed,
  ExternalLink,
} from "lucide-react";
import type { FacilitySearchResultItem } from "@/features/search/search.service";
import {
  InteractiveCityMap,
  type NearbyOsmStation,
} from "@/components/map/interactive-city-map";
import { Badge, Button, Card, Select, Skeleton } from "@/components/ui/primitives";
import { formatPaise, getFacilityPhoto, haversineKm } from "@/lib/utils";

function ExploreContent() {
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [hasEvCharging, setHasEvCharging] = useState(searchParams.get("hasEvCharging") ?? "");
  const [connectorStandard, setConnectorStandard] = useState("");
  const [minPowerKw, setMinPowerKw] = useState(searchParams.get("minPowerKw") ?? "");
  const [maxPriceInr, setMaxPriceInr] = useState("200");
  const [radiusKm, setRadiusKm] = useState("25");
  const [isCovered, setIsCovered] = useState(searchParams.get("isCovered") ?? "");
  const [hasAccessibility, setHasAccessibility] = useState(
    searchParams.get("hasAccessibility") ?? ""
  );
  const [bounds, setBounds] = useState<{
    north: number;
    south: number;
    east: number;
    west: number;
  } | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "prompting" | "granted" | "denied"
  >("idle");
  const [locationError, setLocationError] = useState<string | null>(null);

  const [facilities, setFacilities] = useState<FacilitySearchResultItem[]>([]);
  const [osmStations, setOsmStations] = useState<NearbyOsmStation[]>([]);
  const [loadingOsm, setLoadingOsm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  const fetchNearbyOsmChargers = useCallback(
    async (lat: number, lng: number, km: number) => {
      setLoadingOsm(true);
      try {
        const radiusMeters = Math.min(25000, Math.max(3000, Math.round(km * 1000)));
        const overpassQuery = `[out:json][timeout:10];(node["amenity"="charging_station"](around:${radiusMeters},${lat},${lng});way["amenity"="charging_station"](around:${radiusMeters},${lat},${lng}););out center 25;`;
        const endpoints = [
          "https://overpass-api.de/api/interpreter",
          "https://overpass.kumi.systems/api/interpreter",
        ];

        let json: {
          elements?: Array<{
            id: number;
            lat?: number;
            lon?: number;
            center?: { lat: number; lon: number };
            tags?: Record<string, string>;
          }>;
        } | null = null;

        for (const endpoint of endpoints) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(endpoint, {
              method: "POST",
              body: overpassQuery,
              signal: controller.signal,
            });
            clearTimeout(timer);
            if (res.ok) {
              json = await res.json();
              break;
            }
          } catch {
            // Try next mirror
          }
        }

        if (!json) return;

        const items: NearbyOsmStation[] = (json.elements ?? [])
          .map((el) => {
            const pLat = el.lat ?? el.center?.lat;
            const pLng = el.lon ?? el.center?.lon;
            if (pLat === undefined || pLng === undefined) return null;
            const tags = el.tags ?? {};
            const socketList = Object.entries(tags)
              .filter(([k]) => k.startsWith("socket:"))
              .map(([k, v]) => `${k.replace("socket:", "").toUpperCase()} (${v})`)
              .join(", ");
            return {
              id: `osm-${el.id}`,
              name: tags.name || tags.operator || "Public EV Charging Station",
              operator: tags.operator,
              latitude: pLat,
              longitude: pLng,
              distanceKm: haversineKm(lat, lng, pLat, pLng),
              sockets:
                socketList || tags.capacity
                  ? `Sockets: ${socketList || tags.capacity}`
                  : undefined,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .sort((a, b) => a.distanceKm - b.distanceKm)
          .slice(0, 15);
        setOsmStations(items);
      } catch {
        // Gracefully ignore Overpass offline/timeout in restricted networks
      } finally {
        setLoadingOsm(false);
      }
    },
    []
  );

  const resolveCityQuery = useCallback(
    async (query: string) => {
      setLocationError(null);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
            query
          )}`
        );
        const rows = (await res.json()) as Array<{
          lat: string;
          lon: string;
          display_name: string;
        }>;
        if (!rows.length) {
          setLocationError(`Could not find "${query}". Try a city or landmark name.`);
          return;
        }
        const coords = { lat: Number(rows[0]!.lat), lng: Number(rows[0]!.lon) };
        setUserLocation(coords);
        setLocationLabel(rows[0]!.display_name.split(",").slice(0, 2).join(", "));
        setLocationStatus("granted");
        setBounds(null);
        await fetchNearbyOsmChargers(coords.lat, coords.lng, Number(radiusKm) || 15);
      } catch {
        setLocationError("Could not look up that location right now.");
      }
    },
    [fetchNearbyOsmChargers, radiusKm]
  );

  const requestUserLocation = useCallback(() => {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setLocationStatus("denied");
      setLocationError(
        "Browser GPS requires https:// or http://localhost. Enter your city/area below to find nearby EV chargers."
      );
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationStatus("denied");
      setLocationError("Geolocation is not supported in this browser. Enter your city below.");
      return;
    }
    setLocationStatus("prompting");
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setUserLocation(coords);
        setLocationLabel(null);
        setLocationStatus("granted");
        setLocationError(null);
        setError(null);
        setBounds(null);
        void fetchNearbyOsmChargers(coords.lat, coords.lng, Number(radiusKm) || 15);
      },
      (geoErr) => {
        setLocationStatus("denied");
        if (geoErr.code === geoErr.PERMISSION_DENIED) {
          setLocationError(
            "Location permission was blocked or declined. Allow location in browser site settings, or enter your city below."
          );
        } else {
          setLocationError(
            "Could not detect GPS coordinates. Try again or enter your city/area below."
          );
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, [fetchNearbyOsmChargers, radiusKm]);

  // Prompt browser geolocation automatically when Explore opens (if browser permission allows)
  useEffect(() => {
    if (typeof window === "undefined" || navigator.userAgent.includes("jsdom")) return;
    const timer = setTimeout(() => {
      if (q.trim()) {
        void resolveCityQuery(q.trim());
      } else {
        requestUserLocation();
      }
    }, 150);
    return () => clearTimeout(timer);
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchFacilities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (hasEvCharging) params.set("hasEvCharging", hasEvCharging);
      if (connectorStandard) params.set("connectorStandard", connectorStandard);
      if (minPowerKw) params.set("minPowerKw", minPowerKw);
      if (maxPriceInr && Number(maxPriceInr) < 200) {
        params.set("maxPricePaise", String(Number(maxPriceInr) * 100));
      }
      if (isCovered) params.set("isCovered", isCovered);
      if (hasAccessibility) params.set("hasAccessibility", hasAccessibility);
      params.set("sortBy", userLocation ? "distance" : "suitability");
      // When user shares real location far from seeded hubs, expand radius so they also see closest bookable hubs
      params.set("radiusKm", userLocation ? "500" : radiusKm);

      if (userLocation) {
        params.set("lat", String(userLocation.lat));
        params.set("lng", String(userLocation.lng));
      }
      if (bounds) {
        params.set("north", String(bounds.north));
        params.set("south", String(bounds.south));
        params.set("east", String(bounds.east));
        params.set("west", String(bounds.west));
      }

      const res = await fetch(`/api/v1/facilities?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error?.message || "Failed to load facilities");
        return;
      }
      setFacilities(json.data.items);
      if (json.data.items.length > 0 && !selectedId) {
        setSelectedId(json.data.items[0].id);
      }
    } catch {
      setError("Network error while loading facilities");
    } finally {
      setLoading(false);
    }
  }, [
    q,
    hasEvCharging,
    connectorStandard,
    minPowerKw,
    maxPriceInr,
    isCovered,
    hasAccessibility,
    radiusKm,
    userLocation,
    bounds,
    selectedId,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchFacilities();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchFacilities]);

  useEffect(() => {
    const es = new EventSource("/api/v1/events/stream");
    es.addEventListener("connected", () => setSseConnected(true));
    es.addEventListener("platform_event", (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data);
        if (
          parsed.type === "AVAILABILITY_CHANGED" ||
          parsed.type === "FACILITY_STATUS_CHANGED"
        ) {
          void fetchFacilities();
        }
      } catch {
        // ignore
      }
    });
    es.onerror = () => setSseConnected(false);
    return () => es.close();
  }, [fetchFacilities]);

  function clearAllFilters() {
    setQ("");
    setHasEvCharging("");
    setConnectorStandard("");
    setMinPowerKw("");
    setMaxPriceInr("200");
    setRadiusKm("25");
    setIsCovered("");
    setHasAccessibility("");
    setBounds(null);
  }

  function toggleCompare(id: string) {
    setCompareIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 3
          ? [...prev, id]
          : prev
    );
  }

  const comparedFacilities = facilities.filter((f) => compareIds.includes(f.id));

  return (
    <div className="bg-[#F4F7FB] min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-4">
        {/* Location Permission Banner */}
        <Card className="p-3.5 bg-white border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-slate-700">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600 shrink-0">
              <LocateFixed className="h-4 w-4" />
            </span>
            <div>
              {locationStatus === "granted" && userLocation ? (
                <span>
                  <strong className="text-slate-900">
                    {locationLabel ? `Location: ${locationLabel}` : "Live GPS Active"}:
                  </strong>{" "}
                  Showing EV charging points near{" "}
                  <span className="font-mono">
                    {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
                  </span>{" "}
                  ({osmStations.length} live OSM chargers + {facilities.length} ParkSmart hubs)
                </span>
              ) : locationStatus === "prompting" ? (
                <span>Requesting your GPS location to find nearby EV charging points...</span>
              ) : (
                <span>
                  <strong className="text-slate-900">Find Nearby EV Chargers:</strong> Share your current location to plot EV charging points around you on the live map.
                </span>
              )}
            </div>
          </div>

          <Button size="sm" variant="primary" onClick={requestUserLocation}>
            <LocateFixed className="h-3.5 w-3.5" />
            {locationStatus === "granted" ? "Refresh My Location" : "Allow Location & Find Chargers"}
          </Button>
        </Card>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* Left Filter Sidebar */}
          <Card className="lg:col-span-3 p-5 space-y-5 bg-white border-slate-200/80 shadow-sm">
            <div className="flex items-center justify-between">
              <h1 className="text-base font-extrabold text-slate-900">Filters</h1>
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
              >
                Clear All
              </button>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="text-xs font-bold text-slate-800">Price Range</div>
              <div className="text-xs font-semibold text-slate-600">
                ₹0 – {Number(maxPriceInr) >= 200 ? "₹500" : `₹${maxPriceInr}/hr`}
              </div>
              <input
                type="range"
                min={20}
                max={200}
                step={10}
                value={maxPriceInr}
                onChange={(e) => setMaxPriceInr(e.target.value)}
                className="w-full accent-emerald-500 cursor-pointer"
                aria-label="Maximum hourly price"
              />
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="text-xs font-bold text-slate-800">Distance</div>
              <div className="text-xs font-semibold text-slate-600">Within {radiusKm} km</div>
              <input
                type="range"
                min={2}
                max={50}
                step={1}
                value={radiusKm}
                onChange={(e) => setRadiusKm(e.target.value)}
                className="w-full accent-blue-600 cursor-pointer"
                aria-label="Search radius"
              />
            </div>

            <div className="space-y-2.5 border-t border-slate-100 pt-4">
              <div className="text-xs font-bold text-slate-800">Availability</div>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasEvCharging === ""}
                  onChange={() => setHasEvCharging("")}
                  className="rounded border-slate-300"
                />
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-emerald-600 text-[10px] font-bold text-white">
                  P
                </span>
                Parking Available
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasEvCharging === "true"}
                  onChange={(e) => setHasEvCharging(e.target.checked ? "true" : "")}
                  className="rounded border-slate-300"
                />
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-blue-600 text-white">
                  <Zap className="h-3 w-3" />
                </span>
                EV Charging Available
              </label>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="text-xs font-bold text-slate-800">Connector Type</div>
              {[
                { label: "Type 2", val: "TYPE2_AC" },
                { label: "CCS2", val: "CCS2" },
                { label: "CHAdeMO", val: "CHADEMO" },
              ].map((c) => (
                <label
                  key={c.val}
                  className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={connectorStandard === c.val}
                    onChange={(e) => setConnectorStandard(e.target.checked ? c.val : "")}
                    className="rounded border-slate-300"
                  />
                  {c.label}
                </label>
              ))}
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="text-xs font-bold text-slate-800">Charging Power</div>
              <Select
                value={minPowerKw}
                onChange={(e) => setMinPowerKw(e.target.value)}
                aria-label="Minimum EV power"
              >
                <option value="">Any</option>
                <option value="22">22 kW+</option>
                <option value="50">50 kW+ Fast</option>
                <option value="100">100 kW+ Ultra</option>
              </Select>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="text-xs font-bold text-slate-800">Facilities</div>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isCovered === "true"}
                  onChange={(e) => setIsCovered(e.target.checked ? "true" : "")}
                  className="rounded border-slate-300"
                />
                Covered Parking
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasAccessibility === "true"}
                  onChange={(e) => setHasAccessibility(e.target.checked ? "true" : "")}
                  className="rounded border-slate-300"
                />
                Wheelchair Access
              </label>
            </div>

            <div className="pt-1 flex items-center gap-2 text-[11px] text-slate-500">
              <Radio
                className={`h-3.5 w-3.5 ${sseConnected ? "text-emerald-600" : "text-amber-500"}`}
              />
              {sseConnected ? "Real-time SSE Active" : "Connecting live stream..."}
            </div>
          </Card>

          {/* Right Main Area */}
          <div className="lg:col-span-9 space-y-6">
            <InteractiveCityMap
              facilities={facilities}
              osmStations={osmStations}
              selectedId={selectedId}
              onSelectFacility={setSelectedId}
              userLocation={userLocation}
              locationStatus={locationStatus}
              locationError={locationError}
              onSearchBounds={(b) => setBounds(b)}
              onLocateUser={requestUserLocation}
              onResolveCityQuery={resolveCityQuery}
            />

            {/* Nearby Live OpenStreetMap EV Charging Points (when user location is shared) */}
            {(osmStations.length > 0 || loadingOsm) && (
              <Card className="p-4 bg-white border-slate-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-teal-600" />
                    EV Charging Points Near Your Location ({osmStations.length})
                  </h2>
                  {loadingOsm && <span className="text-xs text-slate-500">Scanning area...</span>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {osmStations.slice(0, 6).map((s) => (
                    <div
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={`rounded-xl border p-3 text-xs space-y-1 cursor-pointer transition ${
                        selectedId === s.id
                          ? "border-teal-600 bg-teal-50/50"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="font-bold text-slate-900 truncate">{s.name}</div>
                      <div className="text-slate-600">
                        {s.distanceKm} km away {s.operator ? `· ${s.operator}` : ""}
                      </div>
                      {s.sockets && <div className="text-[11px] text-slate-500">{s.sockets}</div>}
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${s.latitude},${s.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
                      >
                        Directions <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* ParkSmart Verified Bookable Facilities */}
            {loading ? (
              <div className="grid gap-4 md:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-64 w-full" />
                ))}
              </div>
            ) : facilities.length === 0 ? (
              <Card className="p-8 text-center space-y-3">
                <MapPin className="h-8 w-8 text-slate-400 mx-auto" />
                <h3 className="font-bold text-slate-900">No matching hubs found</h3>
                <p className="text-xs text-slate-600">
                  Clear your filters or search area bounds to view all facilities.
                </p>
                <Button size="sm" variant="outline" onClick={clearAllFilters}>
                  Reset Filters
                </Button>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {facilities.map((fac) => {
                  const isSelected = fac.id === selectedId;
                  const isCompared = compareIds.includes(fac.id);
                  return (
                    <Card
                      key={fac.id}
                      onClick={() => setSelectedId(fac.id)}
                      className={`overflow-hidden flex flex-col bg-white transition cursor-pointer ${
                        isSelected
                          ? "border-blue-600 ring-2 ring-blue-500/20"
                          : "border-slate-200/80 hover:border-slate-300"
                      }`}
                    >
                      <img
                        src={getFacilityPhoto(fac.slug, fac.photos)}
                        alt={fac.name}
                        className="h-36 w-full object-cover"
                      />
                      <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                        <div className="space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-bold text-sm text-slate-900 line-clamp-1">
                              {fac.name}
                            </h3>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCompare(fac.id);
                              }}
                              className={`rounded p-1 text-slate-400 hover:bg-slate-100 cursor-pointer ${
                                isCompared ? "text-emerald-600" : ""
                              }`}
                              title="Compare facility"
                            >
                              <Scale className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="text-xs text-slate-600">
                            <strong className="text-slate-900">
                              {formatPaise(fac.hourlyRatePaise)}
                            </strong>
                            /hr · {userLocation ? `${fac.distanceKm} km` : fac.city}
                          </div>
                          <div className="text-xs font-semibold text-emerald-700">
                            {fac.availableSpaces}/{fac.totalCapacity} Available
                            {fac.hasEvCharging && (
                              <span className="ml-2 text-blue-700">
                                · {fac.availableConnectors} EV
                              </span>
                            )}
                          </div>
                        </div>

                        <Link
                          href={`/facilities/${fac.slug}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="w-full rounded-xl bg-[#0F2942] py-2 text-xs font-bold text-white hover:bg-[#173A5E] transition cursor-pointer"
                          >
                            Book Now
                          </button>
                        </Link>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            {comparedFacilities.length > 0 && (
              <Card className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <Scale className="h-4 w-4 text-emerald-600" />
                    Facility Comparison ({comparedFacilities.length}/3)
                  </h2>
                  <Button size="sm" variant="ghost" onClick={() => setCompareIds([])}>
                    <X className="h-4 w-4" /> Clear
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3 text-xs">
                  {comparedFacilities.map((f) => (
                    <div key={f.id} className="rounded-xl border border-slate-200 p-3 space-y-1">
                      <div className="font-bold text-slate-900">{f.name}</div>
                      <div>{formatPaise(f.hourlyRatePaise)}/hr</div>
                      <div className="text-emerald-700 font-semibold">
                        {f.availableSpaces}/{f.totalCapacity} Bays Free
                      </div>
                      <Badge variant={f.hasEvCharging ? "info" : "neutral"}>
                        {f.hasEvCharging ? `${f.maxChargerKw}kW EV` : "Parking Only"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-8">
          <Skeleton className="h-[500px] w-full" />
        </div>
      }
    >
      <ExploreContent />
    </Suspense>
  );
}
