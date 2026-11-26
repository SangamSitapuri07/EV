"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ShieldCheck,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  Car,
  Zap,
  FileCheck2,
  Building2,
} from "lucide-react";
import { Button, Card, Input } from "@/components/ui/primitives";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  google_not_configured:
    "Google OAuth credentials are not configured on this server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, or sign in with email and password.",
  oauth_cancelled: "Google sign-in was cancelled before completion.",
  oauth_state_invalid: "OAuth session state expired or failed CSRF check. Please try again.",
  oauth_failed: "Google sign-in could not be verified. Please try again.",
};

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("role") === "ev_owner" ? "ev_owner" : "customer";

  const [loginMode, setLoginMode] = useState<"customer" | "ev_owner">(initialMode);
  const urlErrCode = searchParams.get("error");
  const [error, setError] = useState<string | null>(() =>
    urlErrCode && OAUTH_ERROR_MESSAGES[urlErrCode] ? OAUTH_ERROR_MESSAGES[urlErrCode] : null
  );
  const [recoveryInfo, setRecoveryInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(values: LoginValues) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error?.message || "Invalid credentials");
        return;
      }
      const role = json.data.user.role;
      const target =
        role === "SUPER_ADMIN"
          ? "/admin"
          : role === "CUSTOMER"
            ? "/dashboard"
            : role === "EV_OPERATOR"
              ? "/ev-pumps"
              : "/operator";
      router.push(target);
      router.refresh();
    } catch {
      setError("Network error while signing in");
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestRecovery() {
    const email = getValues("email");
    if (!email) {
      setError("Enter your email first to request password recovery");
      return;
    }
    const res = await fetch("/api/v1/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "request", email }),
    });
    const json = await res.json();
    if (json.ok) {
      setRecoveryInfo(
        "If an account exists for this email, recovery instructions have been issued."
      );
    }
  }

  return (
    <div className="bg-[#F4F7FB] min-h-[calc(100vh-4rem)] py-12">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 space-y-6">
        {/* Role Selector Tabs: Customer vs EV Owner */}
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setLoginMode("customer");
              setError(null);
            }}
            className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition cursor-pointer ${
              loginMode === "customer"
                ? "border-blue-600 bg-white ring-2 ring-blue-500/20 shadow-sm"
                : "border-slate-200 bg-white/70 hover:bg-white"
            }`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 shrink-0">
              <Car className="h-5 w-5" />
            </span>
            <div>
              <div className="font-bold text-sm text-slate-900">Sign in as Customer</div>
              <div className="text-xs text-slate-500">
                Direct Google Sign-In or Email to book EV slots
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setLoginMode("ev_owner");
              setError(null);
            }}
            className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition cursor-pointer ${
              loginMode === "ev_owner"
                ? "border-emerald-600 bg-white ring-2 ring-emerald-500/20 shadow-sm"
                : "border-slate-200 bg-white/70 hover:bg-white"
            }`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 shrink-0">
              <Zap className="h-5 w-5" />
            </span>
            <div>
              <div className="font-bold text-sm text-slate-900">Sign in as EV Pump Owner</div>
              <div className="text-xs text-slate-500">
                Verified EV station owners (PAN, Location &amp; Charger verified)
              </div>
            </div>
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* Login Form */}
          <Card className="p-6 sm:p-8 lg:col-span-7 bg-white space-y-5">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900">
                {loginMode === "customer"
                  ? "Customer Sign In"
                  : "EV Pump Owner Sign In"}
              </h1>
              <p className="mt-1 text-xs text-slate-600">
                {loginMode === "customer"
                  ? "Continue directly with Google or sign in with your registered email."
                  : "Sign in with your verified EV Owner account to manage charging pumps & pre-orders."}
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {recoveryInfo && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {recoveryInfo}
              </div>
            )}

            {loginMode === "customer" && (
              <>
                <GoogleSignInButton redirectTo="/dashboard" label="Continue with Google" />
                <div className="relative flex items-center py-1">
                  <div className="grow border-t border-slate-200" />
                  <span className="mx-3 shrink text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    or sign in with email
                  </span>
                  <div className="grow border-t border-slate-200" />
                </div>
              </>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-xs font-semibold text-slate-700">
                  Email Address
                </label>
                <Input
                  id="email"
                  type="email"
                  {...register("email")}
                  placeholder="you@example.com"
                />
                {errors.email && (
                  <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1 block text-xs font-semibold text-slate-700"
                >
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  {...register("password")}
                  placeholder="••••••••"
                />
                {errors.password && (
                  <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
                )}
              </div>

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            <div className="flex items-center justify-between border-t border-slate-200 pt-4 text-xs">
              <button
                type="button"
                onClick={handleRequestRecovery}
                className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Forgot password?
              </button>
              <Link
                href={
                  loginMode === "ev_owner"
                    ? "/register?role=EV_OPERATOR"
                    : "/register?role=CUSTOMER"
                }
                className="font-semibold text-emerald-700 hover:underline"
              >
                {loginMode === "ev_owner"
                  ? "Register & Verify as EV Owner →"
                  : "Create Customer Account →"}
              </Link>
            </div>
          </Card>

          {/* Right Info Panel */}
          <Card className="lg:col-span-5 p-6 bg-[#0F2342] text-white space-y-5">
            {loginMode === "customer" ? (
              <>
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                  <Car className="h-4 w-4" />
                  Customer Access
                </div>
                <h2 className="text-lg font-bold">Fast Google Sign-In for Drivers</h2>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Drivers can sign in with Google in one click, allow GPS location to see live EV charging points nearby, and pre-order charging slots with instant QR gate passes.
                </p>
              </>
            ) : (
              <>
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                  <ShieldCheck className="h-4 w-4" />
                  EV Owner Security Protocol
                </div>
                <h2 className="text-lg font-bold">Mandatory 3-Step Verification</h2>
                <p className="text-xs text-slate-300 leading-relaxed">
                  To protect drivers and ensure compliant EV infrastructure, every EV Pump Owner must verify:
                </p>
                <div className="space-y-3 text-xs">
                  <div className="rounded-xl bg-white/10 p-3 space-y-1">
                    <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5" />
                      1. Owner Verification
                    </div>
                    <p className="text-slate-300">
                      Owner Name, PAN, GSTIN, and business registration documents.
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/10 p-3 space-y-1">
                    <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                      <FileCheck2 className="h-3.5 w-3.5" />
                      2. Location &amp; Ownership Proof
                    </div>
                    <p className="text-slate-300">
                      Property ownership / lease agreement / authorization, NOC, and electricity connection details.
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/10 p-3 space-y-1">
                    <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5" />
                      3. Charger Verification
                    </div>
                    <p className="text-slate-300">
                      Charger manufacturer, model, serial number, connector type, and compliance certificates.
                    </p>
                  </div>
                </div>
                <Link
                  href="/register?role=EV_OPERATOR"
                  className="block text-center rounded-xl bg-emerald-500 hover:bg-emerald-600 py-2.5 text-xs font-bold text-white transition"
                >
                  Start 3-Step EV Owner Registration
                </Link>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm">Loading sign in...</div>}>
      <LoginContent />
    </Suspense>
  );
}
