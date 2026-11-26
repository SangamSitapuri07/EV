"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  QrCode,
  Zap,
  Car,
  Plus,
  CheckCircle2,
  AlertCircle,
  BarChart3,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Input,
  Select,
  Skeleton,
  StatusPill,
} from "@/components/ui/primitives";
import { formatPaise } from "@/lib/utils";

interface OperatorDashboardData {
  facilities: Array<{
    id: string;
    name: string;
    city: string;
    status: string;
    facilityType: string;
    hasEvCharging: boolean;
  }>;
  spaces: Array<{
    id: string;
    facilityId: string;
    code: string;
    category: string;
    status: string;
  }>;
  connectors: Array<{
    id: string;
    facilityId: string;
    connectorNumber: number;
    standard: string;
    maxPowerKw: number;
    status: string;
    faultReason: string | null;
  }>;
  reservations: Array<{
    id: string;
    facilityId: string;
    bookingReference: string;
    status: string;
    reservationType: string;
    startTime: string;
    endTime: string;
    totalEstimatedPaise: number;
    finalAmountPaise: number | null;
  }>;
  analytics: {
    period: string;
    totalFacilities: number;
    totalSpaces: number;
    availableSpaces: number;
    occupancyPct: number;
    totalConnectors: number;
    availableConnectors: number;
    faultedConnectors: number;
    activeReservations: number;
    todayBookings: number;
    grossRevenuePaise: number;
    chargingEnergyKwh: number;
    revenueByFacility: Array<{
      facilityId: string;
      name: string;
      status: string;
      totalSpaces: number;
      occupancyPct: number;
      revenuePaise: number;
      bookingsCount: number;
    }>;
    definitions: Record<string, string>;
  };
}

