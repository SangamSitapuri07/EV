"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, UserPlus } from "lucide-react";
import { Button, Card, Input, Select } from "@/components/ui/primitives";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";

const registerSchema = z.object({
  fullName: z.string().min(2, "Full name required"),
  email: z.string().email("Valid email required"),
  phone: z.string().optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["CUSTOMER", "PARKING_OPERATOR", "EV_OPERATOR"]),
  businessName: z.string().optional(),
});

type RegisterValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { role: "CUSTOMER" },
  });

  const selectedRole = watch("role");

  async function onSubmit(values: RegisterValues) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error?.message || "Registration failed");
        return;
      }
      router.push(values.role === "CUSTOMER" ? "/dashboard" : "/operator");
      router.refresh();
    } catch {
      setError("Network error while creating account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:px-6">
      <Card className="p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-emerald-400">
            <UserPlus className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Create your account</h1>
            <p className="text-xs text-slate-600">
              Join as an EV/Parking Driver or register an Operator organization.
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <GoogleSignInButton redirectTo="/dashboard" label="Sign up with Google" />

        <div className="relative flex items-center py-1">
          <div className="grow border-t border-slate-200" />
          <span className="mx-3 shrink text-xs font-medium uppercase tracking-wider text-slate-400">
            or register with email
          </span>
          <div className="grow border-t border-slate-200" />
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label htmlFor="role" className="mb-1 block text-xs font-semibold text-slate-700">
              Account Role
            </label>
            <Select id="role" {...register("role")}>
              <option value="CUSTOMER">Customer (Driver)</option>
              <option value="PARKING_OPERATOR">Parking Facility Operator</option>
              <option value="EV_OPERATOR">EV Charging Network Operator</option>
            </Select>
          </div>

          <div>
            <label htmlFor="fullName" className="mb-1 block text-xs font-semibold text-slate-700">
              Full Name
            </label>
            <Input id="fullName" {...register("fullName")} placeholder="Gurpreet Singh" />
            {errors.fullName && (
              <p className="mt-1 text-xs text-red-600">{errors.fullName.message}</p>
            )}
          </div>

          {(selectedRole === "PARKING_OPERATOR" || selectedRole === "EV_OPERATOR") && (
            <div>
              <label htmlFor="businessName" className="mb-1 block text-xs font-semibold text-slate-700">
                Organization / Business Name
              </label>
              <Input
                id="businessName"
                {...register("businessName")}
                placeholder="Punjab Smart Mobility Hubs Pvt Ltd"
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-semibold text-slate-700">
              Email
            </label>
            <Input id="email" type="email" {...register("email")} placeholder="driver@example.com" />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="phone" className="mb-1 block text-xs font-semibold text-slate-700">
              Phone (optional)
            </label>
            <Input id="phone" {...register("phone")} placeholder="+91-98140-12345" />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-semibold text-slate-700">
              Password (min 8 chars)
            </label>
            <Input id="password" type="password" {...register("password")} placeholder="••••••••" />
            {errors.password && (
              <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
            )}
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Creating account..." : "Create Account"}
          </Button>
        </form>

        <p className="text-center text-xs text-slate-600">
          Already registered?{" "}
          <Link href="/login" className="font-semibold text-emerald-700 hover:underline">
            Sign in here
          </Link>
        </p>
      </Card>
    </div>
  );
}
