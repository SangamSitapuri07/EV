"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Building2,
  FileText,
  Sliders,
  LifeBuoy,
  CheckCircle2,
  AlertCircle,
  Activity,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Input,
  Skeleton,
  StatusPill,
} from "@/components/ui/primitives";
import { formatPaise } from "@/lib/utils";

interface AdminDashboardData {
  metrics: {
    totalUsers: number;
    totalOperators: number;
    pendingFacilityApprovals: number;
    activeFacilities: number;
    totalReservations: number;
    totalCapturedPaise: number;
    totalRefundedPaise: number;
    openDisputes: number;
  };
  systemHealth: {
    databaseMode: string;
    postgisEnabled: boolean;
    paymentGatewayMode: string;
    status: string;
    checkedAt: string;
  };
  facilities: Array<{
    id: string;
    name: string;
    city: string;
    facilityType: string;
    status: string;
    hasEvCharging: boolean;
    totalCapacity: number;
    availabilityUpdatedAt: string;
  }>;
  operators: Array<{
    id: string;
    businessName: string;
    operatorType: string;
    status: string;
    gstNumber: string | null;
  }>;
  settings: Array<{
    key: string;
    value: {
      platformFeeBps?: number;
      defaultTaxBps?: number;
      holdTtlSeconds?: number;
    };
  }>;
  tickets: Array<{
    id: string;
    category: string;
    subject: string;
    description: string;
    status: string;
    resolutionNotes: string | null;
    createdAt: string;
  }>;
  auditLogs: Array<{
    id: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: string;
  }>;
  freshnessReport: Array<{
    facilityId: string;
    name: string;
    ageMinutes: number;
    isStale: boolean;
  }>;
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [platformFeeBps, setPlatformFeeBps] = useState("500");
  const [defaultTaxBps, setDefaultTaxBps] = useState("1800");
  const [holdTtlSeconds, setHoldTtlSeconds] = useState("600");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/overview");
      const json = await res.json();
      if (res.status === 401 || res.status === 403) {
        setError("Super Administrator authentication required.");
        return;
      }
      if (!res.ok || !json.ok) {
        setError(json.error?.message || "Failed to load admin overview");
        return;
      }
      setData(json.data);
      const pricingPolicy = json.data.settings?.find(
        (s: { key: string }) => s.key === "pricing_policy"
      )?.value;
      if (pricingPolicy) {
        setPlatformFeeBps(String(pricingPolicy.platformFeeBps ?? 500));
        setDefaultTaxBps(String(pricingPolicy.defaultTaxBps ?? 1800));
        setHoldTtlSeconds(String(pricingPolicy.holdTtlSeconds ?? 600));
      }
    } catch {
      setError("Network error loading admin panel");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  async function handleFacilityStatus(
    facilityId: string,
    decision: "ACTIVE" | "SUSPENDED" | "REJECTED"
  ) {
    const res = await fetch(`/api/v1/admin/facilities/${facilityId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason: `Admin updated status to ${decision}` }),
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(`Facility status changed to ${decision} and audited.`);
      loadData();
    } else {
      setError(json.error?.message || "Status update failed");
    }
  }

  async function handleSavePolicies(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/v1/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platformFeeBps: Number(platformFeeBps),
        defaultTaxBps: Number(defaultTaxBps),
        holdTtlSeconds: Number(holdTtlSeconds),
      }),
    });
    const json = await res.json();
    if (json.ok) {
      setMessage("Platform fee, GST & hold TTL policies saved and audited.");
      loadData();
    } else {
      setError(json.error?.message || "Failed to update policies");
    }
  }

  async function handleResolveTicket(ticketId: string, status: "RESOLVED" | "CLOSED") {
    const res = await fetch(`/api/v1/admin/tickets/${ticketId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        resolutionNotes: "Reviewed and resolved by Super Admin operations team.",
      }),
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(`Ticket ${status.toLowerCase()} and audited.`);
      loadData();
    } else {
      setError(json.error?.message || "Failed to resolve ticket");
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
            <Button>Sign in as Super Admin</Button>
          </Link>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-700" />
            Super Administrator Governance Console
          </h1>
          <p className="text-xs text-slate-600">
            DB: <strong>{data.systemHealth.databaseMode}</strong> · Gateway:{" "}
            <strong>{data.systemHealth.paymentGatewayMode}</strong> · PostGIS:{" "}
            <strong>{data.systemHealth.postgisEnabled ? "Enabled" : "Haversine Fallback"}</strong>
          </p>
        </div>
        <Link href="/api/v1/health" target="_blank">
          <Button variant="outline" size="sm">
            <Activity className="h-4 w-4 text-emerald-600" />
            Inspect /api/v1/health
          </Button>
        </Link>
      </div>

      {message && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {message}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="p-4">
          <div className="text-xs text-slate-500">Active Facilities</div>
          <div className="mt-1 text-2xl font-bold">{data.metrics.activeFacilities}</div>
          <div className="text-[11px] text-slate-500">
            {data.metrics.totalUsers} users · {data.metrics.totalOperators} operators
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">Pending Approvals</div>
          <div className="mt-1 text-2xl font-bold text-amber-600">
            {data.metrics.pendingFacilityApprovals}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">Tracked Bookings</div>
          <div className="mt-1 text-2xl font-bold">{data.metrics.totalReservations}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">Open Disputes</div>
          <div className="mt-1 text-2xl font-bold text-red-600">{data.metrics.openDisputes}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">Platform Gross / Refunds</div>
          <div className="mt-1 text-lg font-bold text-emerald-700">
            {formatPaise(data.metrics.totalCapturedPaise)}
          </div>
          <div className="text-[11px] text-slate-500">
            Refunded: {formatPaise(data.metrics.totalRefundedPaise)}
          </div>
        </Card>
      </div>

      {/* Facility Approval & Freshness Table */}
      <Card className="p-5 space-y-4">
        <h2 className="font-bold text-slate-900 flex items-center gap-2">
          <Building2 className="h-4 w-4" /> Facility Governance &amp; Availability Freshness
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">Facility</th>
                <th className="py-2">City</th>
                <th className="py-2">Status</th>
                <th className="py-2">Freshness</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.facilities.map((f) => {
                const fresh = data.freshnessReport.find((r) => r.facilityId === f.id);
                return (
                  <tr key={f.id}>
                    <td className="py-2.5 font-semibold">{f.name}</td>
                    <td className="py-2.5">{f.city}</td>
                    <td className="py-2.5">
                      <StatusPill status={f.status} />
                    </td>
                    <td className="py-2.5 text-slate-600">
                      {fresh ? `${fresh.ageMinutes}m ago` : "Live"}{" "}
                      {fresh?.isStale && <Badge variant="warning">Stale</Badge>}
                    </td>
                    <td className="py-2.5 text-right space-x-1.5">
                      {f.status !== "ACTIVE" && (
                        <Button
                          size="sm"
                          variant="emerald"
                          onClick={() => handleFacilityStatus(f.id, "ACTIVE")}
                        >
                          Approve
                        </Button>
                      )}
                      {f.status === "ACTIVE" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleFacilityStatus(f.id, "SUSPENDED")}
                        >
                          Suspend
                        </Button>
                      )}
                      {f.status === "PENDING_APPROVAL" && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleFacilityStatus(f.id, "REJECTED")}
                        >
                          Reject
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Policy Settings + Support Tickets */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-5 p-5 space-y-4">
          <h2 className="font-bold text-slate-900 flex items-center gap-2 text-sm">
            <Sliders className="h-4 w-4" /> Platform Fee, Tax &amp; Hold Policy
          </h2>
          <form onSubmit={handleSavePolicies} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Platform Fee (basis points, 500 = 5%)
              </label>
              <Input
                type="number"
                value={platformFeeBps}
                onChange={(e) => setPlatformFeeBps(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Default GST (basis points, 1800 = 18%)
              </label>
              <Input
                type="number"
                value={defaultTaxBps}
                onChange={(e) => setDefaultTaxBps(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Checkout Hold TTL (seconds, e.g. 600 = 10 min)
              </label>
              <Input
                type="number"
                value={holdTtlSeconds}
                onChange={(e) => setHoldTtlSeconds(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm" className="w-full">
              Save System Policies
            </Button>
          </form>
        </Card>

        <Card className="lg:col-span-7 p-5 space-y-3">
          <h2 className="font-bold text-slate-900 flex items-center gap-2 text-sm">
            <LifeBuoy className="h-4 w-4 text-amber-600" /> Support Tickets &amp; Dispute Queue
          </h2>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {data.tickets.map((t) => (
              <div key={t.id} className="rounded-lg border border-slate-200 p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">{t.subject}</span>
                  <StatusPill status={t.status} />
                </div>
                <p className="text-slate-600">{t.description}</p>
                {t.status !== "RESOLVED" && (
                  <div className="pt-1 flex gap-2">
                    <Button
                      size="sm"
                      variant="emerald"
                      onClick={() => handleResolveTicket(t.id, "RESOLVED")}
                    >
                      Mark Resolved
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Immutable Audit Log */}
      <Card className="p-5 space-y-3">
        <h2 className="font-bold text-slate-900 flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4" /> Immutable Audit Log (Latest Events)
        </h2>
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 text-xs">
          {data.auditLogs.map((log) => (
            <div key={log.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="neutral">{log.actorRole}</Badge>
                <span className="font-mono font-bold text-slate-900">{log.action}</span>
                <span className="text-slate-600">
                  on {log.entityType} ({log.entityId.slice(0, 8)}…)
                </span>
              </div>
              <span className="text-slate-500">{new Date(log.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