export default function OperatorDashboardPage() {
  const [data, setData] = useState<OperatorDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedFacId, setSelectedFacId] = useState<string>("");

  // Gate QR check-in state
  const [qrInput, setQrInput] = useState("");
  const [refInput, setRefInput] = useState("");

  // New facility onboarding state
  const [newName, setNewName] = useState("");
  const [newAddr, setNewAddr] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("");
  const [newPostal, setNewPostal] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLng, setNewLng] = useState("");
  const [newType, setNewType] = useState("MULTI_LEVEL_GARAGE");
  const [newHourlyInr, setNewHourlyInr] = useState("50");
  const [newEv, setNewEv] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/operator/dashboard");
      const json = await res.json();
      if (res.status === 401 || res.status === 403) {
        setError("Operator or Super Admin access required. Sign in as an operator.");
        return;
      }
      if (!res.ok || !json.ok) {
        setError(json.error?.message || "Failed to load operator hub");
        return;
      }
      setData(json.data);
      if (!selectedFacId && json.data.facilities.length > 0) {
        setSelectedFacId(json.data.facilities[0].id);
      }
    } catch {
      setError("Network error loading operator data");
    } finally {
      setLoading(false);
    }
  }, [selectedFacId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  async function toggleSpace(
    facilityId: string,
    spaceId: string,
    status: "AVAILABLE" | "OCCUPIED" | "OUT_OF_SERVICE"
  ) {
    const res = await fetch(`/api/v1/operator/facilities/${facilityId}/spaces`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId, status }),
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(`Space updated to ${status} and broadcast via SSE.`);
      loadData();
    } else {
      setError(json.error?.message || "Failed to update space");
    }
  }

  async function toggleConnector(
    facilityId: string,
    connectorId: string,
    status: "AVAILABLE" | "FAULTED" | "OFFLINE"
  ) {
    const res = await fetch(`/api/v1/operator/facilities/${facilityId}/connectors`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectorId,
        status,
        faultReason: status === "FAULTED" ? "Marked faulted by operator diagnostics" : null,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(`Connector updated to ${status} and broadcast via SSE.`);
      loadData();
    } else {
      setError(json.error?.message || "Failed to update connector");
    }
  }

  async function handleGateCheckIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/v1/reservations/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        qrToken: qrInput.trim() || undefined,
        bookingReference: refInput.trim() || undefined,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(`Checked in ${json.data.bookingReference} cleanly!`);
      setQrInput("");
      setRefInput("");
      loadData();
    } else {
      setError(json.error?.message || "Gate check-in failed");
    }
  }

  async function handleCheckOut(reservationId: string) {
    const res = await fetch(`/api/v1/reservations/${reservationId}/check-out`, {
      method: "POST",
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(
        `Checked out. Reconciled total: ${formatPaise(json.data.finalAmountPaise)} (overstay ${json.data.overstayMinutes}m).`
      );
      loadData();
    } else {
      setError(json.error?.message || "Check-out failed");
    }
  }

  async function handleCreateFacility(e: React.FormEvent) {
    e.preventDefault();
    const latNum = Number(newLat);
    const lngNum = Number(newLng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      setError("Provide valid latitude and longitude (or click Use Current GPS).");
      return;
    }
    const res = await fetch("/api/v1/operator/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName,
        description: `${newName} managed smart parking and EV charging facility in ${newCity}.`,
        facilityType: newType,
        addressLine1: newAddr,
        city: newCity,
        state: newState,
        postalCode: newPostal,
        latitude: latNum,
        longitude: lngNum,
        hasEvCharging: newEv,
        hourlyRatePaise: Number(newHourlyInr) * 100,
        dailyMaxPaise: Number(newHourlyInr) * 600,
        initialSpacesCount: 6,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      setNewName("");
      setNewAddr("");
      setNewCity("");
      setNewState("");
      setNewPostal("");
      setNewLat("");
      setNewLng("");
      setMessage(
        `Facility "${json.data.facility.name}" submitted (${json.data.facility.status}).`
      );
      loadData();
    } else {
      setError(json.error?.message || "Failed to create facility");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <Card className="p-8 space-y-4">
          <AlertCircle className="h-10 w-10 text-amber-600 mx-auto" />
          <h1 className="text-xl font-bold">{error}</h1>
          <Link href="/login">
            <Button>Sign in with Operator Account</Button>
          </Link>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const activeFacSpaces = data.spaces.filter((s) => s.facilityId === selectedFacId);
  const activeFacConnectors = data.connectors.filter((c) => c.facilityId === selectedFacId);
  const onlineChargers = Math.max(
    0,
    data.analytics.totalConnectors - data.analytics.faultedConnectors
  );
  const chargerPct =
    data.analytics.totalConnectors > 0
      ? Math.round((onlineChargers / data.analytics.totalConnectors) * 100)
      : 100;
  const r = 42;
  const circ = 2 * Math.PI * r;
  const strokeOffset = circ - (chargerPct / 100) * circ;

  return (
    <div className="bg-[#F4F7FB] min-h-[calc(100vh-4rem)]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* Dark Navy Sidebar */}
          <aside className="lg:col-span-3 rounded-2xl bg-[#0F2342] text-white p-4 space-y-1.5 min-h-[560px] shadow-sm">
            <div className="rounded-xl bg-[#1D5CD6] px-3.5 py-2.5 text-xs font-semibold text-white flex items-center gap-3">
              <BarChart3 className="h-4 w-4 shrink-0" />
              Overview
            </div>
            <Link
              href="/ev-pumps"
              className="w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-white/10 transition"
            >
              <Zap className="h-4 w-4 shrink-0" />
              EV Pumps Dashboard
            </Link>
            <Link
              href="/explore"
              className="w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition"
            >
              <Building2 className="h-4 w-4 shrink-0" />
              Live City Map
            </Link>
            <Link
              href="/dashboard"
              className="w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition"
            >
              <Car className="h-4 w-4 shrink-0" />
              User Dashboard
            </Link>
          </aside>

          {/* Main Content */}
          <main className="lg:col-span-9 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900">
                  Operator Dashboard
                </h1>
                <p className="text-xs text-slate-500">
                  Manage your facilities and monitor performance
                </p>
              </div>
              <Link href="/ev-pumps">
                <Button variant="primary" size="sm">
                  <Zap className="h-4 w-4" />
                  Open EV Pumps Dashboard
                </Button>
              </Link>
            </div>

            {message && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {message}
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {/* 4 Clean Metric Cards (Matches Screen 5) */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="p-4 bg-white border-slate-200/80 shadow-xs space-y-1">
                <div className="text-xs text-slate-500">Total Spaces</div>
                <div className="text-2xl font-extrabold text-slate-900">
                  {data.analytics.totalSpaces}
                </div>
              </Card>
              <Card className="p-4 bg-white border-slate-200/80 shadow-xs space-y-1">
                <div className="text-xs text-slate-500">Available</div>
                <div className="text-2xl font-extrabold text-emerald-700">
                  {data.analytics.availableSpaces}
                </div>
              </Card>
              <Card className="p-4 bg-white border-slate-200/80 shadow-xs space-y-1">
                <div className="text-xs text-slate-500">Occupancy</div>
                <div className="text-2xl font-extrabold text-slate-900">
                  {data.analytics.occupancyPct}%
                </div>
              </Card>
              <Card className="p-4 bg-white border-slate-200/80 shadow-xs space-y-1">
                <div className="text-xs text-slate-500">Total Revenue</div>
                <div className="text-2xl font-extrabold text-slate-900">
                  {formatPaise(data.analytics.grossRevenuePaise)}
                </div>
              </Card>
            </div>

            {/* 2-Column Analytics Row: Real Booking Activity + Charger Energy Status */}
            <div className="grid gap-5 lg:grid-cols-12">
              <Card className="lg:col-span-8 p-5 bg-white border-slate-200/80 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-extrabold text-slate-900">
                    Booking &amp; Occupancy Activity
                  </h2>
                  <span className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                    Last 24 Hours (Real DB)
                  </span>
                </div>
                {(() => {
                  const buckets = [0, 0, 0, 0, 0, 0];
                  const labels = ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"];
                  const nowMs = Date.now();
                  for (const r of data.reservations) {
                    const t = new Date(r.startTime).getTime();
                    if (Math.abs(nowMs - t) <= 24 * 3600_000) {
                      const hr = new Date(r.startTime).getHours();
                      buckets[Math.min(5, Math.floor(hr / 4))]! += 1;
                    }
                  }
                  const maxB = Math.max(1, ...buckets);
                  const pts = buckets.map((val, idx) => ({
                    x: 45 + idx * 90,
                    y: Math.round(145 - (val / maxB) * 105),
                    label: labels[idx]!,
                  }));
                  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
                  const areaPath = `M ${pts[0]!.x},148 L ${pts.map((p) => `${p.x},${p.y}`).join(" L ")} L ${pts[pts.length - 1]!.x},148 Z`;

                  return (
                    <div className="space-y-1">
                      <svg viewBox="0 0 520 180" className="w-full h-44" aria-label="Occupancy trend">
                        <defs>
                          <linearGradient id="opAreaGrad" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.24" />
                            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.02" />
                          </linearGradient>
                        </defs>
                        {[40, 75, 110, 145].map((y) => (
                          <line
                            key={y}
                            x1="36"
                            y1={y}
                            x2="500"
                            y2={y}
                            stroke="#E2E8F0"
                            strokeDasharray="3 3"
                          />
                        ))}
                        <path d={areaPath} fill="url(#opAreaGrad)" />
                        <polyline
                          fill="none"
                          stroke="#2563EB"
                          strokeWidth="3"
                          points={polyline}
                        />
                        {pts.map((p) => (
                          <g key={p.label}>
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r="4"
                              fill="#FFFFFF"
                              stroke="#2563EB"
                              strokeWidth="2.5"
                            />
                            <text x={p.x - 12} y="168" fontSize="10" fill="#64748B">
                              {p.label}
                            </text>
                          </g>
                        ))}
                      </svg>
                      {buckets.every((b) => b === 0) && (
                        <p className="text-[11px] text-slate-500 text-center">
                          No bookings recorded in the last 24 hours yet.
                        </p>
                      )}
                    </div>
                  );
                })()}
              </Card>

              <Card className="lg:col-span-4 p-5 bg-white border-slate-200/80 shadow-xs flex flex-col items-center justify-between text-center">
                <h2 className="text-sm font-extrabold text-slate-900">
                  Charger Energy Status
                </h2>
                <div className="relative flex items-center justify-center my-2">
                  <svg width="120" height="120" className="-rotate-90">
                    <circle
                      cx="60"
                      cy="60"
                      r={r}
                      fill="none"
                      stroke="#E2E8F0"
                      strokeWidth="12"
                    />
                    <circle
                      cx="60"
                      cy="60"
                      r={r}
                      fill="none"
                      stroke="#10B981"
                      strokeWidth="12"
                      strokeDasharray={circ}
                      strokeDashoffset={strokeOffset}
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="absolute text-xl font-extrabold text-slate-900">
                    {chargerPct}%
                  </span>
                </div>
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-emerald-600">Online</div>
                  <div className="text-base font-extrabold text-slate-900">
                    {onlineChargers} / {data.analytics.totalConnectors}
                  </div>
                </div>
              </Card>
            </div>

      {/* Facility Selector + Live Space/Connector Controls */}
      <Card className="p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="font-bold text-slate-900">Live Inventory &amp; Charger Controls</h2>
          <Select
            value={selectedFacId}
            onChange={(e) => setSelectedFacId(e.target.value)}
            className="sm:w-80"
          >
            {data.facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.status})
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Car className="h-3.5 w-3.5" /> Parking Bays
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
            {activeFacSpaces.map((sp) => (
              <div key={sp.id} className="rounded-xl border border-slate-200 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between font-bold">
                  <span>{sp.code}</span>
                  <StatusPill status={sp.status} />
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => toggleSpace(sp.facilityId, sp.id, "AVAILABLE")}
                    className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 cursor-pointer"
                  >
                    Free
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSpace(sp.facilityId, sp.id, "OCCUPIED")}
                    className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 cursor-pointer"
                  >
                    Occupy
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSpace(sp.facilityId, sp.id, "OUT_OF_SERVICE")}
                    className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-800 cursor-pointer"
                  >
                    Maint
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {activeFacConnectors.length > 0 && (
          <div className="space-y-2 border-t border-slate-200 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-600" /> EV Connectors
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activeFacConnectors.map((c) => (
                <div key={c.id} className="rounded-xl border border-slate-200 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">
                      #{c.connectorNumber} · {c.standard} ({c.maxPowerKw}kW)
                    </span>
                    <StatusPill status={c.status} />
                  </div>
                  {c.faultReason && <div className="text-red-700">{c.faultReason}</div>}
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleConnector(c.facilityId, c.id, "AVAILABLE")}
                    >
                      Set Available
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => toggleConnector(c.facilityId, c.id, "FAULTED")}
                    >
                      Report Fault
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Gate QR Validation + Reservations Management */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-5 p-5 space-y-4">
          <h2 className="font-bold text-slate-900 flex items-center gap-2">
            <QrCode className="h-4 w-4 text-emerald-600" />
            Gate QR Validator &amp; Check-In
          </h2>
          <form onSubmit={handleGateCheckIn} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Signed QR Payload Token
              </label>
              <Input
                value={qrInput}
                onChange={(e) => setQrInput(e.target.value)}
                placeholder="Paste signed base64url QR token..."
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Or Booking Reference
              </label>
              <Input
                value={refInput}
                onChange={(e) => setRefInput(e.target.value)}
                placeholder="SM-LDH-1001"
              />
            </div>
            <Button type="submit" variant="emerald" className="w-full" size="sm">
              Validate Server Signature &amp; Check In
            </Button>
          </form>
        </Card>

        <Card className="lg:col-span-7 p-5 space-y-3">
          <h2 className="font-bold text-slate-900">Facility Reservations</h2>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {data.reservations.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold">{r.bookingReference}</span>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="text-slate-600 mt-0.5">
                    {new Date(r.startTime).toLocaleString()} · {formatPaise(r.totalEstimatedPaise)}
                  </div>
                </div>
                {["CHECKED_IN", "ACTIVE"].includes(r.status) && (
                  <Button size="sm" variant="outline" onClick={() => handleCheckOut(r.id)}>
                    Check Out &amp; Reconcile
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Analytics Table + Facility Onboarding */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-slate-700" />
              Persisted Utilization &amp; Revenue Breakdown
            </h2>
            <Badge variant="neutral">{data.analytics.period}</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2">Facility</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Occupancy</th>
                  <th className="py-2">Bookings</th>
                  <th className="py-2 text-right">Captured Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.analytics.revenueByFacility.map((row) => (
                  <tr key={row.facilityId}>
                    <td className="py-2 font-semibold">{row.name}</td>
                    <td className="py-2">
                      <StatusPill status={row.status} />
                    </td>
                    <td className="py-2">{row.occupancyPct}%</td>
                    <td className="py-2">{row.bookingsCount}</td>
                    <td className="py-2 text-right font-bold">
                      {formatPaise(row.revenuePaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            Metric definitions: {data.analytics.definitions.occupancyPct} |{" "}
            {data.analytics.definitions.grossRevenuePaise}
          </p>
        </Card>

        <Card className="lg:col-span-5 p-5 space-y-4">
          <h2 className="font-bold text-slate-900 text-sm">Onboard New Parking / EV Facility</h2>
          <form onSubmit={handleCreateFacility} className="space-y-3">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Facility Name"
              required
            />
            <Input
              value={newAddr}
              onChange={(e) => setNewAddr(e.target.value)}
              placeholder="Street Address"
              required
            />
            <div className="grid grid-cols-3 gap-2">
              <Input
                value={newCity}
                onChange={(e) => setNewCity(e.target.value)}
                placeholder="City"
                required
              />
              <Input
                value={newState}
                onChange={(e) => setNewState(e.target.value)}
                placeholder="State"
                required
              />
              <Input
                value={newPostal}
                onChange={(e) => setNewPostal(e.target.value)}
                placeholder="Postal Code"
                required
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <Input
                type="number"
                step="any"
                value={newLat}
                onChange={(e) => setNewLat(e.target.value)}
                placeholder="Latitude"
                required
              />
              <Input
                type="number"
                step="any"
                value={newLng}
                onChange={(e) => setNewLng(e.target.value)}
                placeholder="Longitude"
                required
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.geolocation?.getCurrentPosition((pos) => {
                    setNewLat(pos.coords.latitude.toFixed(6));
                    setNewLng(pos.coords.longitude.toFixed(6));
                  });
                }}
              >
                Use GPS
              </Button>
            </div>
            <Input
              type="number"
              value={newHourlyInr}
              onChange={(e) => setNewHourlyInr(e.target.value)}
              placeholder="Hourly ₹"
              required
            />
            <Select value={newType} onChange={(e) => setNewType(e.target.value)}>
              <option value="MULTI_LEVEL_GARAGE">Multi-Level Garage</option>
              <option value="DEDICATED_EV_HUB">Dedicated EV Hub</option>
              <option value="SURFACE_LOT">Surface Lot</option>
              <option value="UNDERGROUND">Underground</option>
            </Select>
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={newEv}
                onChange={(e) => setNewEv(e.target.checked)}
              />
              Include 60kW CCS2 EV Charger Bank
            </label>
            <Button type="submit" size="sm" className="w-full">
              <Plus className="h-4 w-4" />
              Submit Facility for Admin Review
            </Button>
          </form>
        </Card>
      </div>
          </main>
        </div>
      </div>
    </div>
  );
}
