"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import {
  Clock,
  Zap,
  Car,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Star,
  Sparkles,
  CreditCard,
  QrCode,
  BatteryCharging,
  ArrowLeft,
  Navigation,
} from "lucide-react";
import { Badge, Button, Card, Input, StatusPill } from "@/components/ui/primitives";
import { formatPaise, getFacilityGallery } from "@/lib/utils";
import type { PriceBreakdown } from "@/features/pricing/pricing.service";

interface SpaceItem {
  id: string;
  zoneId: string;
  code: string;
  category: string;
  status: string;
  isEvCompatible: boolean;
  isAccessible: boolean;
  availableForWindow: boolean;
  effectiveStatus: string;
}

interface ConnectorItem {
  id: string;
  stationId: string;
  connectorNumber: number;
  standard: string;
  currentType: string;
  maxPowerKw: number;
  status: string;
  pricePerKwhPaise: number;
  sessionFeePaise: number;
  idleFeePerMinPaise: number;
  faultReason: string | null;
  availableForWindow: boolean;
  effectiveStatus: string;
}

interface InitialData {
  facility: {
    id: string;
    slug: string;
    name: string;
    description: string;
    facilityType: string;
    dataSourceType: string;
    addressLine1: string;
    landmark: string | null;
    city: string;
    state: string;
    postalCode: string;
    latitude: number;
    longitude: number;
    is24Hours: boolean;
    isCovered: boolean;
    hasSecurity: boolean;
    hasAccessibility: boolean;
    hasEvCharging: boolean;
    totalCapacity: number;
    supportPhone: string | null;
    cancellationPolicy: string;
    amenities: string[];
    photos: string[];
    availabilityUpdatedAt: string | Date;
  };
  hours: Array<{
    id: string;
    dayOfWeek: number;
    openTime: string;
    closeTime: string;
    isClosed: boolean;
  }>;
  pricingRules: Array<{
    id: string;
    name: string;
    spaceCategory: string | null;
    hourlyRatePaise: number;
    dailyMaxPaise: number;
    minBillableMinutes: number;
    gracePeriodMinutes: number;
    taxBps: number;
  }>;
  reviews: Array<{
    id: string;
    rating: number;
    comment: string;
    createdAt: string | Date;
    authorName: string;
  }>;
  availability: {
    availabilityUpdatedAt: string | Date;
    isStale: boolean;
    summary: {
      totalSpaces: number;
      availableSpaces: number;
      occupiedSpaces: number;
      outOfServiceSpaces: number;
      totalConnectors: number;
      availableConnectors: number;
      faultedConnectors: number;
    };
    zones: Array<{ id: string; name: string; level: string }>;
    spaces: SpaceItem[];
    connectors: ConnectorItem[];
  };
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toLocalDatetimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FacilityBookingClient({ initial }: { initial: InitialData }) {
  const [avail, setAvail] = useState(initial.availability);
  const [startLocal, setStartLocal] = useState(() =>
    toLocalDatetimeInput(new Date(Date.now() + 15 * 60 * 1000))
  );
  const [endLocal, setEndLocal] = useState(() =>
    toLocalDatetimeInput(new Date(Date.now() + 135 * 60 * 1000))
  );
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(
    () => initial.availability.spaces.find((s) => s.availableForWindow)?.id ?? null
  );
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);
  const [estimatedKwh, setEstimatedKwh] = useState(15);
  const [promoCode, setPromoCode] = useState("");
  const [estimate, setEstimate] = useState<PriceBreakdown | null>(null);
  const [estimating, setEstimating] = useState(false);

