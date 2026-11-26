"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  LayoutDashboard,
  Calendar,
  Car,
  Zap,
  CreditCard,
  Bell,
  LifeBuoy,
  Settings,
  LogOut,
  QrCode,
  Trash2,
  Plus,
  Play,
  Square,
  Clock,
  CheckCircle2,
  AlertCircle,
  BatteryCharging,
  MapPin,
  Star,
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
import { formatPaise, getFacilityPhoto } from "@/lib/utils";

interface EvPumpListing {
  stationId: string;
  stationName: string;
  ocppIdentity: string;
  networkProvider: string;
  isSimulated: boolean;
  facilityId: string;
  facilitySlug: string;
  facilityName: string;
  addressLine1: string;
  city: string;
  dataSourceType: string;
  is24Hours: boolean;
  freeCount: number;
  totalCount: number;
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
    isAvailableForWindow: boolean;
  }>;
}

interface CustomerOverview {
  user: { id: string; email: string; fullName: string; role: string };
  profile: {
    preferredCity: string;
    preferredConnector: string | null;
    locationConsentGranted: boolean;
  } | null;
  vehicles: Array<{
    id: string;
    nickname: string;
    registrationNumber: string;
    make: string;
    model: string;
    vehicleCategory: string;
    isElectric: boolean;
    supportedConnector: string | null;
    batteryCapacityKwh: number | null;
  }>;
  notifications: Array<{
    id: string;
    title: string;
    body: string;
    isRead: boolean;
    createdAt: string;
  }>;
  tickets: Array<{
    id: string;
    category: string;
    subject: string;
    status: string;
    resolutionNotes: string | null;
    createdAt: string;
  }>;
  reservations: Array<{
    id: string;
    bookingReference: string;
    facilityName: string;
    facilityAddress: string;
    reservationType: string;
    status: string;
    startTime: string;
    endTime: string;
    totalEstimatedPaise: number;
    finalAmountPaise: number | null;
    qrPayload: string | null;
  }>;
  payments: Array<{
    id: string;
    gatewayPaymentId: string;
    amountPaise: number;
    method: string;
    status: string;
    createdAt: string;
  }>;
  refunds: Array<{
    id: string;
    gatewayRefundId: string;
    amountPaise: number;
    reason: string;
    status: string;
    createdAt: string;
  }>;
  chargingSessions: Array<{
    id: string;
    status: string;
    isSimulated: boolean;
    externalSessionRef: string | null;
    targetKwh: number;
    energyDeliveredKwh: number;
    averagePowerKw: number;
    idleMinutes: number;
    totalCostPaise: number;
    startedAt: string;
    endedAt: string | null;
  }>;
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export default function CustomerDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<CustomerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "overview" | "preorder" | "bookings" | "charging" | "vehicles" | "payments" | "notifications" | "support"
  >("overview");
  const [qrPreview, setQrPreview] = useState<{ ref: string; url: string; raw: string } | null>(
    null
  );

