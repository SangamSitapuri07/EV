"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Minus,
  LocateFixed,
  Star,
  ScanSearch,
  Layers,
  Zap,
  Navigation,
  Search,
  X,
  ShieldCheck,
  Clock,
} from "lucide-react";
import type { FacilitySearchResultItem } from "@/features/search/search.service";
import type { ExternalEvChargerStation } from "@/features/search/nearby-chargers.shared";
import type { InAppRoute } from "@/lib/in-app-navigation";
import { formatPaise, getFacilityPhoto } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";

export type NearbyOsmStation = ExternalEvChargerStation;

interface MapProps {
  facilities: FacilitySearchResultItem[];
  osmStations?: ExternalEvChargerStation[];
  selectedId: string | null;
  onSelectFacility: (id: string) => void;
  userLocation: { lat: number; lng: number } | null;
  isDefaultLocation?: boolean;
  radiusKm?: number;
  locationStatus?: "idle" | "prompting" | "granted" | "denied";
  locationError?: string | null;
  onSearchBounds: (bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }) => void;
  onLocateUser: () => void;
  onResolveCityQuery?: (query: string) => Promise<void>;
  onUseDefaultLocation?: () => void;
  activeRoute?: InAppRoute | null;
  navigating?: boolean;
  onNavigateToStation?: (target: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
  }) => void;
  onClearRoute?: () => void;
}

