"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Zap,
  QrCode,
  Plus,
  CheckCircle2,
  AlertCircle,
  Radio,
  Clock,
  BatteryCharging,
  Power,
  Wrench,
  Building2,
  BarChart3,
  CreditCard,
  Activity,
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

interface EvPumpsDashboardData {
  facilities: Array<{ id: string; name: string; city: string; status: string }>;
  pumps: Array<{
    stationId: string;
    stationName: string;
    ocppIdentity: string;
    networkProvider: string;
    isSimulated: boolean;
    facilityId: string;
    facilityName: string;
    facilityCity: string;
    facilityStatus: string;
    connectors: Array<{
      id: string;
      connectorNumber: number;
      standard: string;
      currentType: string;
      maxPowerKw: number;
      status: string;
      faultReason: string | null;
      pricePerKwhPaise: number;
      sessionFeePaise: number;
    }>;
  }>;
  preOrders: Array<{
    id: string;
    bookingReference: string;
    facilityId: string;
    facilityName: string;
    connectorId: string | null;
    connectorLabel: string;
    customerName: string;
    customerEmail: string;
    status: string;
    reservationType: string;
    startTime: string;
    endTime: string;
    totalEstimatedPaise: number;
    finalAmountPaise: number | null;
  }>;
  chargingSessions: Array<{
    id: string;
    status: string;
    isSimulated: boolean;
    externalSessionRef: string | null;
    targetKwh: number;
    energyDeliveredKwh: number;
    averagePowerKw: number;
    totalCostPaise: number;
    startedAt: string;
  }>;
  metrics: {
    totalPumps: number;
    totalGuns: number;
    availableGuns: number;
    chargingGuns: number;
    faultedGuns: number;
    upcomingPreOrders: number;
    activeSessions: number;
    totalEnergyKwh: number;
    totalEvRevenuePaise: number;
  };
}

