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
} from "lucide-react";
import type { FacilitySearchResultItem } from "@/features/search/search.service";
import { InteractiveCityMap } from "@/components/map/interactive-city-map";
import { Badge, Button, Card, Select, Skeleton } from "@/components/ui/primitives";
import { formatPaise, getFacilityPhoto } from "@/lib/utils";

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

  const [facilities, setFacilities] = useState<FacilitySearchResultItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

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
      params.set("sortBy", "suitability");
      params.set("radiusKm", radiusKm);

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

  function handleLocateUser() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {
        setError("Location permission declined — showing city center.");
      }
    );
  }

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
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Screen 2 Layout: Left Filter Sidebar + Right Map & 3-Column Facility Cards */}
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

            {/* Price Range Slider */}
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

            {/* Distance Slider */}
            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="text-xs font-bold text-slate-800">Distance</div>
              <div className="text-xs font-semibold text-slate-600">
                Within {radiusKm} km
              </div>
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

            {/* Availability Checkboxes */}
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

            {/* Connector Type */}
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
                    onChange={(e) =>
                      setConnectorStandard(e.target.checked ? c.val : "")
                    }
                    className="rounded border-slate-300"
                  />
                  {c.label}
                </label>
              ))}
            </div>

            {/* Charging Power */}
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

            {/* Facilities */}
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

          {/* Right Main Area: Map on top + 3-Card Facility Grid Below */}
          <div className="lg:col-span-9 space-y-6">
            <InteractiveCityMap
              facilities={facilities}
              selectedId={selectedId}
              onSelectFacility={setSelectedId}
              userLocation={userLocation}
              onSearchBounds={(b) => setBounds(b)}
              onLocateUser={handleLocateUser}
            />

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
                            /hr · {fac.distanceKm} km
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

            {/* Optional Side-by-Side Comparison Matrix */}
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