  const [bookingStep, setBookingStep] = useState<"SELECT" | "HOLD_CREATED" | "CONFIRMED">("SELECT");
  const [reservation, setReservation] = useState<{
    id: string;
    bookingReference: string;
    totalEstimatedPaise: number;
    holdExpiresAt: string;
  } | null>(null);
  const [paymentOrder, setPaymentOrder] = useState<{
    id: string;
    gatewayOrderId: string;
    amountPaise: number;
  } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrRawToken, setQrRawToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simMessage, setSimMessage] = useState<string | null>(null);

  const refreshAvailability = useCallback(async () => {
    const startIso = new Date(startLocal).toISOString();
    const endIso = new Date(endLocal).toISOString();
    const res = await fetch(
      `/api/v1/availability/${initial.facility.id}?startTime=${encodeURIComponent(startIso)}&endTime=${encodeURIComponent(endIso)}`
    );
    const json = await res.json();
    if (json.ok) {
      setAvail(json.data);
    }
  }, [initial.facility.id, startLocal, endLocal]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshAvailability();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshAvailability]);

  // Live SSE listener scoped to this facility
  useEffect(() => {
    const es = new EventSource(`/api/v1/events/stream?facilityId=${initial.facility.id}`);
    es.addEventListener("platform_event", () => {
      refreshAvailability();
    });
    return () => es.close();
  }, [initial.facility.id, refreshAvailability]);

  // Recompute server price estimate whenever window/space/connector changes
  const refreshEstimate = useCallback(async () => {
    if (!startLocal || !endLocal) return;
    const start = new Date(startLocal);
    const end = new Date(endLocal);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return;

    const selectedSpace = avail.spaces.find((s) => s.id === selectedSpaceId);
    setEstimating(true);
    try {
      const res = await fetch("/api/v1/pricing/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facilityId: initial.facility.id,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          spaceCategory: selectedSpace?.category,
          connectorId: selectedConnectorId,
          estimatedKwh: selectedConnectorId ? estimatedKwh : 0,
          promoCode: promoCode.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setEstimate(json.data);
      }
    } finally {
      setEstimating(false);
    }
  }, [
    initial.facility.id,
    startLocal,
    endLocal,
    selectedSpaceId,
    selectedConnectorId,
    estimatedKwh,
    promoCode,
    avail.spaces,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshEstimate();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshEstimate]);

  async function handleCreateHold() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/v1/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `hold-${initial.facility.id}-${selectedSpaceId ?? "none"}-${selectedConnectorId ?? "none"}-${startLocal}`,
        },
        body: JSON.stringify({
          facilityId: initial.facility.id,
          parkingSpaceId: selectedSpaceId,
          connectorId: selectedConnectorId,
          startTime: new Date(startLocal).toISOString(),
          endTime: new Date(endLocal).toISOString(),
          estimatedKwh: selectedConnectorId ? estimatedKwh : 0,
          promoCode: promoCode.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (res.status === 401) {
        setError("Please sign in first to create a reservation hold.");
        return;
      }
      if (!res.ok || !json.ok) {
        setError(json.error?.message || "Could not lock bay hold");
        return;
      }

      const createdRes = json.data.reservation;
      setReservation(createdRes);

      // Immediately create sandbox payment order
      const orderRes = await fetch("/api/v1/payments/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `ord-${createdRes.id}`,
        },
        body: JSON.stringify({ reservationId: createdRes.id }),
      });
      const orderJson = await orderRes.json();
      if (!orderRes.ok || !orderJson.ok) {
        setError(orderJson.error?.message || "Payment order creation failed");
        return;
      }

      setPaymentOrder(orderJson.data.order);
      setBookingStep("HOLD_CREATED");
      refreshAvailability();
    } catch {
      setError("Network error while creating hold");
    } finally {
      setBusy(false);
    }
  }

  async function handleSandboxPayment() {
    if (!paymentOrder) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/v1/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentOrderId: paymentOrder.id,
          simulateSandboxSuccess: true,
          method: "UPI_SANDBOX",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error?.message || "Payment verification failed");
        return;
      }
      const token = json.data.qrPayload as string;
      setQrRawToken(token);
      if (token) {
        const url = await QRCode.toDataURL(token, { width: 220, margin: 1 });
        setQrDataUrl(url);
      }
      setBookingStep("CONFIRMED");
      refreshAvailability();
    } catch {
      setError("Network error verifying payment");
    } finally {
      setBusy(false);
    }
  }

  async function handleStartSimulatedCharge(connectorId: string) {
    setError(null);
    setSimMessage(null);
    setBusy(true);
    try {
      const res = await fetch("/api/v1/charging/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorId,
          reservationId: reservation?.id ?? null,
          targetKwh: estimatedKwh,
        }),
      });
      const json = await res.json();
      if (res.status === 401) {
        setError("Sign in first to start a simulated EV charging session.");
        return;
      }
      if (!res.ok || !json.ok) {
        setError(json.error?.message || "Could not start EV charging session");
        return;
      }
      setSimMessage(
        `Simulated OCPP charging started (${json.data.session.externalSessionRef}). Manage live telemetry in My Mobility Dashboard.`
      );
      refreshAvailability();
    } finally {
      setBusy(false);
    }
  }

  const fac = initial.facility;
  const gallery = getFacilityGallery(fac.slug, fac.photos);
  const [activePhoto, setActivePhoto] = useState(gallery[0]!);
  const miniMapRef = useRef<HTMLDivElement | null>(null);
  const baseRule = initial.pricingRules[0];
  const avgRating =
    initial.reviews.length > 0
      ? (
          initial.reviews.reduce((s, r) => s + r.rating, 0) / initial.reviews.length
        ).toFixed(1)
      : "—";

  useEffect(() => {
    const el = miniMapRef.current;
    if (!el || typeof window === "undefined" || navigator.userAgent.includes("jsdom")) return;
    let mapInstance: import("leaflet").Map | null = null;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !el) return;
      mapInstance = L.map(el, {
        center: [fac.latitude, fac.longitude],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(mapInstance);
      const pin = L.divIcon({
        className: "parksmart-detail-pin",
        html: `<div style="width:28px;height:28px;border-radius:9999px;background:#EF4444;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.35);"></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker([fac.latitude, fac.longitude], { icon: pin }).addTo(mapInstance);
    });
    return () => {
      cancelled = true;
      mapInstance?.remove();
    };
  }, [fac.latitude, fac.longitude]);

  return (
    <div className="bg-[#F4F7FB] min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        <Link
          href="/explore"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Search
        </Link>

        {/* Screen 3 Hero Card: Left Photo Gallery + Details, Right Real Map + Book a Slot */}
        <div className="grid gap-6 lg:grid-cols-12 items-start">
          <Card className="lg:col-span-8 p-5 space-y-5 bg-white border-slate-200/80 shadow-sm">
            {/* Main Photo + 4 Thumbnails */}
            <div className="space-y-3">
              <img
                src={activePhoto}
                alt={fac.name}
                className="h-64 sm:h-72 w-full rounded-2xl object-cover"
              />
              <div className="grid grid-cols-4 gap-2.5">
                {gallery.map((imgUrl, idx) => (
                  <button
                    key={`${imgUrl}-${idx}`}
                    type="button"
                    onClick={() => setActivePhoto(imgUrl)}
                    className={`overflow-hidden rounded-xl border-2 transition cursor-pointer ${
                      activePhoto === imgUrl
                        ? "border-blue-600"
                        : "border-transparent opacity-80 hover:opacity-100"
                    }`}
                  >
                    <img
                      src={imgUrl}
                      alt={`${fac.name} view ${idx + 1}`}
                      className="h-14 w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Facility Heading, Price & Availability Pill */}
            <div className="space-y-2 border-b border-slate-100 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold text-slate-900">{fac.name}</h1>
                <Badge variant="info">{fac.facilityType.replace(/_/g, " ")}</Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1 font-bold text-slate-900">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {avgRating}
                </span>
                <span>({initial.reviews.length} reviews)</span>
                <span>· {fac.addressLine1}, {fac.city}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <span className="text-xl font-extrabold text-slate-900">
                  {formatPaise(baseRule?.hourlyRatePaise ?? 4000)}{" "}
                  <span className="text-xs font-medium text-slate-500">/ hour</span>
                </span>
                <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                  {avail.summary.availableSpaces}/{avail.summary.totalSpaces} Available
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-2 text-xs font-medium text-slate-600">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  {fac.is24Hours ? "24/7" : "06:00–23:00"}
                </span>
                {fac.isCovered && (
                  <span className="inline-flex items-center gap-1">
                    <Car className="h-3.5 w-3.5 text-slate-400" />
                    Covered
                  </span>
                )}
                {fac.hasSecurity && (
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
                    CCTV
                  </span>
                )}
                {fac.hasEvCharging && (
                  <span className="inline-flex items-center gap-1 text-blue-700 font-semibold">
                    <Zap className="h-3.5 w-3.5" />
                    EV Charging
                  </span>
                )}
              </div>
            </div>

            {/* About This Facility + Amenity Pills */}
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-slate-900">About This Facility</h2>
              <p className="text-xs leading-relaxed text-slate-600">{fac.description}</p>
              <div className="flex flex-wrap gap-2">
                {fac.amenities.map((a) => (
                  <span
                    key={a}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          </Card>

          {/* Right Real Mini Location Map & Book a Slot / Get Directions Card */}
          <Card className="lg:col-span-4 p-4 space-y-4 bg-white border-slate-200/80 shadow-sm">
            <div
              ref={miniMapRef}
              className="relative h-60 w-full overflow-hidden rounded-xl border border-slate-200 bg-[#EEF3F8]"
            />

            <a href="#slot-booking" className="block">
              <button
                type="button"
                className="w-full rounded-xl bg-[#1D5CD6] hover:bg-[#1E40AF] py-3 text-sm font-bold text-white shadow-sm transition cursor-pointer"
              >
                Book a Slot
              </button>
            </a>

            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${fac.latitude},${fac.longitude}`}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
            >
              <Navigation className="h-3.5 w-3.5" />
              Get Directions
              <ExternalLink className="h-3 w-3" />
            </a>

            {fac.supportPhone && (
              <div className="text-center text-[11px] text-slate-500">
                24/7 Support: {fac.supportPhone}
              </div>
            )}
          </Card>
        </div>

        {/* Main Split: Inventory Selection (Left) + Pricing & Checkout (Right) */}
        <div id="slot-booking" className="grid gap-8 lg:grid-cols-12 items-start">
        <div className="lg:col-span-7 space-y-6">
          {/* Time Window Picker */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-900">1. Select Arrival &amp; Departure Window</h2>
              <span className="text-xs text-emerald-700 font-semibold">
                {avail.summary.availableSpaces}/{avail.summary.totalSpaces} spaces free
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="start-time" className="mb-1 block text-xs font-semibold text-slate-700">
                  Arrival Time
                </label>
                <Input
                  id="start-time"
                  type="datetime-local"
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="end-time" className="mb-1 block text-xs font-semibold text-slate-700">
                  Departure Time
                </label>
                <Input
                  id="end-time"
                  type="datetime-local"
                  value={endLocal}
                  onChange={(e) => setEndLocal(e.target.value)}
                />
              </div>
            </div>
          </Card>

          {/* Parking Spaces by Zone */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <Car className="h-4 w-4 text-emerald-600" />
                2. Choose Parking Space
              </h2>
              <span className="text-xs text-slate-500">
                Click any AVAILABLE bay for this time window
              </span>
            </div>

            {avail.zones.map((zone) => {
              const zoneSpaces = avail.spaces.filter((s) => s.zoneId === zone.id);
              return (
                <div key={zone.id} className="space-y-2.5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {zone.name} ({zone.level})
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {zoneSpaces.map((sp) => {
                      const selected = sp.id === selectedSpaceId;
                      return (
                        <button
                          key={sp.id}
                          type="button"
                          disabled={!sp.availableForWindow}
                          onClick={() => setSelectedSpaceId(sp.id)}
                          className={`rounded-xl border p-3 text-left transition ${
                            !sp.availableForWindow
                              ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                              : selected
                                ? "border-slate-900 bg-slate-900 text-white ring-2 ring-emerald-400 cursor-pointer"
                                : "border-emerald-200 bg-emerald-50/60 text-slate-900 hover:border-emerald-500 cursor-pointer"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-sm">{sp.code}</span>
                            {sp.isEvCompatible && (
                              <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            )}
                          </div>
                          <div className="mt-1 text-[11px] font-medium">
                            {sp.category.replace("_", " ")}
                          </div>
                          <div className="mt-1 text-[10px] uppercase font-semibold">
                            {sp.effectiveStatus}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </Card>

          {/* EV Charging Connectors */}
          {avail.connectors.length > 0 && (
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-slate-900 flex items-center gap-2">
                  <BatteryCharging className="h-4 w-4 text-amber-600" />
                  3. EV Charging Connectors (Optional)
                </h2>
                {selectedConnectorId && (
                  <button
                    type="button"
                    onClick={() => setSelectedConnectorId(null)}
                    className="text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    Remove EV charger
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {avail.connectors.map((c) => {
                  const selected = c.id === selectedConnectorId;
                  return (
                    <div
                      key={c.id}
                      className={`rounded-xl border p-4 space-y-2 ${
                        selected
                          ? "border-amber-500 bg-amber-50/70 ring-2 ring-amber-400/30"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-sm text-slate-900">
                          #{c.connectorNumber} · {c.standard} ({c.maxPowerKw} kW {c.currentType})
                        </div>
                        <StatusPill status={c.effectiveStatus} />
                      </div>
                      <div className="text-xs text-slate-600">
                        {formatPaise(c.pricePerKwhPaise)}/kWh · Session{" "}
                        {formatPaise(c.sessionFeePaise)} · Idle{" "}
                        {formatPaise(c.idleFeePerMinPaise)}/min
                      </div>
                      {c.faultReason && (
                        <div className="flex items-center gap-1 text-xs text-red-700">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          {c.faultReason}
                        </div>
                      )}
                      <div className="flex gap-2 pt-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={selected ? "primary" : "outline"}
                          disabled={!c.availableForWindow}
                          onClick={() => setSelectedConnectorId(selected ? null : c.id)}
                        >
                          {selected ? "Selected with Booking" : "Add to Booking"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!c.availableForWindow || busy}
                          onClick={() => handleStartSimulatedCharge(c.id)}
                        >
                          <Zap className="h-3.5 w-3.5 text-amber-600" />
                          Simulate Charge Now
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedConnectorId && (
                <div className="pt-2">
                  <label htmlFor="est-kwh" className="mb-1 block text-xs font-semibold text-slate-700">
                    Estimated Energy Needed (kWh): {estimatedKwh} kWh
                  </label>
                  <input
                    id="est-kwh"
                    type="range"
                    min={5}
                    max={80}
                    step={5}
                    value={estimatedKwh}
                    onChange={(e) => setEstimatedKwh(Number(e.target.value))}
                    className="w-full accent-amber-600"
                  />
                </div>
              )}

              {simMessage && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                  {simMessage}{" "}
                  <Link href="/dashboard" className="font-bold underline">
                    Go to Customer Dashboard →
                  </Link>
                </div>
              )}
            </Card>
          )}

          {/* Policies, Hours, Pricing Rules & Reviews */}
          <Card className="p-5 space-y-5">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Pricing Rules &amp; Cancellation Policy</h3>
              <p className="mt-1 text-xs text-slate-600">{fac.cancellationPolicy}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {initial.pricingRules.map((rule) => (
                  <div key={rule.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                    <div className="font-semibold text-slate-900">{rule.name}</div>
                    <div className="text-slate-600 mt-0.5">
                      {formatPaise(rule.hourlyRatePaise)}/hr · Daily Cap{" "}
                      {formatPaise(rule.dailyMaxPaise)} · Grace {rule.gracePeriodMinutes}m
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <h3 className="font-bold text-slate-900 text-sm mb-2">Operating Hours</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {initial.hours.map((h) => (
                  <div key={h.id} className="rounded bg-slate-50 px-2.5 py-1.5">
                    <span className="font-semibold">{DAY_NAMES[h.dayOfWeek]}: </span>
                    <span className="text-slate-600">
                      {h.isClosed ? "Closed" : `${h.openTime}–${h.closeTime}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <h3 className="font-bold text-slate-900 text-sm mb-2">
                Driver Reviews ({initial.reviews.length})
              </h3>
              <div className="space-y-2">
                {initial.reviews.map((rev) => (
                  <div key={rev.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                    <div className="flex items-center justify-between font-semibold">
                      <span>{rev.authorName}</span>
                      <span className="inline-flex items-center gap-0.5 text-amber-600">
                        <Star className="h-3 w-3 fill-amber-400" />
                        {rev.rating}/5
                      </span>
                    </div>
                    <p className="mt-1 text-slate-600">{rev.comment}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Right Sticky Booking & Sandbox Checkout Panel */}
        <div className="lg:col-span-5 lg:sticky lg:top-20 space-y-4">
          <Card className="p-6 space-y-5 border-slate-300">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Booking Summary</h2>
              <Badge variant="success">Server-Verified Price</Badge>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {error}{" "}
                {error.includes("sign in") && (
                  <Link href="/login" className="font-bold underline ml-1">
                    Sign in now →
                  </Link>
                )}
              </div>
            )}

            {bookingStep === "CONFIRMED" && reservation ? (
              <div className="space-y-4 text-center">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  Booking Confirmed &amp; Paid
                </div>
                <div className="text-xl font-bold text-slate-900">
                  Ref: {reservation.bookingReference}
                </div>
                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt="Gate Check-In QR Code"
                    className="mx-auto rounded-xl border border-slate-200 p-2 bg-white"
                  />
                )}
                {qrRawToken && (
                  <div className="rounded-lg bg-slate-100 p-2 text-[10px] font-mono text-slate-700 break-all">
                    Signed Gate QR Token: {qrRawToken}
                  </div>
                )}
                <div className="flex gap-2">
                  <Link href="/dashboard" className="flex-1">
                    <Button variant="primary" className="w-full">
                      View in Dashboard
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setBookingStep("SELECT");
                      setReservation(null);
                      setPaymentOrder(null);
                    }}
                  >
                    Book Another
                  </Button>
                </div>
              </div>
            ) : bookingStep === "HOLD_CREATED" && reservation && paymentOrder ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    Atomic 10-Min Hold Active ({reservation.bookingReference})
                  </div>
                  <p>
                    Hold expires at {new Date(reservation.holdExpiresAt).toLocaleTimeString()}.
                    Complete payment verification to issue your signed gate QR pass.
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 p-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Gateway Order ID</span>
                    <span className="font-mono font-semibold">{paymentOrder.gatewayOrderId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Payable Total</span>
                    <span className="font-bold text-slate-900 text-sm">
                      {formatPaise(paymentOrder.amountPaise)}
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="emerald"
                  className="w-full"
                  disabled={busy}
                  onClick={handleSandboxPayment}
                >
                  <CreditCard className="h-4 w-4" />
                  {busy ? "Verifying Payment..." : "Complete Payment & Confirm Slot"}
                </Button>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="promo" className="mb-1 block text-xs font-semibold text-slate-700">
                    Promo Code (optional)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="promo"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                      placeholder="EVFIRST10"
                    />
                    <Button type="button" variant="outline" onClick={refreshEstimate}>
                      <Sparkles className="h-4 w-4" />
                      Apply
                    </Button>
                  </div>
                </div>

                {estimate ? (
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
                    <div className="font-semibold text-slate-900">
                      Itemized Breakdown ({estimate.durationMinutes} min · {estimate.ruleName})
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Parking Base</span>
                      <span>{formatPaise(estimate.parkingBasePaise)}</span>
                    </div>
                    {estimate.chargingEstimatePaise > 0 && (
                      <div className="flex justify-between text-amber-800">
                        <span>EV Charging Est. ({estimatedKwh} kWh + fee)</span>
                        <span>{formatPaise(estimate.chargingEstimatePaise)}</span>
                      </div>
                    )}
                    {estimate.discountPaise > 0 && (
                      <div className="flex justify-between text-emerald-700 font-medium">
                        <span>Promo Discount</span>
                        <span>-{formatPaise(estimate.discountPaise)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-600">
                      <span>Platform Fee ({estimate.platformFeeBps / 100}%)</span>
                      <span>{formatPaise(estimate.platformFeePaise)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>GST ({estimate.taxBps / 100}%)</span>
                      <span>{formatPaise(estimate.taxPaise)}</span>
                    </div>
                    <div className="border-t border-slate-200 pt-2 flex justify-between text-base font-bold text-slate-900">
                      <span>Total Payable</span>
                      <span>{formatPaise(estimate.totalEstimatedPaise)}</span>
                    </div>
                    {(estimate.isPeakApplied || estimate.isWeekendApplied || estimate.isDailyCapApplied) && (
                      <div className="pt-1 text-[11px] text-slate-500">
                        Applied:{" "}
                        {[
                          estimate.isPeakApplied && "Peak Hour",
                          estimate.isWeekendApplied && "Weekend",
                          estimate.isDailyCapApplied && "Daily Cap",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    {estimating ? "Calculating server price..." : "Select valid start/end times."}
                  </div>
                )}

                <Button
                  type="button"
                  variant="primary"
                  className="w-full"
                  disabled={busy || (!selectedSpaceId && !selectedConnectorId)}
                  onClick={handleCreateHold}
                >
                  <QrCode className="h-4 w-4" />
                  {busy ? "Locking Resource..." : "Hold Resource & Checkout"}
                </Button>

                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  Price is calculated &amp; validated server-side in integer paise.
                </div>
              </>
            )}
          </Card>
        </div>
        </div>
      </div>
    </div>
  );
}