export default function EvPumpsDashboardPage() {
  const [data, setData] = useState<EvPumpsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [activeNav, setActiveNav] = useState<"overview" | "pumps" | "queue">("overview");
  const [ownerVerif, setOwnerVerif] = useState<{
    verificationStatus: string;
    ownerName: string;
    panNumber: string;
    gstinNumber: string | null;
    electricityConsumerNo: string;
    chargerSerialNumber: string;
  } | null>(null);

  const [orderFilter, setOrderFilter] = useState<"ALL" | "UPCOMING" | "ACTIVE" | "COMPLETED">(
    "ALL"
  );
  const [qrInput, setQrInput] = useState("");
  const [refInput, setRefInput] = useState("");

  const [targetFacId, setTargetFacId] = useState("");
  const [newStd, setNewStd] = useState("CCS2");
  const [newKw, setNewKw] = useState("120");
  const [newRateInr, setNewRateInr] = useState("18");

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [res, verifRes] = await Promise.all([
        fetch("/api/v1/ev-pumps/dashboard"),
        fetch("/api/v1/operator/verification"),
      ]);
      const json = await res.json();
      if (res.status === 401 || res.status === 403) {
        setError(
          "EV Pumps Owner access required. Sign in as a verified EV Owner to manage pumps & pre-orders."
        );
        return;
      }
      if (!res.ok || !json.ok) {
        setError(json.error?.message || "Failed to load EV Pumps dashboard");
        return;
      }
      const facilitiesList = Array.isArray(json.data?.facilities) ? json.data.facilities : [];
      setData({
        ...json.data,
        facilities: facilitiesList,
      });
      if (verifRes.ok) {
        const verifJson = await verifRes.json();
        if (verifJson.ok && verifJson.data?.verification) {
          setOwnerVerif(verifJson.data.verification);
        }
      }
      if (!targetFacId && facilitiesList.length > 0) {
        setTargetFacId(facilitiesList[0].id);
      }
    } catch {
      setError("Network error loading EV Pumps dashboard");
    } finally {
      setLoading(false);
    }
  }, [targetFacId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    const es = new EventSource("/api/v1/events/stream");
    es.addEventListener("connected", () => setLiveConnected(true));
    es.addEventListener("platform_event", () => {
      void loadData();
    });
    es.onerror = () => setLiveConnected(false);
    return () => es.close();
  }, [loadData]);

  async function updateGunStatus(
    facilityId: string,
    connectorId: string,
    status: "AVAILABLE" | "FAULTED" | "OFFLINE"
  ) {
    setError(null);
    const res = await fetch(`/api/v1/operator/facilities/${facilityId}/connectors`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectorId,
        status,
        faultReason: status === "FAULTED" ? "Marked faulted via EV Pumps Dashboard" : null,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(`Pump connector updated to ${status} and broadcast live.`);
      void loadData();
    } else {
      setError(json.error?.message || "Could not update connector");
    }
  }

  async function handleAddGun(e: React.FormEvent) {
    e.preventDefault();
    if (!targetFacId) return;
    setError(null);
    const res = await fetch(`/api/v1/operator/facilities/${targetFacId}/connectors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        standard: newStd,
        maxPowerKw: Number(newKw),
        pricePerKwhPaise: Math.round(Number(newRateInr) * 100),
      }),
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(`Added ${newKw}kW ${newStd} connector gun to pump station.`);
      void loadData();
    } else {
      setError(json.error?.message || "Failed to add connector gun");
    }
  }

  async function handleCheckIn(e: React.FormEvent) {
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
      setMessage(`Pre-order ${json.data.bookingReference} checked in at EV pump!`);
      setQrInput("");
      setRefInput("");
      void loadData();
    } else {
      setError(json.error?.message || "Check-in failed");
    }
  }

  async function handleCheckOut(reservationId: string) {
    setError(null);
    const res = await fetch(`/api/v1/reservations/${reservationId}/check-out`, {
      method: "POST",
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(
        `EV pre-order completed & reconciled: ${formatPaise(json.data.finalAmountPaise)}.`
      );
      void loadData();
    } else {
      setError(json.error?.message || "Could not complete pre-order");
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
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <Card className="p-8 space-y-4">
          <Zap className="h-10 w-10 text-amber-600 mx-auto" />
          <h1 className="text-xl font-bold text-slate-900">EV Pumps Operator Dashboard</h1>
          <p className="text-sm text-slate-600">{error}</p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Link href="/login">
              <Button variant="primary">Sign in as EV Operator</Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="outline">Go to User Dashboard (Pre-Order EV Pump)</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const onlineGuns = data.metrics.totalGuns - data.metrics.faultedGuns;
  const healthPct =
    data.metrics.totalGuns > 0
      ? Math.round((onlineGuns / data.metrics.totalGuns) * 100)
      : 100;
  const occupancyPct =
    data.metrics.totalGuns > 0
      ? Math.round(
          ((data.metrics.totalGuns - data.metrics.availableGuns) / data.metrics.totalGuns) * 100
        )
      : 0;

  const filteredOrders = data.preOrders.filter((o) => {
    if (orderFilter === "UPCOMING") return ["PENDING_PAYMENT", "CONFIRMED"].includes(o.status);
    if (orderFilter === "ACTIVE") return ["CHECKED_IN", "ACTIVE"].includes(o.status);
    if (orderFilter === "COMPLETED") return o.status === "COMPLETED";
    return true;
  });

  // Donut gauge geometry
  const r = 42;
  const circ = 2 * Math.PI * r;
  const strokeOffset = circ - (healthPct / 100) * circ;

  return (
    <div className="bg-[#F4F7FB] min-h-[calc(100vh-4rem)]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Screen 5 Two-Pane Layout: Dark Navy Sidebar + Analytics & Live Pump Controls */}
        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* Dark Navy Sidebar */}
          <aside className="lg:col-span-3 rounded-2xl bg-[#0F2342] text-white p-4 space-y-1.5 min-h-[580px] shadow-sm">
            {[
              { id: "overview", label: "Overview", icon: LayoutDashboard },
              { id: "pumps", label: "EV Pumps & Guns", icon: Zap },
              { id: "queue", label: "Pre-Order Queue", icon: Clock },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id as typeof activeNav)}
                  className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer ${
                    active
                      ? "bg-[#1D5CD6] text-white shadow-xs"
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              );
            })}

            <Link
              href="/operator"
              className="w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition"
            >
              <Building2 className="h-4 w-4 shrink-0" />
              All Facilities Hub
            </Link>
            <Link
              href="/dashboard"
              className="w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-white/10 transition"
            >
              <BatteryCharging className="h-4 w-4 shrink-0" />
              User Pre-Order View
            </Link>
          </aside>

          {/* Main Dashboard Area */}
          <main className="lg:col-span-9 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900">
                  EV Pumps Dashboard
                </h1>
                <p className="text-xs text-slate-500">
                  Manage your EV pumps, connector guns, and incoming slot pre-orders
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                  <Radio
                    className={`h-3.5 w-3.5 ${liveConnected ? "text-emerald-600" : "text-slate-400"}`}
                  />
                  {liveConnected ? "Live SSE" : "Connecting"}
                </span>
                <Badge variant="neutral">EV Operator</Badge>
              </div>
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

            {/* EV Owner Security Verification Status */}
            {ownerVerif ? (
              <Card className="p-4 bg-white border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">
                      EV Owner Verification: {ownerVerif.ownerName}
                    </span>
                    <StatusPill status={ownerVerif.verificationStatus} />
                  </div>
                  <div className="text-slate-600">
                    PAN: <span className="font-mono">{ownerVerif.panNumber}</span> · Electricity
                    Consumer No.: <span className="font-mono">{ownerVerif.electricityConsumerNo}</span>{" "}
                    · Charger Serial:{" "}
                    <span className="font-mono">{ownerVerif.chargerSerialNumber}</span>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-4 bg-amber-50/70 border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-amber-900">
                  <strong>Owner Verification Status:</strong> Complete Owner PAN/GSTIN, Location/Electricity Proof &amp; Charger Serial verification to activate new stations.
                </div>
                <Link href="/register?role=EV_OPERATOR">
                  <Button size="sm" variant="primary">
                    Submit Verification Docs
                  </Button>
                </Link>
              </Card>
            )}

            {/* 4 Clean KPI Cards (Matches Screen 5 in Reference Picture) */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="p-4 bg-white border-slate-200/80 shadow-xs space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <Zap className="h-3.5 w-3.5" />
                  </span>
                  Total Guns
                </div>
                <div className="text-2xl font-extrabold text-slate-900">
                  {data.metrics.totalGuns}
                </div>
              </Card>

              <Card className="p-4 bg-white border-slate-200/80 shadow-xs space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                    <Power className="h-3.5 w-3.5" />
                  </span>
                  Available
                </div>
                <div className="text-2xl font-extrabold text-slate-900">
                  {data.metrics.availableGuns}
                </div>
              </Card>

              <Card className="p-4 bg-white border-slate-200/80 shadow-xs space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                    <Activity className="h-3.5 w-3.5" />
                  </span>
                  Occupancy
                </div>
                <div className="text-2xl font-extrabold text-slate-900">{occupancyPct}%</div>
              </Card>

              <Card className="p-4 bg-white border-slate-200/80 shadow-xs space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                    <CreditCard className="h-3.5 w-3.5" />
                  </span>
                  EV Revenue
                </div>
                <div className="text-2xl font-extrabold text-slate-900">
                  {formatPaise(data.metrics.totalEvRevenuePaise)}
                </div>
              </Card>
            </div>

            {/* 2-Column Analytics Row: Real Data Occupancy Chart + Circular Donut Gauge */}
            {activeNav === "overview" && (
              <div className="grid gap-5 lg:grid-cols-12">
                <Card className="lg:col-span-8 p-5 bg-white border-slate-200/80 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-blue-600" />
                      Charger Activity (Last 24 Hours)
                    </h2>
                    <span className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                      Real DB Events
                    </span>
                  </div>

                  {(() => {
                    const buckets = [0, 0, 0, 0, 0, 0];
                    const labels = ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"];
                    const nowMs = Date.now();
                    for (const ord of data.preOrders) {
                      const t = new Date(ord.startTime).getTime();
                      if (Math.abs(nowMs - t) <= 24 * 3600_000) {
                        const hr = new Date(ord.startTime).getHours();
                        buckets[Math.min(5, Math.floor(hr / 4))]! += 1;
                      }
                    }
                    for (const ses of data.chargingSessions) {
                      const t = new Date(ses.startedAt).getTime();
                      if (nowMs - t <= 24 * 3600_000) {
                        const hr = new Date(ses.startedAt).getHours();
                        buckets[Math.min(5, Math.floor(hr / 4))]! += 1;
                      }
                    }
                    const maxBucket = Math.max(1, ...buckets);
                    const pts = buckets.map((val, idx) => ({
                      x: 45 + idx * 90,
                      y: Math.round(145 - (val / maxBucket) * 105),
                      val,
                      label: labels[idx]!,
                    }));
                    const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
                    const areaPath = `M ${pts[0]!.x},148 L ${pts.map((p) => `${p.x},${p.y}`).join(" L ")} L ${pts[pts.length - 1]!.x},148 Z`;

                    return (
                      <div className="space-y-1">
                        <svg viewBox="0 0 520 180" className="w-full h-44" aria-label="24 hour activity chart">
                          <defs>
                            <linearGradient id="evAreaGrad" x1="0" x2="0" y1="0" y2="1">
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
                          <path d={areaPath} fill="url(#evAreaGrad)" />
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
                            No charging sessions or pre-orders recorded in the last 24 hours yet.
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
                      {healthPct}%
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-emerald-600">Online</div>
                    <div className="text-base font-extrabold text-slate-900">
                      {onlineGuns} / {data.metrics.totalGuns}
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {/* EV Pumps & Live Connector Guns */}
            {(activeNav === "overview" || activeNav === "pumps") && (
              <div className="space-y-4">
                <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <Zap className="h-4.5 w-4.5 text-amber-600" />
                  EV Pumps &amp; Connector Gun Controls
                </h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  {data.pumps.map((pump) => (
                    <Card key={pump.stationId} className="p-5 bg-white space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-slate-900">{pump.stationName}</h3>
                            <Badge variant="info">{pump.networkProvider}</Badge>
                          </div>
                          <div className="text-xs text-slate-600">
                            {pump.facilityName} · {pump.facilityCity} ·{" "}
                            <span className="font-mono">{pump.ocppIdentity}</span>
                          </div>
                        </div>
                        <StatusPill status={pump.facilityStatus} />
                      </div>

                      <div className="space-y-2.5">
                        {pump.connectors.map((gun) => (
                          <div
                            key={gun.id}
                            className="rounded-xl border border-slate-200 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="space-y-0.5 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900">
                                  Gun #{gun.connectorNumber} · {gun.standard}
                                </span>
                                <Badge variant="info">{gun.maxPowerKw} kW</Badge>
                                <StatusPill status={gun.status} />
                              </div>
                              <div className="text-slate-600">
                                <strong>{formatPaise(gun.pricePerKwhPaise)}/kWh</strong> +{" "}
                                {formatPaise(gun.sessionFeePaise)} session fee
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                              <Button
                                size="sm"
                                variant="emerald"
                                onClick={() =>
                                  updateGunStatus(pump.facilityId, gun.id, "AVAILABLE")
                                }
                              >
                                <Power className="h-3.5 w-3.5" />
                                Available
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  updateGunStatus(pump.facilityId, gun.id, "OFFLINE")
                                }
                              >
                                Offline
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() =>
                                  updateGunStatus(pump.facilityId, gun.id, "FAULTED")
                                }
                              >
                                <Wrench className="h-3.5 w-3.5" />
                                Fault
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Incoming EV Pump Pre-Orders + Gate QR Check-In + Add Gun */}
            {(activeNav === "overview" || activeNav === "queue") && (
              <div className="grid gap-6 lg:grid-cols-12">
                <Card className="lg:col-span-8 p-5 bg-white space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-bold text-slate-900 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-emerald-700" />
                      EV Pump Pre-Order Slot Queue ({filteredOrders.length})
                    </h2>
                    <div className="flex gap-1.5">
                      {(["ALL", "UPCOMING", "ACTIVE", "COMPLETED"] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setOrderFilter(f)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                            orderFilter === f
                              ? "bg-[#0F2342] text-white"
                              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredOrders.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4">
                      No EV pump pre-orders match this filter yet.
                    </p>
                  ) : (
                    <div className="space-y-2.5 max-h-96 overflow-y-auto">
                      {filteredOrders.map((ord) => (
                        <div
                          key={ord.id}
                          className="rounded-xl border border-slate-200 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-bold text-slate-900">
                                {ord.bookingReference}
                              </span>
                              <StatusPill status={ord.status} />
                              <Badge variant="neutral">{ord.connectorLabel}</Badge>
                            </div>
                            <div className="font-semibold text-slate-900">
                              {ord.customerName} ({ord.customerEmail}) · {ord.facilityName}
                            </div>
                            <div className="text-slate-600">
                              Slot: {new Date(ord.startTime).toLocaleString()} →{" "}
                              {new Date(ord.endTime).toLocaleTimeString()}
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="font-bold text-slate-900">
                                {formatPaise(ord.finalAmountPaise ?? ord.totalEstimatedPaise)}
                              </div>
                            </div>
                            {["CHECKED_IN", "ACTIVE"].includes(ord.status) && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleCheckOut(ord.id)}
                              >
                                Complete &amp; Reconcile
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <div className="lg:col-span-4 space-y-5">
                  <Card className="p-5 bg-white space-y-4">
                    <h2 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                      <QrCode className="h-4 w-4 text-emerald-600" />
                      Validate Pre-Order QR at Pump
                    </h2>
                    <form onSubmit={handleCheckIn} className="space-y-3">
                      <Input
                        value={qrInput}
                        onChange={(e) => setQrInput(e.target.value)}
                        placeholder="Signed QR token..."
                      />
                      <Input
                        value={refInput}
                        onChange={(e) => setRefInput(e.target.value)}
                        placeholder="Or Booking Ref (e.g. SM-...)"
                      />
                      <Button type="submit" variant="emerald" size="sm" className="w-full">
                        Check In Pre-Order Slot
                      </Button>
                    </form>
                  </Card>

                  <Card className="p-5 bg-white space-y-4">
                    <h2 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                      <Plus className="h-4 w-4 text-amber-600" />
                      Add New EV Pump Gun
                    </h2>
                    {(data.facilities ?? []).length === 0 ? (
                      <div className="space-y-3 text-xs text-slate-600">
                        <p>
                          No EV pump facilities registered yet. Add your charging station hub first
                          before adding pump guns.
                        </p>
                        <Link href="/operator" className="block">
                          <Button type="button" size="sm" variant="outline" className="w-full">
                            Add EV Hub in Facilities Hub
                          </Button>
                        </Link>
                      </div>
                    ) : (
                      <form onSubmit={handleAddGun} className="space-y-3">
                        <Select
                          value={targetFacId}
                          onChange={(e) => setTargetFacId(e.target.value)}
                        >
                          {(data.facilities ?? []).map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </Select>
                        <Select value={newStd} onChange={(e) => setNewStd(e.target.value)}>
                          <option value="CCS2">CCS2 (DC Fast)</option>
                          <option value="TYPE2_AC">Type 2 AC</option>
                          <option value="CHADEMO">CHAdeMO</option>
                          <option value="BHARAT_DC001">Bharat DC-001</option>
                        </Select>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            type="number"
                            min={3}
                            max={360}
                            value={newKw}
                            onChange={(e) => setNewKw(e.target.value)}
                            placeholder="Power kW"
                            required
                          />
                          <Input
                            type="number"
                            min={5}
                            max={100}
                            value={newRateInr}
                            onChange={(e) => setNewRateInr(e.target.value)}
                            placeholder="₹ / kWh"
                            required
                          />
                        </div>
                        <Button type="submit" size="sm" className="w-full">
                          Add Pump Connector
                        </Button>
                      </form>
                    )}
                  </Card>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
