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
  ExternalLink,
} from "lucide-react";
import type { FacilitySearchResultItem } from "@/features/search/search.service";
import { formatPaise, getFacilityPhoto } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";

export interface NearbyOsmStation {
  id: string;
  name: string;
  operator?: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  sockets?: string;
}

interface MapProps {
  facilities: FacilitySearchResultItem[];
  osmStations?: NearbyOsmStation[];
  selectedId: string | null;
  onSelectFacility: (id: string) => void;
  userLocation: { lat: number; lng: number } | null;
  onSearchBounds: (bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }) => void;
  onLocateUser: () => void;
}

export function InteractiveCityMap({
  facilities,
  osmStations = [],
  selectedId,
  onSelectFacility,
  userLocation,
  onSearchBounds,
  onLocateUser,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerGroupRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);

  const selectedFacility =
    facilities.find((f) => f.id === selectedId) ?? facilities[0] ?? null;
  const selectedOsm = osmStations.find((s) => s.id === selectedId) ?? null;

  // Initialize real Leaflet + OpenStreetMap map in browser
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === "undefined") return;
    // Skip Leaflet DOM mounting inside jsdom unit tests where layout dimensions are 0
    if (navigator.userAgent.includes("jsdom")) return;

    let cancelled = false;

    void import("leaflet").then((L) => {
      if (cancelled || !el || mapRef.current) return;

      const centerLat = userLocation?.lat ?? facilities[0]?.latitude ?? 30.8965;
      const centerLng = userLocation?.lng ?? facilities[0]?.longitude ?? 75.8235;

      const map = L.map(el, {
        center: [centerLat, centerLng],
        zoom: 13,
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
    // Mount map once; updates handled in subsequent effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-center map when user location updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation) return;
    map.setView([userLocation.lat, userLocation.lng], 13, { animate: true });
  }, [userLocation]);

  // Render live pins (user GPS, ParkSmart facilities, OSM EV chargers, optional heatmap)
  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group || typeof window === "undefined") return;

    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !group) return;
      group.clearLayers();

      // User GPS dot + 5 km radius ring
      if (userLocation) {
        L.circle([userLocation.lat, userLocation.lng], {
          radius: 5000,
          color: "#2563EB",
          fillColor: "#3B82F6",
          fillOpacity: 0.06,
          weight: 1,
        }).addTo(group);

        const userIcon = L.divIcon({
          className: "parksmart-user-pin",
          html: `<div style="width:18px;height:18px;border-radius:9999px;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,0.25);"></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
          .bindTooltip("Your Current Location")
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
          f.availableSpaces === 0
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

      // Real OpenStreetMap Overpass EV charging points
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
    });

    return () => {
      cancelled = true;
    };
  }, [facilities, osmStations, selectedId, userLocation, showHeatmap, onSelectFacility]);

  function handleSearchCurrentArea() {
    const map = mapRef.current;
    if (!map) {
      onSearchBounds({ north: 31.0, south: 30.8, east: 76.0, west: 75.7 });
      return;
    }
    const b = map.getBounds();
    onSearchBounds({
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    });
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

      {/* Selected Pin Floating Callout Card */}
      {(selectedFacility || selectedOsm) && (
        <div className="absolute left-3 bottom-12 sm:left-4 sm:bottom-4 z-[400] w-72 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur p-3 shadow-lg">
          {selectedOsm ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 rounded bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-800">
                  <Zap className="h-3 w-3" />
                  Live OSM EV Charger
                </span>
                <span className="text-[11px] font-semibold text-slate-500">
                  {selectedOsm.distanceKm} km away
                </span>
              </div>
              <div className="text-xs font-bold text-slate-900">{selectedOsm.name}</div>
              {selectedOsm.operator && (
                <div className="text-[11px] text-slate-600">
                  Operator: {selectedOsm.operator}
                </div>
              )}
              {selectedOsm.sockets && (
                <div className="text-[11px] text-slate-600">{selectedOsm.sockets}</div>
              )}
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${selectedOsm.latitude},${selectedOsm.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline pt-1"
              >
                Navigate to EV Station <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ) : (
            selectedFacility && (
              <div className="flex items-center gap-2.5">
                <img
                  src={getFacilityPhoto(selectedFacility.slug, selectedFacility.photos)}
                  alt={selectedFacility.name}
                  className="h-14 w-16 rounded-xl object-cover shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold text-slate-900">
                    {selectedFacility.name}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-amber-600 font-semibold">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    {selectedFacility.averageRating} ({selectedFacility.reviewCount})
                  </div>
                  <div className="text-[11px] text-slate-600">
                    <strong className="text-slate-900">
                      {formatPaise(selectedFacility.hourlyRatePaise)}
                    </strong>
                    /hr · {selectedFacility.distanceKm} km
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                      {selectedFacility.availableSpaces}/{selectedFacility.totalCapacity} Available
                    </span>
                    <Link
                      href={`/facilities/${selectedFacility.slug}`}
                      className="text-[11px] font-bold text-blue-700 hover:underline"
                    >
                      Book →
                    </Link>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* Accessible Pin Selector Strip (ensures keyboard & screen-reader pin access) */}
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
