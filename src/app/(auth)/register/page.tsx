"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  Car,
  CheckCircle2,
  FileCheck2,
  ShieldCheck,
  Upload,
  UserPlus,
  Zap,
} from "lucide-react";
import { Button, Card, Input, Select } from "@/components/ui/primitives";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRole =
    searchParams.get("role") === "EV_OPERATOR" ||
    searchParams.get("role") === "PARKING_OPERATOR"
      ? (searchParams.get("role") as "EV_OPERATOR" | "PARKING_OPERATOR")
      : "CUSTOMER";

  const [role, setRole] = useState<"CUSTOMER" | "EV_OPERATOR" | "PARKING_OPERATOR">(
    initialRole
  );
  const [ownerStep, setOwnerStep] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Account credentials
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");

  // Step 1: Owner verification
  const [ownerName, setOwnerName] = useState("");
  const [businessType, setBusinessType] = useState("PRIVATE_LIMITED");
  const [panNumber, setPanNumber] = useState("");
  const [gstinNumber, setGstinNumber] = useState("");
  const [businessDocName, setBusinessDocName] = useState("");
  const [businessDocRef, setBusinessDocRef] = useState("");

  // Step 2: Location & ownership proof
  const [siteAddress, setSiteAddress] = useState("");
  const [siteCity, setSiteCity] = useState("");
  const [ownershipType, setOwnershipType] = useState("OWNED");
  const [propertyDocName, setPropertyDocName] = useState("");
  const [propertyDocRef, setPropertyDocRef] = useState("");
  const [nocDocName, setNocDocName] = useState("");
  const [nocDocRef, setNocDocRef] = useState("");
  const [electricityBoard, setElectricityBoard] = useState("");
  const [electricityConsumerNo, setElectricityConsumerNo] = useState("");
  const [sanctionedLoadKw, setSanctionedLoadKw] = useState("60");

  // Step 3: Charger verification
  const [chargerManufacturer, setChargerManufacturer] = useState("");
  const [chargerModel, setChargerModel] = useState("");
  const [chargerSerialNumber, setChargerSerialNumber] = useState("");
  const [connectorType, setConnectorType] = useState("CCS2");
  const [complianceStandard, setComplianceStandard] = useState("ARAI / AIS-138 & BIS IS-17017");
  const [chargerDocName, setChargerDocName] = useState("");
  const [chargerDocRef, setChargerDocRef] = useState("");

  function handleFilePick(
    e: React.ChangeEvent<HTMLInputElement>,
    setName: (v: string) => void,
    setRef: (v: string) => void
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    setName(file.name);
    setRef(`file://${file.name} (${file.size} bytes, ${file.type || "document"})`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (role !== "CUSTOMER" && ownerStep < 3) {
      setOwnerStep((s) => (s + 1) as 1 | 2 | 3);
      return;
    }

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        fullName: fullName.trim() || ownerName.trim(),
        email,
        phone: phone || undefined,
        password,
        role,
        businessName: role !== "CUSTOMER" ? businessName || ownerName : undefined,
      };

      if (role !== "CUSTOMER") {
        payload.ownerVerification = {
          ownerName: ownerName || fullName,
          businessType,
          panNumber: panNumber.toUpperCase(),
          gstinNumber: gstinNumber.toUpperCase() || undefined,
          businessDocName: businessDocName || "Business_Registration_Doc",
          businessDocRef: businessDocRef || businessDocName,
          siteAddress,
          siteCity,
          ownershipType,
          propertyDocName: propertyDocName || "Property_Ownership_Proof",
          propertyDocRef: propertyDocRef || propertyDocName,
          nocDocName: nocDocName || "Site_NOC_Document",
          nocDocRef: nocDocRef || nocDocName,
          electricityBoard,
          electricityConsumerNo,
          sanctionedLoadKw: Number(sanctionedLoadKw),
          chargerManufacturer,
          chargerModel,
          chargerSerialNumber,
          connectorType,
          complianceStandard,
          chargerDocName: chargerDocName || "Charger_Compliance_Certificate",
          chargerDocRef: chargerDocRef || chargerDocName,
        };
      }

      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error?.message || "Registration failed. Please verify all required fields.");
        return;
      }

      router.push(
        role === "CUSTOMER"
          ? "/dashboard"
          : role === "EV_OPERATOR"
            ? "/ev-pumps"
            : "/operator"
      );
      router.refresh();
    } catch {
      setError("Network error while creating account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#F4F7FB] min-h-[calc(100vh-4rem)] py-10">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <Card className="p-6 sm:p-8 bg-white space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0F2342] text-emerald-400">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900">Create your ParkSmart Account</h1>
              <p className="text-xs text-slate-600">
                Customers sign up with Google or Email; EV Owners complete 3-step security verification.
              </p>
            </div>
          </div>

          {/* Role Toggle */}
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setRole("CUSTOMER");
                setError(null);
              }}
              className={`flex items-center gap-2.5 rounded-xl border p-3.5 text-left transition cursor-pointer ${
                role === "CUSTOMER"
                  ? "border-blue-600 bg-blue-50/50 ring-2 ring-blue-500/20"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Car className="h-5 w-5 text-blue-600 shrink-0" />
              <div>
                <div className="text-xs font-bold text-slate-900">Customer (Driver)</div>
                <div className="text-[11px] text-slate-500">Google or Email registration</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setRole("EV_OPERATOR");
                setError(null);
              }}
              className={`flex items-center gap-2.5 rounded-xl border p-3.5 text-left transition cursor-pointer ${
                role !== "CUSTOMER"
                  ? "border-emerald-600 bg-emerald-50/50 ring-2 ring-emerald-500/20"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Zap className="h-5 w-5 text-emerald-600 shrink-0" />
              <div>
                <div className="text-xs font-bold text-slate-900">EV Pump Owner</div>
                <div className="text-[11px] text-slate-500">3-Step Document Verification</div>
              </div>
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Customer Google Sign-Up */}
          {role === "CUSTOMER" && (
            <>
              <GoogleSignInButton redirectTo="/dashboard" label="Sign up with Google" />
              <div className="relative flex items-center py-1">
                <div className="grow border-t border-slate-200" />
                <span className="mx-3 shrink text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  or register with email
                </span>
                <div className="grow border-t border-slate-200" />
              </div>
            </>
          )}

          {/* EV Owner 3-Step Progress Bar */}
          {role !== "CUSTOMER" && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { step: 1 as const, label: "1. Owner & PAN/GSTIN" },
                { step: 2 as const, label: "2. Location & NOC" },
                { step: 3 as const, label: "3. Charger Proof" },
              ].map((s) => (
                <button
                  key={s.step}
                  type="button"
                  onClick={() => setOwnerStep(s.step)}
                  className={`rounded-xl border px-3 py-2 text-[11px] font-bold transition cursor-pointer ${
                    ownerStep === s.step
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : ownerStep > s.step
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-slate-50 text-slate-500"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Customer Fields */}
            {role === "CUSTOMER" && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Full Name
                  </label>
                  <Input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Full name"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Email</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="driver@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Phone (optional)
                  </label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91-98140-12345"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Password (min 8 chars)
                  </label>
                  <Input
                    type="password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
              </>
            )}

            {/* EV Owner Step 1: Owner Verification */}
            {role !== "CUSTOMER" && ownerStep === 1 && (
              <div className="space-y-4">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                  <strong>Step 1 — Owner Verification:</strong> Enter owner identity, PAN/GSTIN &amp; business proof.
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Owner Full Name *
                    </label>
                    <Input
                      value={ownerName}
                      onChange={(e) => {
                        setOwnerName(e.target.value);
                        if (!fullName) setFullName(e.target.value);
                      }}
                      placeholder="Legal owner name"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Business Type *
                    </label>
                    <Select
                      value={businessType}
                      onChange={(e) => setBusinessType(e.target.value)}
                    >
                      <option value="INDIVIDUAL">Individual</option>
                      <option value="PROPRIETORSHIP">Sole Proprietorship</option>
                      <option value="PARTNERSHIP">Partnership</option>
                      <option value="LLP">LLP</option>
                      <option value="PRIVATE_LIMITED">Private Limited</option>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Business / Station Brand Name *
                  </label>
                  <Input
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Registered business name"
                    required
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      PAN Number *
                    </label>
                    <Input
                      value={panNumber}
                      onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                      placeholder="ABCDE1234F"
                      maxLength={10}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      GSTIN (based on business type)
                    </label>
                    <Input
                      value={gstinNumber}
                      onChange={(e) => setGstinNumber(e.target.value.toUpperCase())}
                      placeholder="03ABCDE1234F1Z5"
                      maxLength={15}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Business Registration / PAN Document *
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0">
                      <Upload className="h-3.5 w-3.5" />
                      Upload Document
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="hidden"
                        onChange={(e) =>
                          handleFilePick(e, setBusinessDocName, setBusinessDocRef)
                        }
                      />
                    </label>
                    <Input
                      value={businessDocRef}
                      onChange={(e) => {
                        setBusinessDocRef(e.target.value);
                        if (!businessDocName) setBusinessDocName("Business_Document");
                      }}
                      placeholder="Or enter document reference / ID"
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Owner Email *
                    </label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="owner@company.com"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Phone *
                    </label>
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91-98..."
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Password *
                    </label>
                    <Input
                      type="password"
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 8 chars"
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            {/* EV Owner Step 2: Location & Ownership Proof */}
            {role !== "CUSTOMER" && ownerStep === 2 && (
              <div className="space-y-4">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 flex items-center gap-2">
                  <FileCheck2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <strong>Step 2 — Location &amp; Ownership Proof:</strong> Property/lease authorization, NOC &amp; electricity connection details.
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Charging Site Address *
                    </label>
                    <Input
                      value={siteAddress}
                      onChange={(e) => setSiteAddress(e.target.value)}
                      placeholder="Plot / Street / Landmark"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      City *
                    </label>
                    <Input
                      value={siteCity}
                      onChange={(e) => setSiteCity(e.target.value)}
                      placeholder="City"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Site Occupancy / Ownership Basis *
                  </label>
                  <Select
                    value={ownershipType}
                    onChange={(e) => setOwnershipType(e.target.value)}
                  >
                    <option value="OWNED">Property Ownership (Sale Deed / Registry)</option>
                    <option value="LEASED">Registered Lease Agreement</option>
                    <option value="AUTHORIZED">Site Operation Authorization Letter</option>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Property / Lease / Authorization Proof *
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0">
                      <Upload className="h-3.5 w-3.5" />
                      Upload Proof
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="hidden"
                        onChange={(e) =>
                          handleFilePick(e, setPropertyDocName, setPropertyDocRef)
                        }
                      />
                    </label>
                    <Input
                      value={propertyDocRef}
                      onChange={(e) => {
                        setPropertyDocRef(e.target.value);
                        if (!propertyDocName) setPropertyDocName("Property_Proof");
                      }}
                      placeholder="Property deed / lease agreement document ref"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    NOC (Fire / Municipal / Society NOC) *
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0">
                      <Upload className="h-3.5 w-3.5" />
                      Upload NOC
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="hidden"
                        onChange={(e) => handleFilePick(e, setNocDocName, setNocDocRef)}
                      />
                    </label>
                    <Input
                      value={nocDocRef}
                      onChange={(e) => {
                        setNocDocRef(e.target.value);
                        if (!nocDocName) setNocDocName("Site_NOC");
                      }}
                      placeholder="NOC document reference"
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Electricity Board / DISCOM *
                    </label>
                    <Input
                      value={electricityBoard}
                      onChange={(e) => setElectricityBoard(e.target.value)}
                      placeholder="e.g. PSPCL / BSES"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Consumer / Meter No. *
                    </label>
                    <Input
                      value={electricityConsumerNo}
                      onChange={(e) => setElectricityConsumerNo(e.target.value)}
                      placeholder="Meter / CA Number"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Sanctioned Load (kW) *
                    </label>
                    <Input
                      type="number"
                      min={3}
                      max={2000}
                      value={sanctionedLoadKw}
                      onChange={(e) => setSanctionedLoadKw(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            {/* EV Owner Step 3: Charger Verification */}
            {role !== "CUSTOMER" && ownerStep === 3 && (
              <div className="space-y-4">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <strong>Step 3 — Charger Verification:</strong> Charger hardware specs, serial number &amp; safety standards compliance.
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Charger Manufacturer *
                    </label>
                    <Input
                      value={chargerManufacturer}
                      onChange={(e) => setChargerManufacturer(e.target.value)}
                      placeholder="e.g. ABB, Delta, Exicom"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Charger Model *
                    </label>
                    <Input
                      value={chargerModel}
                      onChange={(e) => setChargerModel(e.target.value)}
                      placeholder="e.g. Terra 124 / Spin Air"
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Charger Serial Number *
                    </label>
                    <Input
                      value={chargerSerialNumber}
                      onChange={(e) => setChargerSerialNumber(e.target.value)}
                      placeholder="Hardware Serial No."
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Connector Type *
                    </label>
                    <Select
                      value={connectorType}
                      onChange={(e) => setConnectorType(e.target.value)}
                    >
                      <option value="CCS2">CCS2 (DC Fast)</option>
                      <option value="TYPE2_AC">Type 2 AC</option>
                      <option value="CHADEMO">CHAdeMO</option>
                      <option value="BHARAT_DC001">Bharat DC-001</option>
                      <option value="BHARAT_AC001">Bharat AC-001</option>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Applicable Safety &amp; Protocol Standard *
                  </label>
                  <Input
                    value={complianceStandard}
                    onChange={(e) => setComplianceStandard(e.target.value)}
                    placeholder="ARAI / AIS-138 / BIS IS-17017 / IEC 61851"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Charger Test Report / Compliance Certificate *
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0">
                      <Upload className="h-3.5 w-3.5" />
                      Upload Certificate
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="hidden"
                        onChange={(e) =>
                          handleFilePick(e, setChargerDocName, setChargerDocRef)
                        }
                      />
                    </label>
                    <Input
                      value={chargerDocRef}
                      onChange={(e) => {
                        setChargerDocRef(e.target.value);
                        if (!chargerDocName) setChargerDocName("Charger_Compliance_Cert");
                      }}
                      placeholder="ARAI / BIS / IEC certificate reference"
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              {role !== "CUSTOMER" && ownerStep > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOwnerStep((s) => (s - 1) as 1 | 2 | 3)}
                >
                  Back
                </Button>
              )}
              <Button type="submit" disabled={loading} className="flex-1">
                {loading
                  ? "Submitting Verification..."
                  : role !== "CUSTOMER" && ownerStep < 3
                    ? `Continue to Step ${ownerStep + 1} →`
                    : role !== "CUSTOMER"
                      ? "Submit EV Owner Verification & Register"
                      : "Create Customer Account"}
              </Button>
            </div>
          </form>

          <p className="text-center text-xs text-slate-600">
            Already registered?{" "}
            <Link href="/login" className="font-semibold text-emerald-700 hover:underline">
              Sign in here
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm">Loading registration...</div>}>
      <RegisterContent />
    </Suspense>
  );
}
