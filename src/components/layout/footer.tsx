import Link from "next/link";
import { Zap, ShieldCheck, CheckCircle2 } from "lucide-react";

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
              Smart Parking &amp; EV Charging Finder — real-time GPS nearby charger
              discovery, EV pump slot pre-orders, atomic bay holds, and verified
              EV station onboarding.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-900">
              Drivers
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li><Link href="/explore" className="hover:text-slate-900">Nearby Chargers Map</Link></li>
              <li><Link href="/dashboard" className="hover:text-slate-900">User Dashboard (Pre-Order EV)</Link></li>
              <li><Link href="/trip-planner" className="hover:text-slate-900">EV Trip Planner</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-900">
              EV Station Owners
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li><Link href="/ev-pumps" className="hover:text-slate-900">EV Pumps Dashboard</Link></li>
              <li><Link href="/register?role=EV_OPERATOR" className="hover:text-slate-900">Owner 3-Step Verification</Link></li>
              <li><Link href="/operator" className="hover:text-slate-900">Operator Hub</Link></li>
              <li><Link href="/login" className="hover:text-slate-900">Sign In</Link></li>
            </ul>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Verified EV Network Security
            </div>
            <p>
              All EV station owners undergo PAN/GSTIN verification, property ownership &amp;
              electricity load checks, and charger compliance validation.
            </p>
            <div className="flex items-center gap-1.5 pt-1 text-emerald-700 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Signed HMAC QR gate passes
            </div>
          </div>
        </div>
        <div className="mt-8 border-t border-slate-200 pt-6 text-xs text-slate-500 flex flex-col sm:flex-row justify-between gap-2">
          <span>© 2026 ParkSmart — Smart Parking &amp; EV Charging Finder.</span>
          <span>Live OpenStreetMap GPS · Transactional Bay Holds · Verified EV Owners</span>
        </div>
      </div>
    </footer>
  );
}
