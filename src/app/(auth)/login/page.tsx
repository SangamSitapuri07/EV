"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheck, KeyRound, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button, Card, Input, Badge } from "@/components/ui/primitives";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

const DEMO_ACCOUNTS = [
  {
    label: "Customer (EV Driver)",
    email: "customer@smartmobility.test",
    password: "Customer@123",
    redirect: "/dashboard",
    badge: "CUSTOMER",
  },
  {
    label: "Parking Operator",
    email: "parking.op@smartmobility.test",
    password: "Operator@123",
    redirect: "/operator",
    badge: "PARKING_OPERATOR",
  },
  {
    label: "EV Charging Operator",
    email: "ev.op@smartmobility.test",
    password: "EvOperator@123",
    redirect: "/ev-pumps",
    badge: "EV_OPERATOR",
  },
  {
    label: "Super Admin",
    email: "admin@smartmobility.test",
    password: "Admin@123",
    redirect: "/admin",
    badge: "SUPER_ADMIN",
  },
];

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  google_not_configured:
    "Google OAuth credentials are not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env (callback: /api/v1/auth/google/callback), or use email/password or demo accounts below.",
  oauth_cancelled: "Google sign-in was cancelled before completion.",
  oauth_state_invalid: "OAuth session state expired or failed CSRF check. Please try again.",
  oauth_failed: "Google sign-in could not be verified. Please try again.",
};

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [recoveryInfo, setRecoveryInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const errCode = params.get("error");
      if (errCode && OAUTH_ERROR_MESSAGES[errCode]) {
        setError(OAUTH_ERROR_MESSAGES[errCode]);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(values: LoginValues, redirectTo?: string) {
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
        redirectTo ||
        (role === "SUPER_ADMIN"
          ? "/admin"
          : role === "CUSTOMER"
            ? "/dashboard"
            : "/operator");
      router.push(target);
      router.refresh();
    } catch {
      setError("Network error while signing in");
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin(account: (typeof DEMO_ACCOUNTS)[number]) {
    setValue("email", account.email);
    setValue("password", account.password);
    await onSubmit(
      { email: account.email, password: account.password },
      account.redirect
    );
  }

  async function handleRequestRecovery() {
    const email = getValues("email");
    if (!email) {
      setError("Enter your email first to request a recovery token");
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
        json.data.sandboxResetToken
          ? `Sandbox reset token generated: ${json.data.sandboxResetToken}`
          : "If the email exists, recovery instructions have been issued."
      );
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-12">
        <Card className="p-6 sm:p-8 lg:col-span-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Sign in to VoltPark City</h1>
            <p className="mt-1 text-sm text-slate-600">
              HttpOnly JWT sessions with server-side RBAC enforcement.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {recoveryInfo && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 break-all">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {recoveryInfo}
            </div>
          )}

          <GoogleSignInButton redirectTo="/dashboard" label="Continue with Google" />

          <div className="relative flex items-center py-1">
            <div className="grow border-t border-slate-200" />
            <span className="mx-3 shrink text-xs font-medium uppercase tracking-wider text-slate-400">
              or sign in with email
            </span>
            <div className="grow border-t border-slate-200" />
          </div>

          <form onSubmit={handleSubmit((v) => onSubmit(v))} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-semibold text-slate-700">
                Email Address
              </label>
              <Input id="email" type="email" {...register("email")} placeholder="you@example.com" />
              {errors.email && (
                <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-semibold text-slate-700">
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
              Request recovery token
            </button>
            <Link href="/register" className="font-semibold text-emerald-700 hover:underline">
              Create new account →
            </Link>
          </div>
        </Card>

        <div className="lg:col-span-6 space-y-4">
          <Card className="p-6 space-y-4 bg-slate-900 text-white border-slate-800">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
              <ShieldCheck className="h-4 w-4" />
              Development &amp; Demo Test Accounts
            </div>
            <p className="text-xs text-slate-300">
              Click any role below to sign in with seeded sample credentials and test its
              server-enforced dashboard and workflows.
            </p>
            <div className="grid gap-3">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  disabled={loading}
                  onClick={() => handleDemoLogin(acc)}
                  className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/80 p-3.5 text-left transition hover:border-emerald-500 hover:bg-slate-800 cursor-pointer"
                >
                  <div>
                    <div className="text-sm font-semibold text-white">{acc.label}</div>
                    <div className="text-xs text-slate-400">{acc.email}</div>
                  </div>
                  <Badge className="bg-slate-700 text-emerald-300 border-slate-600">
                    {acc.badge}
                  </Badge>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
