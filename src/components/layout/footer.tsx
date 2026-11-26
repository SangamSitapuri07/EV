import Link from "next/link";
import { Zap, ShieldCheck, Info } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-bold text-[#0F2942]">
              <Zap className="h-5 w-5 text-emerald-600" />
              <span>ParkSmart</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Smart Parking &amp; EV Charging Finder — real-time parking discovery,
              EV pump slot pre-orders, atomic bay holds, sandbox payment verification,
              and live availability streaming.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-900">
              Drivers
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li><Link href="/explore" className="hover:text-slate-900">Explore Map</Link></li>
              <li><Link href="/dashboard" className="hover:text-slate-900">User Dashboard (Pre-Order EV)</Link></li>
              <li><Link href="/trip-planner" className="hover:text-slate-900">EV Trip &amp; Heatmap</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-900">
              Partners &amp; EV Pumps
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li><Link href="/ev-pumps" className="hover:text-slate-900">EV Pumps Dashboard</Link></li>
              <li><Link href="/operator" className="hover:text-slate-900">Operator Hub</Link></li>
              <li><Link href="/admin" className="hover:text-slate-900">Super Admin Console</Link></li>
              <li><Link href="/login" className="hover:text-slate-900">Demo Role Accounts</Link></li>
            </ul>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              <Info className="h-4 w-4 text-amber-600" />
              Data &amp; Sandbox Disclosure
            </div>
            <p>
              Sample facilities in Ludhiana use operator-managed &amp; simulated OCPP telemetry.
              Payments run in sandbox test mode with server-side HMAC verification.
            </p>
            <div className="flex items-center gap-1.5 pt-1 text-emerald-700 font-medium">
              <ShieldCheck className="h-3.5 w-3.5" />
              Zero card numbers stored
            </div>
          </div>
        </div>
        <div className="mt-8 border-t border-slate-200 pt-6 text-xs text-slate-500 flex flex-col sm:flex-row justify-between gap-2">
          <span>© 2026 Smart Parking &amp; EV Charging Finder. Production-oriented modular platform.</span>
          <span>API v1 · PostgreSQL Transactional Inventory · SSE Live Stream</span>
        </div>
      </div>
    </footer>
  );
}
