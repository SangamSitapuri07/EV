"use client";

import { useEffect, useRef } from "react";
import type LType from "leaflet";

export interface TripMapHubStop {
  facilityId: string;
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  maxChargerKw: number;
  availableConnectors: number;
}

export interface TripMapPublicStop {
  id: string;
  name: string;
  operator: string | null;
  latitude: number;
  longitude: number;
  maxPowerKw: number | null;
  pricing: string | null;
  distanceFromOriginKm: number;
}

interface TripCorridorMapProps {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  routePolyline: Array<[number, number]>;
  bookableStops: TripMapHubStop[];
  publicStops: TripMapPublicStop[];
}

export function TripCorridorMap({
  origin,
  destination,
  routePolyline,
  bookableStops,
  publicStops,
}: TripCorridorMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const layerGroupRef = useRef<LType.LayerGroup | null>(null);

  useEffect(() => {
    let active = true;

    async function renderMap() {
      if (!containerRef.current) return;
      const L = (await import("leaflet")).default;
      if (!active || !containerRef.current) return;

      if (!mapRef.current) {
        const map = L.map(containerRef.current, {
          zoomControl: true,
          attributionControl: true,
        }).setView([origin.lat, origin.lng], 9);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors",
          maxZoom: 19,
        }).addTo(map);

        mapRef.current = map;
        layerGroupRef.current = L.layerGroup().addTo(map);
      }

      const map = mapRef.current;
      const layer = layerGroupRef.current;
      if (!map || !layer) return;

      layer.clearLayers();

      const polyCoords =
        routePolyline.length >= 2
          ? routePolyline
          : ([
              [origin.lat, origin.lng],
              [destination.lat, destination.lng],
            ] as Array<[number, number]>);

      L.polyline(polyCoords, {
        color: "#1D5CD6",
        weight: 5,
        opacity: 0.85,
      }).addTo(layer);

      const startMarker = L.divIcon({
        className: "",
        html: `<div style="background:#059669;color:#fff;font-weight:700;font-size:11px;padding:3px 8px;border-radius:9999px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);white-space:nowrap;">Start</div>`,
        iconSize: [44, 24],
        iconAnchor: [22, 12],
      });
      L.marker([origin.lat, origin.lng], { icon: startMarker })
        .bindPopup("Trip Origin")
        .addTo(layer);

      const destMarker = L.divIcon({
        className: "",
        html: `<div style="background:#dc2626;color:#fff;font-weight:700;font-size:11px;padding:3px 8px;border-radius:9999px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);white-space:nowrap;">Dest</div>`,
        iconSize: [44, 24],
        iconAnchor: [22, 12],
      });
      L.marker([destination.lat, destination.lng], { icon: destMarker })
        .bindPopup("Trip Destination")
        .addTo(layer);

      for (const hub of bookableStops) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="background:#d97706;color:#fff;font-weight:700;font-size:10px;padding:3px 7px;border-radius:9999px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);white-space:nowrap;">⚡ ${hub.maxChargerKw}kW Bookable</div>`,
          iconSize: [110, 22],
          iconAnchor: [55, 11],
        });
        L.marker([hub.latitude, hub.longitude], { icon })
          .bindPopup(
            `<strong>${hub.name}</strong><br/>${hub.availableConnectors} free · ${hub.maxChargerKw} kW`
          )
          .addTo(layer);
      }

      for (const stop of publicStops) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="background:#0f766e;color:#fff;font-weight:700;font-size:10px;padding:2px 6px;border-radius:9999px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25);white-space:nowrap;">⚡ ${stop.maxPowerKw ? `${stop.maxPowerKw}kW` : "EV"}</div>`,
          iconSize: [58, 20],
          iconAnchor: [29, 10],
        });
        L.marker([stop.latitude, stop.longitude], { icon })
          .bindPopup(
            `<strong>${stop.name}</strong><br/>${stop.operator ?? "Public EV Directory"} · ${stop.distanceFromOriginKm} km from start<br/><em>Live availability not connected</em>`
          )
          .addTo(layer);
      }

      const bounds = L.latLngBounds(polyCoords);
      bookableStops.forEach((h) => bounds.extend([h.latitude, h.longitude]));
      publicStops.forEach((p) => bounds.extend([p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [36, 36] });
    }

    void renderMap();

    return () => {
      active = false;
    };
  }, [origin, destination, routePolyline, bookableStops, publicStops]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 h-72 w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
