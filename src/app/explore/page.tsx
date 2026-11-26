"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
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
  Navigation,
  ShieldCheck,
  Clock,
} from "lucide-react";
import type { FacilitySearchResultItem } from "@/features/search/search.service";
import {
  buildOverpassBboxQuery,
  parseOverpassElementsToStations,
  type ExternalEvChargerStation,
  type NearbyChargersResult,
  type OverpassElement,
} from "@/features/search/nearby-chargers.shared";
import {
  computeInAppRoute,
  getNavigationProgress,
  type InAppRoute,
  type LiveGpsSample,
} from "@/lib/in-app-navigation";
import { InteractiveCityMap } from "@/components/map/interactive-city-map";
import { Badge, Button, Card, Select, Skeleton } from "@/components/ui/primitives";
import { formatPaise, getFacilityPhoto } from "@/lib/utils";

const DEFAULT_FALLBACK_LOCATION = {
  lat: 28.6139,
  lng: 77.209,
  label: "Default Center: New Delhi (not your GPS)",
};

function ExploreContent() {
  const searchParams = useSearchParams();
  const initialEvParam = searchParams.get("hasEvCharging");

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [wantParking, setWantParking] = useState(initialEvParam !== "true");
  const [wantEv, setWantEv] = useState(
    initialEvParam === "true" || initialEvParam === null || initialEvParam === ""
  );
  const [connectorStandard, setConnectorStandard] = useState("");
  const [minPowerKw, setMinPowerKw] = useState(searchParams.get("minPowerKw") ?? "");
  const [maxPriceInr, setMaxPriceInr] = useState("500");
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
  const [isDefaultLocation, setIsDefaultLocation] = useState(false);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "prompting" | "granted" | "denied"
  >("idle");
  const [locationError, setLocationError] = useState<string | null>(null);

  const [facilities, setFacilities] = useState<FacilitySearchResultItem[]>([]);
  const [osmStations, setOsmStations] = useState<ExternalEvChargerStation[]>([]);
  const [externalAttributions, setExternalAttributions] = useState<string[]>([]);
  const [externalNotice, setExternalNotice] = useState<string | null>(null);
  const [loadingOsm, setLoadingOsm] = useState(false);
  const [showAllStations, setShowAllStations] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [activeRoute, setActiveRoute] = useState<InAppRoute | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [livePosition, setLivePosition] = useState<LiveGpsSample | null>(null);
  const [watchFailed, setWatchFailed] = useState(false);
  const [followUser, setFollowUser] = useState(true);
  const [isRerouting, setIsRerouting] = useState(false);
  const lastRerouteAtRef = useRef<number>(0);
  const nearbyAbortRef = useRef<AbortController | null>(null);

  const activeRouteDestId = activeRoute?.destinationId ?? null;
  const navigationTracking = Boolean(
    activeRouteDestId &&
      !isDefaultLocation &&
      !watchFailed &&
      typeof window !== "undefined" &&
      window.isSecureContext &&
      typeof navigator !== "undefined" &&
      navigator.geolocation?.watchPosition
  );

  const fetchNearbyExternalChargers = useCallback(
    async (lat: number, lng: number, km: number) => {
      nearbyAbortRef.current?.abort();
      const abortCtrl = new AbortController();
      nearbyAbortRef.current = abortCtrl;

      setLoadingOsm(true);
      setExternalNotice(null);
      try {
        const params = new URLSearchParams({
          lat: String(lat),
          lng: String(lng),
          radiusKm: String(Math.min(100, Math.max(0.5, km))),
        });
        if (connectorStandard) params.set("connectorStandard", connectorStandard);
        if (minPowerKw) params.set("minPowerKw", minPowerKw);

        const res = await fetch(`/api/v1/ev-chargers/nearby?${params.toString()}`, {
          signal: abortCtrl.signal,
        });
        const json = (await res.json()) as {
          ok: boolean;
          data?: NearbyChargersResult;
          error?: { message?: string };
        };
        if (!res.ok || !json.ok || !json.data) {
          setOsmStations([]);
          setExternalAttributions([]);
          setExternalNotice(
            json.error?.message || "Could not load external nearby EV charging stations."
          );
          return;
        }
        setOsmStations(json.data.stations);
        setExternalAttributions(json.data.attributions ?? []);
        const indiaDatasetSource = json.data.sources.indiaOpenDataset;
        const beeSource = json.data.sources.beeIndiaApi;
        const osmSource = json.data.sources.openStreetMapOverpass;
        const freeIndiaOk =
          indiaDatasetSource?.status === "OK" || beeSource?.status === "OK";

        if (
          osmSource.status === "UNAVAILABLE" &&
          !freeIndiaOk &&
          json.data.stations.length === 0
        ) {
          // Fallback: try direct browser Overpass GET when Node.js server network/IPv6 cannot reach Overpass
          let browserResolved = false;
          const overpassQuery = buildOverpassBboxQuery(lat, lng, km);
          for (const endpoint of [
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
          ]) {
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 8000);
              const browserRes = await fetch(
                `${endpoint}?data=${encodeURIComponent(overpassQuery)}`,
                { method: "GET", signal: controller.signal }
              );
              clearTimeout(timer);
              if (browserRes.ok) {
                const browserJson = (await browserRes.json()) as {
                  elements?: OverpassElement[];
                  remark?: string;
                };
                if (browserJson.remark) continue;
                const parsed = parseOverpassElementsToStations({
                  elements: browserJson.elements ?? [],
                  lat,
                  lng,
                  radiusKm: Math.min(100, Math.max(0.5, km)),
                  connectorStandard: connectorStandard || undefined,
                  minPowerKw: minPowerKw ? Number(minPowerKw) : undefined,
                });
                setOsmStations(parsed);
                browserResolved = true;
                break;
              }
            } catch {
              // Try next mirror
            }
          }

          if (!browserResolved) {
            setExternalNotice(
              osmSource.message ||
                "External OpenStreetMap Overpass station feed is temporarily unavailable."
            );
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setOsmStations([]);
        setExternalNotice("Network error while fetching nearby EV charging stations.");
      } finally {
        if (!abortCtrl.signal.aborted) {
          setLoadingOsm(false);
        }
      }
    },
    [connectorStandard, minPowerKw]
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
        setIsDefaultLocation(false);
        setLocationLabel(rows[0]!.display_name.split(",").slice(0, 2).join(", "));
        setLocationStatus("granted");
        setBounds(null);
        await fetchNearbyExternalChargers(coords.lat, coords.lng, Number(radiusKm) || 25);
      } catch {
        setLocationError("Could not look up that location right now.");
      }
    },
    [fetchNearbyExternalChargers, radiusKm]
  );

  const requestUserLocation = useCallback(() => {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setLocationStatus("denied");
      setLocationError(
        "Browser GPS requires https:// or http://localhost. Enter your city/area or select the default center."
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
        setIsDefaultLocation(false);
        setLocationLabel(null);
        setLocationStatus("granted");
        setLocationError(null);
        setBounds(null);
        void fetchNearbyExternalChargers(coords.lat, coords.lng, Number(radiusKm) || 25);
      },
      (geoErr) => {
        setLocationStatus("denied");
        if (geoErr.code === geoErr.PERMISSION_DENIED) {
          setLocationError(
            "Location permission was declined. Enter your city below or use the default location."
          );
        } else {
          setLocationError(
            "Could not detect GPS coordinates. Try again or enter your city below."
          );
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, [fetchNearbyExternalChargers, radiusKm]);

  const useDefaultLocation = useCallback(() => {
    const coords = {
      lat: DEFAULT_FALLBACK_LOCATION.lat,
      lng: DEFAULT_FALLBACK_LOCATION.lng,
    };
    setUserLocation(coords);
    setIsDefaultLocation(true);
    setLocationLabel(DEFAULT_FALLBACK_LOCATION.label);
    setLocationStatus("granted");
    setLocationError(null);
    setBounds(null);
    void fetchNearbyExternalChargers(coords.lat, coords.lng, Number(radiusKm) || 25);
  }, [fetchNearbyExternalChargers, radiusKm]);

  // Only auto-fetch browser GPS on mount when permission is ALREADY granted (never silently probe otherwise)
  useEffect(() => {
    if (typeof window === "undefined" || navigator.userAgent.includes("jsdom")) return;
    if (q.trim()) {
      const timer = setTimeout(() => {
        void resolveCityQuery(q.trim());
      }, 150);
      return () => clearTimeout(timer);
    }

    let cancelled = false;
    if (navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: "geolocation" })
        .then((perm) => {
          if (!cancelled && perm.state === "granted") {
            requestUserLocation();
          }
        })
        .catch(() => {
          // Permissions API unavailable; wait for explicit user button click
        });
    }
    return () => {
      cancelled = true;
    };
    // Run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch external nearby chargers when radius, connector, or power filters change while location is set
  // Pause auto-refetch during active live GPS navigation so moving along a road does not spam nearby APIs
  useEffect(() => {
    if (!userLocation) return;
    if (activeRoute && navigationTracking) return;
    if (!wantEv && wantParking) return;
    const timer = setTimeout(() => {
      void fetchNearbyExternalChargers(
        userLocation.lat,
        userLocation.lng,
        Number(radiusKm) || 25
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [
    userLocation,
    radiusKm,
    wantEv,
    wantParking,
    activeRoute,
    navigationTracking,
    fetchNearbyExternalChargers,
  ]);

  const fetchFacilities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());

      // Independent Parking vs EV Charging filter flags
      if (wantEv && !wantParking) {
        params.set("hasEvCharging", "true");
      } else if (!wantEv && wantParking) {
        params.set("hasParking", "true");
      }

      if (connectorStandard) params.set("connectorStandard", connectorStandard);
      if (minPowerKw) params.set("minPowerKw", minPowerKw);
      if (maxPriceInr && Number(maxPriceInr) < 500) {
        params.set("maxPricePaise", String(Number(maxPriceInr) * 100));
      }
      if (isCovered) params.set("isCovered", isCovered);
      if (hasAccessibility) params.set("hasAccessibility", hasAccessibility);
      params.set("sortBy", userLocation ? "distance" : "suitability");
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
        setFacilities([]);
        setError(json.error?.message || "Failed to load facilities");
        return;
      }
      setFacilities(json.data.items);
      if (json.data.items.length > 0 && !selectedId) {
        setSelectedId(json.data.items[0].id);
      }
    } catch {
      setFacilities([]);
      setError("Network error while loading facilities");
    } finally {
      setLoading(false);
    }
  }, [
    q,
    wantParking,
    wantEv,
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
    setWantParking(true);
    setWantEv(true);
    setConnectorStandard("");
    setMinPowerKw("");
    setMaxPriceInr("500");
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

  const activeRouteRef = useRef<InAppRoute | null>(null);
  useEffect(() => {
    activeRouteRef.current = activeRoute;
  }, [activeRoute]);

  // Continuous live GPS tracking (watchPosition) while in-app navigation is active
  useEffect(() => {
    if (
      !activeRouteDestId ||
      isDefaultLocation ||
      typeof window === "undefined" ||
      !window.isSecureContext ||
      typeof navigator === "undefined" ||
      !navigator.geolocation?.watchPosition
    ) {
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setWatchFailed(false);
        const sample: LiveGpsSample = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading ?? null,
          speedMps: pos.coords.speed ?? null,
          accuracyMeters: pos.coords.accuracy ?? null,
          timestamp: pos.timestamp,
        };
        setLivePosition(sample);
        setUserLocation({ lat: sample.lat, lng: sample.lng });

        const currentRoute = activeRouteRef.current;
        if (!currentRoute) return;
        const progress = getNavigationProgress(currentRoute, sample);
        if (
          progress.offRoute &&
          !progress.arrived &&
          Date.now() - lastRerouteAtRef.current > 15_000
        ) {
          lastRerouteAtRef.current = Date.now();
          setIsRerouting(true);
          void computeInAppRoute({
            destinationId: currentRoute.destinationId,
            destinationName: currentRoute.destinationName,
            originLat: sample.lat,
            originLng: sample.lng,
            destLat: currentRoute.destination.lat,
            destLng: currentRoute.destination.lng,
          })
            .then((updated) => {
              if (activeRouteRef.current?.destinationId === currentRoute.destinationId) {
                setActiveRoute(updated);
              }
            })
            .finally(() => setIsRerouting(false));
        }
      },
      () => {
        setWatchFailed(true);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [activeRouteDestId, isDefaultLocation]);

  const handleClearRoute = useCallback(() => {
    setActiveRoute(null);
    setLivePosition(null);
    setWatchFailed(false);
    setIsRerouting(false);
  }, []);

  const handleNavigateToStation = useCallback(
    async (target: { id: string; name: string; latitude: number; longitude: number }) => {
      setSelectedId(target.id);
      if (!userLocation) {
        setLocationError(
          "Share your location (or enter your starting city on the map) to draw turn-by-turn route directions."
        );
        requestUserLocation();
        return;
      }
      setNavigating(true);
      try {
        const origin = livePosition ?? userLocation;
        const route = await computeInAppRoute({
          destinationId: target.id,
          destinationName: target.name,
          originLat: origin.lat,
          originLng: origin.lng,
          destLat: target.latitude,
          destLng: target.longitude,
        });
        setFollowUser(true);
        setWatchFailed(false);
        lastRerouteAtRef.current = Date.now();
        setActiveRoute(route);
      } finally {
        setNavigating(false);
      }
    },
    [userLocation, livePosition, requestUserLocation]
  );

  const navigationProgress = activeRoute
    ? getNavigationProgress(
        activeRoute,
        livePosition ?? userLocation ?? activeRoute.origin
      )
    : null;

  const visibleOsmStations = !wantEv && wantParking ? [] : osmStations;
  const comparedFacilities = facilities.filter((f) => compareIds.includes(f.id));
  const showEmptyResults =
    !loading && !error && facilities.length === 0 && visibleOsmStations.length === 0;

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
                    {locationLabel ? locationLabel : "Live GPS Active"}:
                  </strong>{" "}
                  Searching within {radiusKm} km of{" "}
                  <span className="font-mono">
                    {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
                  </span>{" "}
                  ({visibleOsmStations.length} public EV chargers + {facilities.length} ParkSmart hubs)
                </span>
              ) : locationStatus === "prompting" ? (
                <span>Waiting for your browser location permission...</span>
              ) : (
                <span>
                  <strong className="text-slate-900">Find Nearby EV Chargers:</strong> Allow
                  location permission or enter a city on the map to search nearby stations.
                </span>
              )}
            </div>
          </div>

          <Button size="sm" variant="primary" onClick={requestUserLocation}>
            <LocateFixed className="h-3.5 w-3.5" />
            {locationStatus === "granted" && !isDefaultLocation
              ? "Refresh My Location"
              : "Allow Location & Find Chargers"}
          </Button>
        </Card>

        {locationError && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <LocateFixed className="h-4 w-4 shrink-0" />
            <span>{locationError}</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {externalNotice && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{externalNotice}</span>
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
                ₹0 – {Number(maxPriceInr) >= 500 ? "₹500+" : `₹${maxPriceInr}/hr`}
              </div>
              <input
                type="range"
                min={20}
                max={500}
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
                max={100}
                step={1}
                value={radiusKm}
                onChange={(e) => {
                  setRadiusKm(e.target.value);
                  setBounds(null);
                }}
                className="w-full accent-blue-600 cursor-pointer"
                aria-label="Search radius"
              />
            </div>

            <div className="space-y-2.5 border-t border-slate-100 pt-4">
              <div className="text-xs font-bold text-slate-800">Availability</div>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wantParking}
                  onChange={(e) => setWantParking(e.target.checked)}
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
                  checked={wantEv}
                  onChange={(e) => setWantEv(e.target.checked)}
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
              osmStations={visibleOsmStations}
              selectedId={selectedId}
              onSelectFacility={setSelectedId}
              userLocation={userLocation}
              livePosition={livePosition}
              navigationTracking={navigationTracking}
              followUser={followUser}
              onToggleFollowUser={setFollowUser}
              isDefaultLocation={isDefaultLocation}
              radiusKm={Number(radiusKm) || 25}
              locationStatus={locationStatus}
              locationError={locationError}
              onSearchBounds={(b) => setBounds(b)}
              onLocateUser={requestUserLocation}
              onResolveCityQuery={resolveCityQuery}
              onUseDefaultLocation={useDefaultLocation}
              activeRoute={activeRoute}
              navigating={navigating}
              onNavigateToStation={handleNavigateToStation}
              onClearRoute={handleClearRoute}
            />

            {/* In-App Turn-by-Turn Navigation Panel */}
            {activeRoute && navigationProgress && (
              <Card className="p-4 bg-white border-blue-200 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                      <Navigation className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-extrabold text-slate-900">
                          In-App Route to {activeRoute.destinationName}
                        </h2>
                        {navigationTracking && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Live GPS Tracking
                          </span>
                        )}
                        {isRerouting && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                            Recalculating route...
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600">
                        {navigationProgress.arrived ? (
                          <strong className="text-emerald-700">
                            Arrived within 50 m of {activeRoute.destinationName}
                          </strong>
                        ) : (
                          <>
                            <strong>{navigationProgress.remainingDistanceKm} km</strong> remaining ·
                            Est. <strong>{navigationProgress.remainingMinutes} min</strong>{" "}
                            {activeRoute.source === "DIRECT_FALLBACK"
                              ? "(direct corridor line — road router unavailable)"
                              : "(via live road routing)"}
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {navigationTracking && !followUser && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setFollowUser(true)}
                      >
                        <LocateFixed className="h-3.5 w-3.5 text-blue-600" />
                        Follow Me
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleClearRoute}
                    >
                      <X className="h-3.5 w-3.5" />
                      {navigationTracking ? "Stop Navigation" : "Clear Route"}
                    </Button>
                  </div>
                </div>
                {!navigationProgress.arrived &&
                  activeRoute.steps[navigationProgress.currentStepIndex] && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-blue-950 flex items-center justify-between gap-2">
                      <span>
                        <strong className="text-blue-700 mr-1.5">Next:</strong>
                        {activeRoute.steps[navigationProgress.currentStepIndex]!.instruction}
                      </span>
                      {activeRoute.steps[navigationProgress.currentStepIndex]!.distanceMeters >
                        0 && (
                        <span className="shrink-0 font-mono text-[11px] text-blue-800">
                          {activeRoute.steps[navigationProgress.currentStepIndex]!.distanceMeters >=
                          1000
                            ? `${(
                                activeRoute.steps[navigationProgress.currentStepIndex]!
                                  .distanceMeters / 1000
                              ).toFixed(1)} km`
                            : `${activeRoute.steps[navigationProgress.currentStepIndex]!.distanceMeters} m`}
                        </span>
                      )}
                    </div>
                  )}
                <ol className="max-h-44 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/70 text-xs">
                  {activeRoute.steps.map((step, idx) => {
                    const isCurrent =
                      !navigationProgress.arrived && idx === navigationProgress.currentStepIndex;
                    return (
                      <li
                        key={`${idx}-${step.instruction}`}
                        className={`flex items-center justify-between gap-3 px-3 py-2 ${
                          isCurrent
                            ? "bg-blue-50 text-blue-950 font-semibold"
                            : "text-slate-700"
                        }`}
                      >
                        <span>
                          <strong className="text-slate-900 mr-1.5">{idx + 1}.</strong>
                          {step.instruction}
                        </span>
                        {step.distanceMeters > 0 && (
                          <span className="shrink-0 font-mono text-[11px] text-slate-500">
                            {step.distanceMeters >= 1000
                              ? `${(step.distanceMeters / 1000).toFixed(1)} km`
                              : `${step.distanceMeters} m`}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </Card>
            )}

            {/* Nearby EV Charging Stations */}
            {(visibleOsmStations.length > 0 || loadingOsm) && (
              <Card className="p-4 bg-white border-slate-200/80 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-teal-600" />
                    EV Charging Stations Within {radiusKm} km ({visibleOsmStations.length})
                  </h2>
                  <div className="flex items-center gap-2">
                    {loadingOsm && <span className="text-xs text-slate-500">Scanning area...</span>}
                    {visibleOsmStations.length > 30 && (
                      <button
                        type="button"
                        onClick={() => setShowAllStations((v) => !v)}
                        className="text-xs font-bold text-blue-700 hover:underline cursor-pointer"
                      >
                        {showAllStations
                          ? "Show nearest 30"
                          : `Show more (${Math.min(visibleOsmStations.length, 180)} of ${visibleOsmStations.length})`}
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleOsmStations.slice(0, showAllStations ? 180 : 30).map((s) => (
                    <div
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={`rounded-xl border p-3 text-xs space-y-1.5 cursor-pointer transition ${
                        selectedId === s.id
                          ? "border-teal-600 bg-teal-50/50"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 truncate">{s.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                            Directory
                          </span>
                          <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-teal-800">
                            {s.source === "INDIA_OPEN_EV_DATA"
                              ? "India EV"
                              : s.source === "BEE_INDIA_API"
                                ? "BEE Snapshot"
                                : s.source === "OPEN_CHARGE_MAP"
                                  ? "OCM"
                                  : "OSM"}
                          </span>
                        </div>
                      </div>
                      <div className="text-slate-600">
                        {s.distanceKm} km away
                        {s.operator ? ` · ${s.operator}` : ""}
                        {s.pricing ? ` · ${s.pricing}` : ""}
                      </div>
                      {s.address && <div className="text-[11px] text-slate-500">{s.address}</div>}
                      {s.sockets && <div className="text-[11px] text-slate-500">{s.sockets}</div>}
                      {s.freshnessLabel && (
                        <div className="text-[10px] text-slate-400">{s.freshnessLabel}</div>
                      )}
                      <div className="flex items-center justify-between pt-1">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            s.availabilityStatus === "LIVE"
                              ? "bg-emerald-50 text-emerald-700"
                              : s.availabilityStatus === "STALE"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          <Clock className="h-2.5 w-2.5" />
                          {s.availabilityStatus === "LIVE" &&
                          s.availableConnectors !== null &&
                          s.availableConnectors !== undefined &&
                          s.totalConnectors !== null &&
                          s.totalConnectors !== undefined
                            ? `${s.availableConnectors}/${s.totalConnectors} available`
                            : s.availabilityStatus === "STALE"
                              ? "Stale availability"
                              : "Live availability not connected"}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleNavigateToStation({
                              id: s.id,
                              name: s.name,
                              latitude: s.latitude,
                              longitude: s.longitude,
                            });
                          }}
                          className="inline-flex items-center gap-1 font-bold text-blue-700 hover:underline cursor-pointer"
                        >
                          <Navigation className="h-3 w-3" />
                          Navigate
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                  Directory listings are sourced from external datasets and are not verified by
                  ParkSmart or connected to live bay telemetry unless marked{" "}
                  <strong className="text-slate-700">Owner Verified</strong> /{" "}
                  <strong className="text-slate-700">LIVE</strong>.{" "}
                  {externalAttributions.length > 0
                    ? `Sources: ${externalAttributions.join(" · ")}.`
                    : "Sources: India EV Charging Dataset (ODbL v1.0) · OpenStreetMap contributors."}
                </p>
              </Card>
            )}

            {/* ParkSmart Verified Bookable Facilities */}
            {loading ? (
              <div className="grid gap-4 md:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-64 w-full" />
                ))}
              </div>
            ) : showEmptyResults ? (
              <Card className="p-8 text-center space-y-3">
                <MapPin className="h-8 w-8 text-slate-400 mx-auto" />
                <h3 className="font-bold text-slate-900">No matching hubs found</h3>
                <p className="text-xs text-slate-600">
                  No registered ParkSmart hubs or public EV stations matched your current radius
                  and filters.
                </p>
                <Button size="sm" variant="outline" onClick={clearAllFilters}>
                  Reset Filters
                </Button>
              </Card>
            ) : facilities.length > 0 ? (
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
                        <div className="space-y-1.5">
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
                          <div className="flex flex-wrap gap-1">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                fac.availabilityStatus === "LIVE"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : fac.availabilityStatus === "STALE"
                                    ? "bg-amber-50 text-amber-700"
                                    : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {fac.availabilityStatus === "UNKNOWN"
                                ? "Availability unknown"
                                : `${fac.availableSpaces}/${fac.totalCapacity} (${fac.availabilityStatus})`}
                            </span>
                            {fac.ownerVerified && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                                <ShieldCheck className="h-2.5 w-2.5" />
                                Owner Verified
                              </span>
                            )}
                            {fac.stationDocsVerified && (
                              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                                Docs Verified
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
            ) : null}

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
                        {f.availabilityStatus === "UNKNOWN"
                          ? "Availability unknown"
                          : `${f.availableSpaces}/${f.totalCapacity} Bays Free`}
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
