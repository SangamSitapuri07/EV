"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Car, X, Zap, ArrowRight } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";

const DISMISS_KEY = "parksmart_login_prompt_dismissed";

export function LoginRolePrompt() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (pathname === "/login" || pathname === "/register") {
      return;
    }
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(DISMISS_KEY) === "1") return;

    let active = true;
    fetch("/api/v1/auth/session")
      .then((r) => r.json())
      .then((res) => {
        if (!active) return;
        if (!res.ok || !res.data?.authenticated) {
          setVisible(true);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pathname]);

  function handleDismiss() {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-role-prompt-title"
    >
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-2xl space-y-6">
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
          aria-label="Close login prompt"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="space-y-1.5 pr-8">
          <div className="text-xs font-bold uppercase tracking-wider text-emerald-600">
            Welcome to ParkSmart
          </div>
          <h2 id="login-role-prompt-title" className="text-2xl font-extrabold text-slate-900">
            How would you like to sign in?
          </h2>
          <p className="text-xs text-slate-600">
            Choose Customer or EV Owner to continue directly with Google.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Customer Card */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                <Car className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Login as Customer</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Locate nearby EV charging points on the live map and pre-order your charging slot instantly.
              </p>
            </div>

            <div className="space-y-2.5">
              <GoogleSignInButton
                role="CUSTOMER"
                redirectTo="/dashboard"
                label="Continue with Google"
              />
              <Link
                href="/login?role=customer"
                onClick={handleDismiss}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
              >
                More Sign-In Options
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* EV Owner Card */}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <Zap className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Login as EV Owner</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Sign in directly with Google to manage your EV charging pumps, connectors, and pre-orders.
              </p>
            </div>

            <div className="space-y-2.5">
              <GoogleSignInButton
                role="EV_OPERATOR"
                redirectTo="/ev-pumps"
                label="Continue with Google"
              />
              <Link
                href="/login?role=ev_owner"
                onClick={handleDismiss}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-600 bg-white py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition"
              >
                More Sign-In Options
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>

        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={handleDismiss}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 underline cursor-pointer"
          >
            Continue browsing nearby EV chargers first
          </button>
        </div>
      </div>
    </div>
  );
}
