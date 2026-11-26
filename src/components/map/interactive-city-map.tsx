"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Minus,
  LocateFixed,
  Zap,
  Star,
  ScanSearch,
  Layers,
} from "lucide-react";
import type { FacilitySearchResultItem } from "@/features/search/search.service";
import { formatPaise, getFacilityPhoto } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";

interface MapProps {
  facilities: FacilitySearchResultItem[];
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
  selectedId,
  onSelectFacility,
  userLocation,
  onSearchBounds,
  onLocateUser,
}: MapProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ latOffset: 0, lngOffset: 0 });
  const [showHeatmap, setShowHeatmap] = useState(false);

  const baseCenter = useMemo(() => {
    if (facilities.length === 0) return { lat: 30.8965, lng: 75.8235 };
    const avgLat = facilities.reduce((s, f) => s + f.latitude, 0) / facilities.length;
    const avgLng = facilities.reduce((s, f) => s + f.longitude, 0) / facilities.length;
    return { lat: avgLat, lng: avgLng };
  }, [facilities]);

  const centerLat = baseCenter.lat + pan.latOffset;
  const centerLng = baseCenter.lng + pan.lngOffset;
  const latSpan = 0.055 / zoom;
  const lngSpan = 0.085 / zoom;

  const bounds = useMemo(
    () => ({
      north: centerLat + latSpan / 2,
      south: centerLat - latSpan / 2,
      east: centerLng + lngSpan / 2,
      west: centerLng - lngSpan / 2,
    }),
    [centerLat, centerLng, latSpan, lngSpan]
  );

  function toPct(lat: number, lng: number): { x: number; y: number } {
    const x = ((lng - bounds.west) / (bounds.east - bounds.west)) * 100;
    const y = ((bounds.north - lat) / (bounds.north - bounds.south)) * 100;
    return { x, y };
  }

  const selectedFacility = facilities.find((f) => f.id === selectedId) ?? facilities[0] ?? null;

  return (
    <div className="relative h-[420px] lg:h-[460px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-[#EEF3F8] shadow-xs select-none">
      {/* Light Street Map SVG Vector Canvas (matches ParkSmart reference) */}
      <svg
        viewBox="0 0 1000 600"
        className="absolute inset-0 h-full w-full pointer-events-none"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect width="1000" height="600" fill="#EDF2F7" />
        {/* Soft Green Park Blocks */}
        <rect x="70" y="90" width="160" height="110" rx="18" fill="#D4ECDD" />
        <rect x="690" y="340" width="210" height="140" rx="22" fill="#D4ECDD" />
        <rect x="330" y="420" width="130" height="90" rx="16" fill="#D4ECDD" />
        <rect x="520" y="60" width="140" height="95" rx="16" fill="#D4ECDD" />

        {/* Subtle Secondary Grid */}
        <g stroke="#E2E8F0" strokeWidth="2">
          <line x1="0" y1="150" x2="1000" y2="150" />
          <line x1="0" y1="300" x2="1000" y2="300" />
          <line x1="0" y1="450" x2="1000" y2="450" />
          <line x1="200" y1="0" x2="200" y2="600" />
          <line x1="450" y1="0" x2="450" y2="600" />
          <line x1="720" y1="0" x2="720" y2="600" />
        </g>

        {/* Crisp White Main Roads */}
        <path d="M 0 240 Q 420 265 1000 180" stroke="#FFFFFF" strokeWidth="14" fill="none" />
        <path d="M 160 0 Q 340 310 530 600" stroke="#FFFFFF" strokeWidth="12" fill="none" />
        <path d="M 650 0 L 580 600" stroke="#FFFFFF" strokeWidth="10" fill="none" />
        <path d="M 0 430 Q 520 390 1000 490" stroke="#FFFFFF" strokeWidth="9" fill="none" />
        <circle cx="510" cy="275" r="44" stroke="#FFFFFF" strokeWidth="10" fill="#EDF2F7" />
      </svg>

      {/* Optional Occupancy Heatmap Overlay */}
      {showHeatmap &&
        facilities.map((f) => {
          const pos = toPct(f.latitude, f.longitude);
          const occRatio = f.totalCapacity > 0 ? f.occupiedSpaces / f.totalCapacity : 0.2;
          const color =
            occRatio > 0.7
              ? "rgba(239, 68, 68, 0.32)"
              : occRatio > 0.35
                ? "rgba(245, 158, 11, 0.28)"
                : "rgba(16, 185, 129, 0.28)";
          return (
            <div
              key={`heat-${f.id}`}
              style={{
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
              }}
              className="pointer-events-none absolute h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full"
            />
          );
        })}

      {/* Top Left Action Controls */}
      <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="bg-white/95 text-xs shadow-sm border-slate-200"
          onClick={() => onSearchBounds(bounds)}
        >
          <ScanSearch className="h-3.5 w-3.5" />
          Search area
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

      {/* User Blue Location Dot */}
      {(() => {
        const pos = userLocation
          ? toPct(userLocation.lat, userLocation.lng)
          : { x: 56, y: 58 };
        return (
          <div
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            title="Your location"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/25">
              <span className="h-3.5 w-3.5 rounded-full bg-blue-600 ring-2 ring-white shadow" />
            </span>
          </div>
        );
      })()}

      {/* Green 'P' and Blue '⚡' Pin Markers */}
      {facilities.map((f) => {
        const pos = toPct(f.latitude, f.longitude);
        if (pos.x < 4 || pos.x > 96 || pos.y < 8 || pos.y > 92) return null;
        const isSelected = f.id === selectedFacility?.id;
        return (
          <button
            key={f.id}
            type="button"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            onClick={() => onSelectFacility(f.id)}
            className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white shadow-md transition cursor-pointer ${
              isSelected ? "scale-125 ring-4 ring-blue-500/30 z-30" : "hover:scale-110"
            } ${
              f.availableSpaces === 0
                ? "bg-red-600 text-white"
                : f.hasEvCharging
                  ? "bg-blue-600 text-white"
                  : "bg-emerald-600 text-white"
            }`}
            aria-label={`${f.name}: ${f.availableSpaces} bays available, ${formatPaise(f.hourlyRatePaise)} per hour`}
          >
            {f.hasEvCharging ? (
              <Zap className="h-4 w-4 fill-current" />
            ) : (
              <span className="text-xs font-extrabold">P</span>
            )}
          </button>
        );
      })}

      {/* Floating Map Callout Card for Selected Facility */}
      {selectedFacility && (
        <div className="absolute left-4 top-14 sm:left-auto sm:right-16 sm:top-6 z-30 w-64 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-lg">
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
                {selectedFacility.averageRating} ({selectedFacility.reviewCount} reviews)
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
                  Open →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Right Zoom & Current Location Controls */}
      <div className="absolute right-3 bottom-3 z-20 flex flex-col items-end gap-2">
        <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3, +(z + 0.35).toFixed(2)))}
            className="flex h-8 w-8 items-center justify-center text-slate-700 hover:bg-slate-50 border-b border-slate-100 cursor-pointer"
            aria-label="Zoom in map"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom((z) => Math.max(0.6, +(z - 0.35).toFixed(2)));
              setPan({ latOffset: 0, lngOffset: 0 });
            }}
            className="flex h-8 w-8 items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
            aria-label="Zoom out map"
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={onLocateUser}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 cursor-pointer"
          title="Use my current location"
          aria-label="Use my current location"
        >
          <LocateFixed className="h-3.5 w-3.5 text-blue-600" />
          Current Location
        </button>
      </div>
    </div>
  );
}