export function InteractiveCityMap({
  facilities,
  osmStations = [],
  selectedId,
  onSelectFacility,
  userLocation,
  isDefaultLocation = false,
  radiusKm = 25,
  locationStatus = "idle",
  locationError,
  onSearchBounds,
  onLocateUser,
  onResolveCityQuery,
  onUseDefaultLocation,
  activeRoute = null,
  navigating = false,
  onNavigateToStation,
  onClearRoute,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerGroupRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const [geocoding, setGeocoding] = useState(false);

  const selectedFacility =
    facilities.find((f) => f.id === selectedId) ?? facilities[0] ?? null;
  const selectedOsm = osmStations.find((s) => s.id === selectedId) ?? null;

  // Initialize real Leaflet + OpenStreetMap map in browser
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === "undefined") return;
    if (navigator.userAgent.includes("jsdom")) return;

    let cancelled = false;

    void import("leaflet").then((L) => {
      if (cancelled || !el || mapRef.current) return;

      const centerLat = userLocation?.lat ?? facilities[0]?.latitude ?? 20.5937;
      const centerLng = userLocation?.lng ?? facilities[0]?.longitude ?? 78.9629;
      const initialZoom = userLocation ? (radiusKm >= 25 ? 11 : 13) : facilities[0] ? 13 : 5;

      const map = L.map(el, {
        center: [centerLat, centerLng],
        zoom: initialZoom,
        zoomControl: false,
        attributionControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      const group = L.layerGroup().addTo(map);
      mapRef.current = map;
      layerGroupRef.current = group;
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerGroupRef.current = null;
      }
    };
    // Mount map once; subsequent view updates handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-center map when route, user location, radius, or facilities update
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (activeRoute && activeRoute.coordinates.length >= 2 && typeof window !== "undefined") {
      void import("leaflet").then((L) => {
        if (!mapRef.current) return;
        mapRef.current.fitBounds(L.latLngBounds(activeRoute.coordinates), {
          padding: [56, 56],
          maxZoom: 15,
        });
      });
      return;
    }

    if (userLocation) {
      const targetZoom = radiusKm >= 40 ? 10 : radiusKm >= 18 ? 11 : radiusKm >= 8 ? 12 : 13;
      map.setView([userLocation.lat, userLocation.lng], targetZoom, { animate: true });
      return;
    }

    if (facilities.length > 0 && typeof window !== "undefined") {
      void import("leaflet").then((L) => {
        if (!mapRef.current) return;
        const pts = facilities.map((f) => [f.latitude, f.longitude] as [number, number]);
        if (pts.length === 1) {
          mapRef.current.setView(pts[0]!, 13);
        } else {
          mapRef.current.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 13 });
        }
      });
    }
  }, [activeRoute, userLocation, radiusKm, facilities]);

  // Render live pins (user GPS, ParkSmart facilities, OSM/OCM EV chargers, optional heatmap)
  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group || typeof window === "undefined") return;

    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !group) return;
      group.clearLayers();

      // User location dot + active search radius circle (matches Distance slider)
      if (userLocation) {
        L.circle([userLocation.lat, userLocation.lng], {
          radius: Math.max(500, radiusKm * 1000),
          color: "#2563EB",
          fillColor: "#3B82F6",
          fillOpacity: 0.06,
          weight: 1.5,
        }).addTo(group);

        const userIcon = L.divIcon({
          className: "parksmart-user-pin",
          html: `<div style="width:18px;height:18px;border-radius:9999px;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,0.25);"></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
          .bindTooltip(
            isDefaultLocation ? "Default Center (Not GPS)" : "Your Search Location"
          )
          .addTo(group);
      }

      // ParkSmart Facility markers
      for (const f of facilities) {
        if (showHeatmap) {
          const occRatio = f.totalCapacity > 0 ? f.occupiedSpaces / f.totalCapacity : 0.2;
          const heatColor =
            occRatio > 0.7 ? "#EF4444" : occRatio > 0.35 ? "#F59E0B" : "#10B981";
          L.circle([f.latitude, f.longitude], {
            radius: 750,
            color: heatColor,
            fillColor: heatColor,
            fillOpacity: 0.22,
            weight: 0,
          }).addTo(group);
        }

        const isSelected = f.id === selectedId;
        const bg =
          f.availabilityStatus === "UNKNOWN"
            ? "#475569"
            : f.availableSpaces === 0
              ? "#DC2626"
              : f.hasEvCharging
                ? "#2563EB"
                : "#059669";
        const label = f.hasEvCharging ? "⚡" : "P";
        const ring = isSelected ? "0 0 0 5px rgba(37,99,235,0.35)" : "0 2px 6px rgba(0,0,0,0.3)";

        const icon = L.divIcon({
          className: "parksmart-fac-pin",
          html: `<div style="width:34px;height:34px;border-radius:9999px;background:${bg};color:#fff;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;box-shadow:${ring};cursor:pointer;">${label}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });

        const marker = L.marker([f.latitude, f.longitude], { icon });
        marker.on("click", () => onSelectFacility(f.id));
        marker.addTo(group);
      }

      // External OpenStreetMap / Open Charge Map EV charging points
      for (const s of osmStations) {
        const isSelected = s.id === selectedId;
        const icon = L.divIcon({
          className: "parksmart-osm-ev-pin",
          html: `<div style="width:30px;height:30px;border-radius:9999px;background:#0D9488;color:#fff;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;box-shadow:${isSelected ? "0 0 0 5px rgba(13,148,136,0.35)" : "0 2px 6px rgba(0,0,0,0.28)"};cursor:pointer;">⚡</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });
        const marker = L.marker([s.latitude, s.longitude], { icon });
        marker.on("click", () => onSelectFacility(s.id));
        marker.addTo(group);
      }

      // Active in-app route polyline
      if (activeRoute && activeRoute.coordinates.length >= 2) {
        L.polyline(activeRoute.coordinates, {
          color: "#1D4ED8",
          weight: 5,
          opacity: 0.9,
          dashArray: activeRoute.source === "DIRECT_FALLBACK" ? "8 6" : undefined,
        }).addTo(group);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    facilities,
    osmStations,
    selectedId,
    userLocation,
    isDefaultLocation,
    radiusKm,
    showHeatmap,
    activeRoute,
    onSelectFacility,
  ]);

  function handleSearchCurrentArea() {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    onSearchBounds({
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    });
  }

  async function handleCitySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cityQuery.trim() || !onResolveCityQuery) return;
    setGeocoding(true);
    try {
      await onResolveCityQuery(cityQuery.trim());
    } finally {
      setGeocoding(false);
    }
  }

  return (
    <div className="relative h-[440px] lg:h-[490px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-[#EEF3F8] shadow-xs">
      {/* Real Leaflet OpenStreetMap Canvas */}
      <div ref={containerRef} className="h-full w-full z-0" />

      {/* Top Left Action Controls */}
      <div className="absolute left-3 top-3 z-[400] flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="bg-white/95 text-xs shadow-sm border-slate-200"
          onClick={handleSearchCurrentArea}
        >
          <ScanSearch className="h-3.5 w-3.5" />
          Search this map area
        </Button>
        <Button
          type="button"
          size="sm"
          variant={showHeatmap ? "emerald" : "outline"}
          className={
            showHeatmap
              ? "text-xs shadow-sm"
              : "bg-white/95 text-xs shadow-sm border-slate-200"
          }
          onClick={() => setShowHeatmap((v) => !v)}
        >
          <Layers className="h-3.5 w-3.5" />
          {showHeatmap ? "Heatmap On" : "Occupancy Heatmap"}
        </Button>
      </div>

      {/* Prominent In-Map Location Permission Prompt when userLocation is not yet active */}
      {!userLocation && !promptDismissed && (
        <div className="absolute right-3 top-14 sm:top-3 z-[450] w-80 max-w-[calc(100%-1.5rem)] rounded-2xl border border-blue-200 bg-white/95 backdrop-blur p-4 shadow-xl space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600 shrink-0">
                <LocateFixed className="h-4 w-4" />
              </span>
              <div>
                <div className="text-xs font-extrabold text-slate-900">
                  Allow Location Access
                </div>
                <div className="text-[11px] text-slate-600">
                  Find real EV charging points near you
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPromptDismissed(true)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 cursor-pointer"
              aria-label="Dismiss location prompt"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {locationError && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-900">
              {locationError}
            </div>
          )}

          <Button
            type="button"
            size="sm"
            variant="primary"
            className="w-full"
            onClick={onLocateUser}
            disabled={locationStatus === "prompting"}
          >
            <LocateFixed className="h-3.5 w-3.5" />
            {locationStatus === "prompting"
              ? "Waiting for browser permission..."
              : "Share My Current Location"}
          </Button>

          {onResolveCityQuery && (
            <form
              onSubmit={handleCitySubmit}
              className="flex items-center gap-1.5 pt-1 border-t border-slate-100"
            >
              <input
                type="text"
                value={cityQuery}
                onChange={(e) => setCityQuery(e.target.value)}
                placeholder="Or enter city / area..."
                className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
              />
              <Button type="submit" size="sm" variant="outline" disabled={geocoding}>
                <Search className="h-3.5 w-3.5" />
              </Button>
            </form>
          )}

          {onUseDefaultLocation && (
            <button
              type="button"
              onClick={onUseDefaultLocation}
              className="w-full text-center text-[11px] font-semibold text-slate-500 hover:text-slate-800 underline cursor-pointer"
            >
              Use Default Location (New Delhi)
            </button>
          )}
        </div>
      )}

      {/* Selected Pin Floating Callout Card */}
      {(selectedFacility || selectedOsm) && (
        <div className="absolute left-3 bottom-12 sm:left-4 sm:bottom-4 z-[400] w-80 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur p-3 shadow-lg">
          {selectedOsm ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 rounded bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-800">
                  <Zap className="h-3 w-3" />
                  {selectedOsm.source === "INDIA_OPEN_EV_DATA"
                    ? "India EV Directory"
                    : selectedOsm.source === "BEE_INDIA_API"
                      ? "BEE India EV"
                      : selectedOsm.source === "GOOGLE_PLACES"
                        ? "Google Places EV"
                        : selectedOsm.source === "OPEN_CHARGE_MAP"
                          ? "Open Charge Map"
                          : "OpenStreetMap"}
                </span>
                <span className="text-[11px] font-semibold text-slate-500">
                  {selectedOsm.distanceKm} km away
                </span>
              </div>
              <div className="text-xs font-bold text-slate-900">{selectedOsm.name}</div>
              {selectedOsm.operator && (
                <div className="text-[11px] text-slate-600">
                  Operator: {selectedOsm.operator}
                  {selectedOsm.pricing ? ` · ${selectedOsm.pricing}` : ""}
                </div>
              )}
              {!selectedOsm.operator && selectedOsm.pricing && (
                <div className="text-[11px] text-slate-600">Tariff: {selectedOsm.pricing}</div>
              )}
              {selectedOsm.address && (
                <div className="text-[11px] text-slate-500 line-clamp-2">
                  {selectedOsm.address}
                </div>
              )}
              {selectedOsm.sockets && (
                <div className="text-[11px] text-slate-600">{selectedOsm.sockets}</div>
              )}
              <div
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold ${
                  selectedOsm.availabilityStatus === "LIVE"
                    ? "bg-emerald-50 text-emerald-700"
                    : selectedOsm.availabilityStatus === "STALE"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-slate-100 text-slate-700"
                }`}
              >
                <Clock className="h-3 w-3" />
                {selectedOsm.availabilityStatus === "LIVE" &&
                selectedOsm.availableConnectors !== null &&
                selectedOsm.availableConnectors !== undefined &&
                selectedOsm.totalConnectors !== null &&
                selectedOsm.totalConnectors !== undefined
                  ? `${selectedOsm.availableConnectors}/${selectedOsm.totalConnectors} ports available (Live)`
                  : selectedOsm.availabilityStatus === "STALE"
                    ? "Availability stale"
                    : "Availability unknown (external map listing)"}
              </div>
              <div className="flex items-center justify-between pt-1">
                {onNavigateToStation && (
                  <button
                    type="button"
                    disabled={navigating}
                    onClick={() =>
                      onNavigateToStation({
                        id: selectedOsm.id,
                        name: selectedOsm.name,
                        latitude: selectedOsm.latitude,
                        longitude: selectedOsm.longitude,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-[#0F2942] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#173A5E] transition cursor-pointer disabled:opacity-60"
                  >
                    <Navigation className="h-3 w-3" />
                    {navigating ? "Routing..." : "Navigate Here"}
                  </button>
                )}
                {activeRoute && activeRoute.destinationId === selectedOsm.id && onClearRoute && (
                  <button
                    type="button"
                    onClick={onClearRoute}
                    className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 underline cursor-pointer"
                  >
                    Clear Route
                  </button>
                )}
              </div>
            </div>
          ) : (
            selectedFacility && (
              <div className="flex items-center gap-2.5">
                <img
                  src={getFacilityPhoto(selectedFacility.slug, selectedFacility.photos)}
                  alt={selectedFacility.name}
                  className="h-14 w-16 rounded-xl object-cover shrink-0"
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="truncate text-xs font-bold text-slate-900">
                    {selectedFacility.name}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-amber-600 font-semibold">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    {selectedFacility.reviewCount > 0
                      ? `${selectedFacility.averageRating} (${selectedFacility.reviewCount})`
                      : "New listing"}
                  </div>
                  <div className="text-[11px] text-slate-600">
                    <strong className="text-slate-900">
                      {formatPaise(selectedFacility.hourlyRatePaise)}
                    </strong>
                    /hr ·{" "}
                    {userLocation
                      ? `${selectedFacility.distanceKm} km`
                      : selectedFacility.city}
                  </div>
                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                        selectedFacility.availabilityStatus === "LIVE"
                          ? "bg-emerald-50 text-emerald-700"
                          : selectedFacility.availabilityStatus === "STALE"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {selectedFacility.availabilityStatus === "UNKNOWN"
                        ? "Availability unknown"
                        : `${selectedFacility.availableSpaces}/${selectedFacility.totalCapacity} (${selectedFacility.availabilityStatus})`}
                    </span>
                    {selectedFacility.ownerVerified && (
                      <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                        <ShieldCheck className="h-2.5 w-2.5" />
                        Owner Verified
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      {onNavigateToStation && (
                        <button
                          type="button"
                          onClick={() =>
                            onNavigateToStation({
                              id: selectedFacility.id,
                              name: selectedFacility.name,
                              latitude: selectedFacility.latitude,
                              longitude: selectedFacility.longitude,
                            })
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700 hover:text-blue-700 cursor-pointer"
                        >
                          <Navigation className="h-3 w-3" />
                          Route
                        </button>
                      )}
                      <Link
                        href={`/facilities/${selectedFacility.slug}`}
                        className="text-[11px] font-bold text-blue-700 hover:underline"
                      >
                        Book →
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* Accessible Pin Selector Strip */}
      <div className="sr-only">
        {facilities.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelectFacility(f.id)}
            aria-label={`${f.name}: ${f.availableSpaces} bays available, ${formatPaise(f.hourlyRatePaise)} per hour`}
          >
            {f.name}
          </button>
        ))}
      </div>

      {/* Bottom Right Zoom & Current Location Controls */}
      <div className="absolute right-3 bottom-6 z-[400] flex flex-col items-end gap-2">
        <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => mapRef.current?.zoomIn()}
            className="flex h-8 w-8 items-center justify-center text-slate-700 hover:bg-slate-50 border-b border-slate-100 cursor-pointer"
            aria-label="Zoom in map"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => mapRef.current?.zoomOut()}
            className="flex h-8 w-8 items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
            aria-label="Zoom out map"
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={onLocateUser}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 shadow-md hover:bg-slate-50 cursor-pointer"
          title="Use my current location"
          aria-label="Use my current location"
        >
          <LocateFixed className="h-3.5 w-3.5 text-blue-600" />
          Use My Location
        </button>
      </div>
    </div>
  );
}