  // EV Pump Pre-Order state
  const [pumps, setPumps] = useState<EvPumpListing[]>([]);
  const [pumpsLoading, setPumpsLoading] = useState(false);
  const [pumpQuery, setPumpQuery] = useState("");
  const [standardFilter, setStandardFilter] = useState("ALL");
  const [slotStartLocal, setSlotStartLocal] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 30 * 60_000))
  );
  const [slotDurationHours, setSlotDurationHours] = useState("2");
  const [targetKwh, setTargetKwh] = useState("25");
  const [promoCode, setPromoCode] = useState("");
  const [selectedGun, setSelectedGun] = useState<{
    pump: EvPumpListing;
    gun: EvPumpListing["connectors"][number];
  } | null>(null);
  const [preOrderEstimate, setPreOrderEstimate] = useState<{
    chargingEstimatePaise: number;
    parkingBasePaise: number;
    platformFeePaise: number;
    taxPaise: number;
    discountPaise: number;
    totalEstimatedPaise: number;
  } | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);

  // Vehicle & support forms
  const [vNick, setVNick] = useState("");
  const [vReg, setVReg] = useState("");
  const [vMake, setVMake] = useState("");
  const [vModel, setVModel] = useState("");
  const [vIsEv, setVIsEv] = useState(true);
  const [vConn, setVConn] = useState("CCS2");

  const [tCategory, setTCategory] = useState("DISPUTE");
  const [tSubject, setTSubject] = useState("");
  const [tDesc, setTDesc] = useState("");

  const loadOverview = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/v1/customer/overview");
      const json = await res.json();
      if (res.status === 401) {
        setError("Please sign in to access your User Dashboard and pre-order EV pump slots.");
        return;
      }
      if (!res.ok || !json.ok) {
        setError(json.error?.message || "Failed to load dashboard");
        return;
      }
      setData(json.data);
    } catch {
      setError("Network error loading dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEvPumps = useCallback(async () => {
    const start = new Date(slotStartLocal);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + Number(slotDurationHours) * 3600_000);
    setPumpsLoading(true);
    try {
      const params = new URLSearchParams({
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        standard: standardFilter,
      });
      if (pumpQuery.trim()) params.set("q", pumpQuery.trim());
      const res = await fetch(`/api/v1/ev-pumps?${params.toString()}`);
      const json = await res.json();
      if (json.ok) {
        setPumps(json.data.pumps ?? []);
      }
    } finally {
      setPumpsLoading(false);
    }
  }, [slotStartLocal, slotDurationHours, standardFilter, pumpQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadOverview();
      void loadEvPumps();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadOverview, loadEvPumps]);

  useEffect(() => {
    const es = new EventSource("/api/v1/events/stream");
    es.addEventListener("platform_event", () => {
      void loadEvPumps();
    });
    return () => es.close();
  }, [loadEvPumps]);

  useEffect(() => {
    if (!selectedGun) return;
    const start = new Date(slotStartLocal);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + Number(slotDurationHours) * 3600_000);

    const timer = setTimeout(() => {
      fetch("/api/v1/pricing/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facilityId: selectedGun.pump.facilityId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          connectorId: selectedGun.gun.id,
          estimatedKwh: Number(targetKwh) || 20,
          promoCode: promoCode.trim() || undefined,
        }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j.ok) setPreOrderEstimate(j.data);
        })
        .catch(() => {});
    }, 50);

    return () => clearTimeout(timer);
  }, [selectedGun, slotStartLocal, slotDurationHours, targetKwh, promoCode]);

  async function showQr(ref: string, raw: string) {
    const url = await QRCode.toDataURL(raw, { width: 220, margin: 1 });
    setQrPreview({ ref, url, raw });
  }

  async function handleConfirmPreOrder() {
    if (!selectedGun) return;
    setError(null);
    setMessage(null);
    setBookingBusy(true);

    const start = new Date(slotStartLocal);
    const end = new Date(start.getTime() + Number(slotDurationHours) * 3600_000);

    try {
      const holdRes = await fetch("/api/v1/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facilityId: selectedGun.pump.facilityId,
          connectorId: selectedGun.gun.id,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          estimatedKwh: Number(targetKwh) || 20,
          promoCode: promoCode.trim() || undefined,
        }),
      });
      const holdJson = await holdRes.json();
      if (!holdRes.ok || !holdJson.ok) {
        setError(holdJson.error?.message || "Could not lock EV pump slot");
        return;
      }

      const createdRes = holdJson.data.reservation;
      const orderRes = await fetch("/api/v1/payments/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `preorder-${createdRes.id}`,
        },
        body: JSON.stringify({ reservationId: createdRes.id }),
      });
      const orderJson = await orderRes.json();
      if (!orderRes.ok || !orderJson.ok) {
        setError(orderJson.error?.message || "Payment order failed");
        return;
      }

      const verifyRes = await fetch("/api/v1/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentOrderId: orderJson.data.order.id,
          simulateSandboxSuccess: true,
          method: "UPI_SANDBOX",
        }),
      });
      const verifyJson = await verifyRes.json();
      if (!verifyRes.ok || !verifyJson.ok) {
        setError(verifyJson.error?.message || "Pre-order confirmation failed");
        return;
      }

      setMessage(
        `EV Pump slot pre-ordered! Ref: ${createdRes.bookingReference} at ${selectedGun.pump.stationName}.`
      );
      if (verifyJson.data.qrPayload) {
        await showQr(createdRes.bookingReference, verifyJson.data.qrPayload);
      }
      setSelectedGun(null);
      setActiveTab("bookings");
      void loadOverview();
      void loadEvPumps();
    } catch {
      setError("Network error completing EV pump pre-order");
    } finally {
      setBookingBusy(false);
    }
  }

  async function handleCancelReservation(id: string) {
    const res = await fetch(`/api/v1/reservations/${id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Cancelled via customer dashboard" }),
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(json.data.refundPolicyNote || "Reservation cancelled.");
      void loadOverview();
      void loadEvPumps();
    } else {
      setError(json.error?.message || "Could not cancel");
    }
  }

  async function handleExtendReservation(id: string, currentEnd: string) {
    const nextEnd = new Date(new Date(currentEnd).getTime() + 60 * 60 * 1000).toISOString();
    const res = await fetch(`/api/v1/reservations/${id}/extend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newEndTime: nextEnd }),
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(`Pre-order extended by 1 hour (+${formatPaise(json.data.extraPaise)}).`);
      void loadOverview();
    } else {
      setError(json.error?.message || "Extension failed");
    }
  }

  async function handleTickCharging(sessionId: string) {
    const res = await fetch(`/api/v1/charging/sessions/${sessionId}/tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kwhIncrement: 4.5 }),
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(
        `Simulated telemetry updated: ${json.data.session.energyDeliveredKwh} kWh (${json.data.socPct}% SoC).`
      );
      void loadOverview();
    }
  }

  async function handleStopCharging(sessionId: string) {
    const res = await fetch(`/api/v1/charging/sessions/${sessionId}/stop`, {
      method: "POST",
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(
        `EV Charging completed: ${json.data.session.energyDeliveredKwh} kWh · Final ${formatPaise(json.data.session.totalCostPaise)}.`
      );
      void loadOverview();
    }
  }

  async function handleAddVehicle(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/v1/customer/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: vNick,
        registrationNumber: vReg,
        make: vMake,
        model: vModel,
        isElectric: vIsEv,
        supportedConnector: vIsEv ? vConn : null,
        vehicleCategory: vIsEv ? "EV_COMPATIBLE" : "STANDARD",
      }),
    });
    const json = await res.json();
    if (json.ok) {
      setVNick("");
      setVReg("");
      setVMake("");
      setVModel("");
      setMessage("Vehicle added to garage.");
      void loadOverview();
    } else {
      setError(json.error?.message || "Failed to add vehicle");
    }
  }

  async function handleDeleteVehicle(id: string) {
    await fetch(`/api/v1/customer/vehicles?id=${id}`, { method: "DELETE" });
    void loadOverview();
  }

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/v1/customer/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: tCategory,
        subject: tSubject,
        description: tDesc,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      setTSubject("");
      setTDesc("");
      setMessage("Support request submitted.");
      void loadOverview();
    } else {
      setError(json.error?.message || "Could not submit ticket");
    }
  }

  async function handleMarkNotificationsRead() {
    await fetch("/api/v1/customer/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_notifications_read" }),
    });
    void loadOverview();
  }

  async function handleLogout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center space-y-4">
        <Card className="p-8 space-y-4">
          <AlertCircle className="h-10 w-10 text-amber-600 mx-auto" />
          <h1 className="text-xl font-bold">User Dashboard — EV Pump Pre-Orders</h1>
          <p className="text-sm text-slate-600">{error}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/login">
              <Button>Sign in as Customer</Button>
            </Link>
            <Link href="/ev-pumps">
              <Button variant="outline">EV Pumps Operator Dashboard</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const activeCharging = data.chargingSessions.filter((s) => s.status === "ACTIVE");
  const upcomingReservations = data.reservations.filter((r) =>
    ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN", "ACTIVE"].includes(r.status)
  );
  const totalSpentPaise = data.payments
    .filter((p) => p.status === "CAPTURED")
    .reduce((sum, p) => sum + p.amountPaise, 0);
  const unreadCount = data.notifications.filter((n) => !n.isRead).length;
  const firstName = data.user.fullName.split(" ")[0] || data.user.fullName;

  const sidebarItems = [
    { id: "overview", label: "Dashboard", icon: LayoutDashboard },
    { id: "preorder", label: "EV Pumps & Pre-Order", icon: BatteryCharging },
    { id: "bookings", label: "My Bookings", icon: Calendar },
    { id: "charging", label: "EV Sessions", icon: Zap },
    { id: "vehicles", label: "My Vehicles", icon: Car },
    { id: "payments", label: "Payments", icon: CreditCard },
    { id: "notifications", label: `Notifications${unreadCount ? ` (${unreadCount})` : ""}`, icon: Bell },
    { id: "support", label: "Support", icon: LifeBuoy },
  ] as const;

  return (
    <div className="bg-[#F4F7FB] min-h-[calc(100vh-4rem)]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Screen 4 Two-Pane Layout: Dark Navy Sidebar + Crisp White Content Panel */}
        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* Dark Navy Sidebar (#0F2342) */}
          <aside className="lg:col-span-3 rounded-2xl bg-[#0F2342] text-white p-4 flex flex-col justify-between min-h-[560px] shadow-sm">
            <div className="space-y-1.5">
              {sidebarItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer ${
                      active
                        ? "bg-[#1D5CD6] text-white shadow-xs"
                        : "text-slate-300 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}

              {data.user.role !== "CUSTOMER" && (
                <Link
                  href="/ev-pumps"
                  className="mt-2 w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-white/10 transition"
                >
                  <Settings className="h-4 w-4 shrink-0" />
                  EV Pumps Operator Console
                </Link>
              )}
            </div>

            <div className="pt-6 border-t border-white/10">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition cursor-pointer"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                Logout
              </button>
            </div>
          </aside>

          {/* Main Content Area */}
          <main className="lg:col-span-9 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900">
                  Welcome back, {firstName}!
                </h1>
                <p className="text-xs text-slate-500">
                  Here&apos;s your parking &amp; EV pump pre-order overview
                </p>
              </div>
              <Button
                size="sm"
                variant="emerald"
                onClick={() => setActiveTab("preorder")}
              >
                <BatteryCharging className="h-4 w-4" />
                Pre-Order EV Pump Slot
              </Button>
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

            {/* 4 Pastel-Icon KPI Cards (Matches Screen 4 in Reference Picture) */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="p-4 bg-white border-slate-200/80 shadow-xs space-y-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Calendar className="h-4.5 w-4.5" />
                </div>
                <div className="text-xs text-slate-500">Upcoming</div>
                <div className="text-lg font-extrabold text-slate-900">
                  {upcomingReservations.length} Bookings
                </div>
              </Card>

              <Card className="p-4 bg-white border-slate-200/80 shadow-xs space-y-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <Car className="h-4.5 w-4.5" />
                </div>
                <div className="text-xs text-slate-500">Active Session</div>
                <div className="text-lg font-extrabold text-slate-900">
                  {activeCharging.length} Session{activeCharging.length === 1 ? "" : "s"}
                </div>
              </Card>

              <Card className="p-4 bg-white border-slate-200/80 shadow-xs space-y-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <CreditCard className="h-4.5 w-4.5" />
                </div>
                <div className="text-xs text-slate-500">Total Spent</div>
                <div className="text-lg font-extrabold text-slate-900">
                  {formatPaise(totalSpentPaise)}
                </div>
              </Card>

              <Card className="p-4 bg-white border-slate-200/80 shadow-xs space-y-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
                  <Star className="h-4.5 w-4.5 fill-amber-400" />
                </div>
                <div className="text-xs text-slate-500">EV Pumps Live</div>
                <div className="text-lg font-extrabold text-slate-900">
                  {pumps.length} Stations
                </div>
              </Card>
            </div>

            {/* QR Pass Modal / Card */}
            {qrPreview && (
              <Card className="p-5 border-emerald-500 bg-emerald-50/40 flex flex-col sm:flex-row items-center gap-5">
                <img
                  src={qrPreview.url}
                  alt="Reservation QR"
                  className="rounded-xl border border-slate-200 bg-white p-2"
                />
                <div className="space-y-2 flex-1">
                  <div className="text-sm font-bold text-slate-900">
                    Signed Pre-Order QR Pass — {qrPreview.ref}
                  </div>
                  <p className="text-xs text-slate-600">
                    Show this QR at the EV pump station. The EV pump operator validates its HMAC signature on check-in.
                  </p>
                  <div className="rounded bg-white p-2 text-[10px] font-mono break-all border border-slate-200">
                    {qrPreview.raw}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setQrPreview(null)}>
                    Close QR Pass
                  </Button>
                </div>
              </Card>
            )}

            {/* OVERVIEW TAB (matches Upcoming Bookings list + Quick EV Pump Pre-Order preview) */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                <Card className="p-5 bg-white border-slate-200/80 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-extrabold text-slate-900">
                      Upcoming Bookings &amp; Pre-Orders
                    </h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab("bookings")}
                      className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                    >
                      View All →
                    </button>
                  </div>

                  {data.reservations.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center space-y-2">
                      <p className="text-xs text-slate-600">
                        You don&apos;t have any bookings yet. Pre-order an EV pump slot or parking bay below!
                      </p>
                      <Button size="sm" variant="emerald" onClick={() => setActiveTab("preorder")}>
                        Browse EV Pumps &amp; Pre-Order
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {data.reservations.slice(0, 3).map((r) => (
                        <div
                          key={r.id}
                          className="rounded-xl border border-slate-200 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3">
                            <img
                              src={getFacilityPhoto(r.facilityName)}
                              alt={r.facilityName}
                              className="h-14 w-20 rounded-xl object-cover shrink-0"
                            />
                            <div>
                              <div className="font-bold text-sm text-slate-900">
                                {r.facilityName}
                              </div>
                              <div className="text-xs text-slate-500">
                                {new Date(r.startTime).toLocaleString()} →{" "}
                                {new Date(r.endTime).toLocaleTimeString()}
                              </div>
                              <div className="text-[11px] font-mono text-slate-400">
                                {r.bookingReference}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <StatusPill status={r.status} />
                              <div className="mt-1 text-sm font-extrabold text-slate-900">
                                {formatPaise(r.finalAmountPaise ?? r.totalEstimatedPaise)}
                              </div>
                            </div>
                            {r.qrPayload && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => showQr(r.bookingReference, r.qrPayload!)}
                              >
                                <QrCode className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {/* Quick EV Pumps Preview Strip */}
                <Card className="p-5 bg-white border-slate-200/80 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-extrabold text-slate-900">
                        Available EV Pumps for Pre-Order
                      </h2>
                      <p className="text-xs text-slate-500">
                        Pick a pump connector to pre-order your charging slot immediately
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("preorder")}
                      className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                    >
                      All EV Pumps →
                    </button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {pumps.slice(0, 2).map((pump) => (
                      <div
                        key={pump.stationId}
                        className="rounded-xl border border-slate-200 p-4 space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-bold text-sm text-slate-900">{pump.stationName}</div>
                          <Badge variant={pump.freeCount > 0 ? "success" : "danger"}>
                            {pump.freeCount}/{pump.totalCount} Free
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-500">
                          {pump.addressLine1}, {pump.city}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {pump.connectors.slice(0, 2).map((gun) => (
                            <Button
                              key={gun.id}
                              size="sm"
                              variant={gun.isAvailableForWindow ? "emerald" : "outline"}
                              disabled={!gun.isAvailableForWindow}
                              onClick={() => {
                                setSelectedGun({ pump, gun });
                                setActiveTab("preorder");
                              }}
                            >
                              Pre-Order #{gun.connectorNumber} ({gun.maxPowerKw}kW)
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* PRE-ORDER EV PUMPS TAB */}
            {activeTab === "preorder" && (
              <div className="space-y-5">
                <Card className="p-4 bg-white border-slate-200/80 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Pre-Order Start Time
                    </label>
                    <Input
                      type="datetime-local"
                      value={slotStartLocal}
                      onChange={(e) => setSlotStartLocal(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Slot Duration
                    </label>
                    <Select
                      value={slotDurationHours}
                      onChange={(e) => setSlotDurationHours(e.target.value)}
                    >
                      <option value="1">1 Hour</option>
                      <option value="2">2 Hours</option>
                      <option value="3">3 Hours</option>
                      <option value="4">4 Hours</option>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Connector Standard
                    </label>
                    <Select
                      value={standardFilter}
                      onChange={(e) => setStandardFilter(e.target.value)}
                    >
                      <option value="ALL">All Connectors</option>
                      <option value="CCS2">CCS2 (DC Fast)</option>
                      <option value="TYPE2_AC">Type 2 AC</option>
                      <option value="CHADEMO">CHAdeMO</option>
                      <option value="BHARAT_DC001">Bharat DC-001</option>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Search Hub / City
                    </label>
                    <Input
                      value={pumpQuery}
                      onChange={(e) => setPumpQuery(e.target.value)}
                      placeholder="Ferozepur Rd, CCS2..."
                    />
                  </div>
                  <Button onClick={() => void loadEvPumps()} variant="primary" className="w-full">
                    Check Availability
                  </Button>
                </Card>

                {selectedGun && (
                  <Card className="p-5 border-emerald-500 bg-emerald-50/40 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Badge variant="success">Pre-Order Summary</Badge>
                        <h3 className="mt-1 text-base font-bold text-slate-900">
                          {selectedGun.pump.stationName} — Gun #{selectedGun.gun.connectorNumber} (
                          {selectedGun.gun.standard}, {selectedGun.gun.maxPowerKw}kW)
                        </h3>
                        <p className="text-xs text-slate-600">
                          Slot: {new Date(slotStartLocal).toLocaleString()} ({slotDurationHours} hr)
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setSelectedGun(null)}>
                        Cancel selection
                      </Button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">
                          Target Energy (kWh)
                        </label>
                        <Input
                          type="number"
                          min={5}
                          max={120}
                          value={targetKwh}
                          onChange={(e) => setTargetKwh(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">
                          Promo Code (optional)
                        </label>
                        <Input
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value)}
                          placeholder="Enter promo code"
                        />
                      </div>
                      <div className="rounded-xl bg-white border border-slate-200 p-3 text-xs space-y-1">
                        {preOrderEstimate ? (
                          <>
                            <div className="flex justify-between">
                              <span>Energy + Session Fee:</span>
                              <span>{formatPaise(preOrderEstimate.chargingEstimatePaise)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Platform Fee + GST:</span>
                              <span>
                                {formatPaise(
                                  preOrderEstimate.platformFeePaise + preOrderEstimate.taxPaise
                                )}
                              </span>
                            </div>
                            {preOrderEstimate.discountPaise > 0 && (
                              <div className="flex justify-between text-emerald-700 font-semibold">
                                <span>Promo Discount:</span>
                                <span>-{formatPaise(preOrderEstimate.discountPaise)}</span>
                              </div>
                            )}
                            <div className="flex justify-between border-t border-slate-200 pt-1 font-bold text-sm text-slate-900">
                              <span>Pre-Order Total:</span>
                              <span>{formatPaise(preOrderEstimate.totalEstimatedPaise)}</span>
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-500">Calculating quote...</span>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        variant="emerald"
                        disabled={bookingBusy}
                        onClick={handleConfirmPreOrder}
                      >
                        {bookingBusy
                          ? "Locking Slot & Confirming..."
                          : "Confirm EV Pump Pre-Order"}
                      </Button>
                    </div>
                  </Card>
                )}

                {pumpsLoading ? (
                  <Skeleton className="h-48 w-full" />
                ) : pumps.length === 0 ? (
                  <Card className="p-8 text-center text-sm text-slate-600">
                    No EV pumps match your current filter.
                  </Card>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {pumps.map((pump) => (
                      <Card key={pump.stationId} className="p-5 bg-white space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-bold text-slate-900">{pump.stationName}</h3>
                              <Badge variant="info">{pump.networkProvider}</Badge>
                            </div>
                            <div className="text-xs text-slate-600 flex items-center gap-1 mt-0.5">
                              <MapPin className="h-3.5 w-3.5" />
                              {pump.addressLine1}, {pump.city}
                            </div>
                          </div>
                          <Badge variant={pump.freeCount > 0 ? "success" : "danger"}>
                            {pump.freeCount}/{pump.totalCount} Slots Free
                          </Badge>
                        </div>

                        <div className="space-y-2.5">
                          {pump.connectors.map((gun) => (
                            <div
                              key={gun.id}
                              className="rounded-xl border border-slate-200 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-900">
                                    Gun #{gun.connectorNumber} · {gun.standard}
                                  </span>
                                  <Badge variant="info">{gun.maxPowerKw} kW</Badge>
                                  <StatusPill
                                    status={gun.isAvailableForWindow ? "AVAILABLE" : gun.status}
                                  />
                                </div>
                                <div className="text-slate-600">
                                  {formatPaise(gun.pricePerKwhPaise)}/kWh · Session fee{" "}
                                  {formatPaise(gun.sessionFeePaise)}
                                </div>
                              </div>

                              <Button
                                size="sm"
                                variant={gun.isAvailableForWindow ? "emerald" : "outline"}
                                disabled={!gun.isAvailableForWindow}
                                onClick={() => setSelectedGun({ pump, gun })}
                              >
                                {gun.isAvailableForWindow ? "Pre-Order Slot" : "Unavailable"}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* BOOKINGS TAB */}
            {activeTab === "bookings" && (
              <div className="space-y-3">
                {data.reservations.length === 0 ? (
                  <Card className="p-8 text-center text-sm text-slate-600">
                    No bookings yet. Use &quot;EV Pumps &amp; Pre-Order&quot; to book a slot.
                  </Card>
                ) : (
                  data.reservations.map((r) => (
                    <Card
                      key={r.id}
                      className="p-4 bg-white flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900">
                            {r.bookingReference}
                          </span>
                          <StatusPill status={r.status} />
                          <Badge variant="neutral">{r.reservationType}</Badge>
                        </div>
                        <div className="font-bold text-slate-900">{r.facilityName}</div>
                        <div className="text-xs text-slate-600">
                          {new Date(r.startTime).toLocaleString()} →{" "}
                          {new Date(r.endTime).toLocaleString()}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-right mr-2">
                          <div className="text-base font-bold text-slate-900">
                            {formatPaise(r.finalAmountPaise ?? r.totalEstimatedPaise)}
                          </div>
                        </div>
                        {r.qrPayload && (
                          <Button
                            size="sm"
                            variant="emerald"
                            onClick={() => showQr(r.bookingReference, r.qrPayload!)}
                          >
                            <QrCode className="h-3.5 w-3.5" />
                            Show QR
                          </Button>
                        )}
                        {["CONFIRMED", "CHECKED_IN", "ACTIVE"].includes(r.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleExtendReservation(r.id, r.endTime)}
                          >
                            <Clock className="h-3.5 w-3.5" />
                            +1 Hr
                          </Button>
                        )}
                        {["PENDING_PAYMENT", "CONFIRMED"].includes(r.status) && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleCancelReservation(r.id)}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </Card>
                  ))
                )}
              </div>
            )}

            {/* CHARGING TAB */}
            {activeTab === "charging" && (
              <div className="space-y-4">
                {data.chargingSessions.length === 0 ? (
                  <Card className="p-8 text-center text-sm text-slate-600">
                    No charging sessions recorded yet.
                  </Card>
                ) : (
                  data.chargingSessions.map((s) => (
                    <Card
                      key={s.id}
                      className="p-4 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <StatusPill status={s.status} />
                          <span className="font-mono text-xs text-slate-500">
                            {s.externalSessionRef}
                          </span>
                        </div>
                        <div className="text-sm font-bold text-slate-900">
                          {s.energyDeliveredKwh} / {s.targetKwh} kWh · Avg {s.averagePowerKw} kW
                        </div>
                        <div className="text-xs text-slate-600">
                          Bill: <strong>{formatPaise(s.totalCostPaise)}</strong>
                        </div>
                      </div>
                      {s.status === "ACTIVE" && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTickCharging(s.id)}
                          >
                            <Play className="h-3.5 w-3.5 text-emerald-600" />
                            Refresh Telemetry
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleStopCharging(s.id)}
                          >
                            <Square className="h-3.5 w-3.5" />
                            Stop
                          </Button>
                        </div>
                      )}
                    </Card>
                  ))
                )}
              </div>
            )}

            {/* VEHICLES TAB */}
            {activeTab === "vehicles" && (
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7 space-y-3">
                  {data.vehicles.map((v) => (
                    <Card key={v.id} className="p-4 bg-white flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{v.nickname}</span>
                          <Badge variant={v.isElectric ? "warning" : "neutral"}>
                            {v.isElectric
                              ? `EV · ${v.supportedConnector ?? "CCS2"}`
                              : v.vehicleCategory}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">
                          {v.make} {v.model} ·{" "}
                          <span className="font-mono">{v.registrationNumber}</span>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteVehicle(v.id)}>
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </Card>
                  ))}
                </div>
                <Card className="lg:col-span-5 p-5 bg-white space-y-4">
                  <h3 className="font-bold text-slate-900 text-sm">Add Vehicle</h3>
                  <form onSubmit={handleAddVehicle} className="space-y-3">
                    <Input
                      value={vNick}
                      onChange={(e) => setVNick(e.target.value)}
                      placeholder="Nickname (e.g. City EV)"
                      required
                    />
                    <Input
                      value={vReg}
                      onChange={(e) => setVReg(e.target.value)}
                      placeholder="Plate Number"
                      required
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={vMake}
                        onChange={(e) => setVMake(e.target.value)}
                        placeholder="Make"
                        required
                      />
                      <Input
                        value={vModel}
                        onChange={(e) => setVModel(e.target.value)}
                        placeholder="Model"
                        required
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        checked={vIsEv}
                        onChange={(e) => setVIsEv(e.target.checked)}
                      />
                      Electric Vehicle (EV)
                    </label>
                    {vIsEv && (
                      <Select value={vConn} onChange={(e) => setVConn(e.target.value)}>
                        <option value="CCS2">CCS2 (DC Fast)</option>
                        <option value="TYPE2_AC">Type 2 AC</option>
                        <option value="CHADEMO">CHAdeMO</option>
                      </Select>
                    )}
                    <Button type="submit" className="w-full" size="sm">
                      <Plus className="h-4 w-4" />
                      Save Vehicle
                    </Button>
                  </form>
                </Card>
              </div>
            )}

            {/* PAYMENTS TAB */}
            {activeTab === "payments" && (
              <div className="grid gap-6 md:grid-cols-2">
                <Card className="p-5 bg-white space-y-3">
                  <h3 className="font-bold text-slate-900 text-sm">Payment Receipts</h3>
                  {data.payments.length === 0 ? (
                    <p className="text-xs text-slate-500">No payments recorded.</p>
                  ) : (
                    data.payments.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-lg border border-slate-200 p-3 text-xs flex justify-between"
                      >
                        <div>
                          <div className="font-mono font-semibold">{p.gatewayPaymentId}</div>
                          <div className="text-slate-500">{p.method}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{formatPaise(p.amountPaise)}</div>
                          <StatusPill status={p.status} />
                        </div>
                      </div>
                    ))
                  )}
                </Card>
                <Card className="p-5 bg-white space-y-3">
                  <h3 className="font-bold text-slate-900 text-sm">Refund Tracking</h3>
                  {data.refunds.length === 0 ? (
                    <p className="text-xs text-slate-500">No refunds issued.</p>
                  ) : (
                    data.refunds.map((rf) => (
                      <div
                        key={rf.id}
                        className="rounded-lg border border-slate-200 p-3 text-xs flex justify-between"
                      >
                        <div>
                          <div className="font-mono font-semibold">{rf.gatewayRefundId}</div>
                          <div className="text-slate-600">{rf.reason}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-emerald-700">
                            {formatPaise(rf.amountPaise)}
                          </div>
                          <StatusPill status={rf.status} />
                        </div>
                      </div>
                    ))
                  )}
                </Card>
              </div>
            )}

            {/* NOTIFICATIONS TAB */}
            {activeTab === "notifications" && (
              <Card className="p-5 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-sm">
                    Notifications ({unreadCount} unread)
                  </h3>
                  {unreadCount > 0 && (
                    <Button size="sm" variant="ghost" onClick={handleMarkNotificationsRead}>
                      Mark all read
                    </Button>
                  )}
                </div>
                {data.notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`rounded-xl border p-3 text-xs ${
                      n.isRead ? "border-slate-100 bg-slate-50" : "border-amber-200 bg-amber-50/50"
                    }`}
                  >
                    <div className="font-bold text-slate-900">{n.title}</div>
                    <div className="text-slate-600">{n.body}</div>
                  </div>
                ))}
              </Card>
            )}

            {/* SUPPORT TAB */}
            {activeTab === "support" && (
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7 space-y-3">
                  {data.tickets.map((t) => (
                    <Card key={t.id} className="p-4 bg-white space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-slate-900">{t.subject}</span>
                        <StatusPill status={t.status} />
                      </div>
                      <div className="text-xs text-slate-500">Category: {t.category}</div>
                      {t.resolutionNotes && (
                        <div className="rounded bg-emerald-50 p-2 text-xs text-emerald-900">
                          Resolution: {t.resolutionNotes}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
                <Card className="lg:col-span-5 p-5 bg-white space-y-4">
                  <h3 className="font-bold text-slate-900 text-sm">Submit Support Ticket</h3>
                  <form onSubmit={handleCreateTicket} className="space-y-3">
                    <Select value={tCategory} onChange={(e) => setTCategory(e.target.value)}>
                      <option value="DISPUTE">Billing / Overstay Dispute</option>
                      <option value="REFUND">Refund Inquiry</option>
                      <option value="CHARGER_FAULT">Charger Fault Report</option>
                      <option value="ACCESS">Gate Access Issue</option>
                    </Select>
                    <Input
                      value={tSubject}
                      onChange={(e) => setTSubject(e.target.value)}
                      placeholder="Subject"
                      required
                    />
                    <textarea
                      value={tDesc}
                      onChange={(e) => setTDesc(e.target.value)}
                      placeholder="Describe what happened..."
                      rows={4}
                      required
                      className="w-full rounded-lg border border-slate-300 p-3 text-sm"
                    />
                    <Button type="submit" size="sm" className="w-full">
                      Submit Ticket
                    </Button>
                  </form>
                </Card>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
