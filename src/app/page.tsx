import Link from "next/link";
import {
  MapPin,
  Zap,
  ShieldCheck,
  CreditCard,
  Car,
  Compass,
  CalendarCheck,
  Search,
  CheckCircle2,
  ArrowRight,
  BatteryCharging,
} from "lucide-react";
import { searchFacilities } from "@/features/search/search.service";
import { formatPaise, getFacilityPhoto } from "@/lib/utils";
import { Button, Card } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const preview = await searchFacilities({
    sortBy: "suitability",
    page: 1,
    pageSize: 3,
    radiusKm: 50,
  });

  return (
    <div className="bg-[#F4F7FB] min-h-screen">
      {/* Screen 1 Hero Section — Curved Dark Navy + Skyline + EV Charger */}
      <section className="relative overflow-hidden bg-[#0B2241] text-white rounded-b-[48px] shadow-lg">
        <img
          src="/images/hero-ev-skyline.jpg"
          alt="Electric vehicle charging at ParkSmart city hub"
          className="absolute inset-0 h-full w-full object-cover object-center opacity-70"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#081A33] via-[#0B2241]/85 to-[#0B2241]/30" />

        <div className="relative mx-auto max-w-7xl px-4 pt-12 pb-16 sm:px-6 lg:px-8 lg:pt-16 lg:pb-20">
          <div className="max-w-3xl space-y-5">
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-[52px] lg:leading-[1.1]">
              Smart Parking &amp; EV Charging Finder
            </h1>

            <div className="space-y-1.5">
              <p className="text-lg font-bold text-white">
                Find. Park. Charge. Go Green.
              </p>
              <p className="text-sm sm:text-base text-slate-200 max-w-xl">
                Discover real-time parking spaces and EV charging stations across the city.
              </p>
            </div>

            {/* White Floating Search Pill Bar */}
            <form
              action="/explore"
              method="GET"
              className="mt-6 rounded-2xl bg-white p-2 shadow-xl text-slate-900"
            >
              <div className="grid gap-2 md:grid-cols-12 items-center">
                <div className="md:col-span-5 flex items-center gap-2.5 px-3 py-2 border-b md:border-b-0 md:border-r border-slate-200">
                  <Search className="h-4.5 w-4.5 text-slate-400 shrink-0" />
                  <input
                    id="hero-q"
                    name="q"
                    type="text"
                    placeholder="Enter area, landmark, or city"
                    className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                  />
                </div>

                <div className="md:col-span-3 px-3 py-1 border-b md:border-b-0 md:border-r border-slate-200">
                  <label
                    htmlFor="hero-ev"
                    className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400"
                  >
                    Service Type
                  </label>
                  <select
                    id="hero-ev"
                    name="hasEvCharging"
                    defaultValue="true"
                    className="w-full bg-transparent text-xs font-semibold text-slate-800 focus:outline-none"
                  >
                    <option value="true">EV Charging Stations</option>
                    <option value="">Parking &amp; EV Hubs</option>
                    <option value="false">Parking Only</option>
                  </select>
                </div>

                <div className="md:col-span-2 px-3 py-1">
                  <label
                    htmlFor="hero-conn"
                    className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400"
                  >
                    Connector
                  </label>
                  <select
                    id="hero-conn"
                    name="connectorStandard"
                    defaultValue=""
                    className="w-full bg-transparent text-xs font-semibold text-slate-800 focus:outline-none"
                  >
                    <option value="">Any Type</option>
                    <option value="CCS2">CCS2 Fast</option>
                    <option value="TYPE2_AC">Type 2 AC</option>
                    <option value="CHADEMO">CHAdeMO</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="h-11 w-full rounded-xl bg-[#10B981] hover:bg-[#059669] text-sm font-bold text-white shadow-sm transition cursor-pointer"
                  >
                    Search
                  </button>
                </div>
              </div>
            </form>

            {/* 4 Quick Action Glass Pills */}
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href="/explore"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#0F2942]/80 px-4 py-2.5 text-xs font-semibold text-white backdrop-blur hover:bg-[#173A5E] transition"
              >
                <MapPin className="h-4 w-4 text-emerald-400" />
                EV Chargers Near Me
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#0F2942]/80 px-4 py-2.5 text-xs font-semibold text-white backdrop-blur hover:bg-[#173A5E] transition"
              >
                <Zap className="h-4 w-4 text-emerald-400" />
                Pre-Order EV Slot
              </Link>
              <Link
                href="/explore"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#0F2942]/80 px-4 py-2.5 text-xs font-semibold text-white backdrop-blur hover:bg-[#173A5E] transition"
              >
                <Compass className="h-4 w-4 text-sky-400" />
                Live City Map
              </Link>
              <Link
                href="/register?role=EV_OPERATOR"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#0F2942]/80 px-4 py-2.5 text-xs font-semibold text-white backdrop-blur hover:bg-[#173A5E] transition"
              >
                <CalendarCheck className="h-4 w-4 text-amber-300" />
                Register EV Station
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 4 Feature Highlight Cards */}
      <section className="mx-auto max-w-7xl px-4 -mt-6 relative z-10 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              title: "Real-Time Availability",
              icon: Car,
              bg: "bg-blue-50",
              fg: "text-blue-600",
            },
            {
              title: "EV Charging Stations",
              icon: Zap,
              bg: "bg-emerald-50",
              fg: "text-emerald-600",
            },
            {
              title: "Secure & Trusted",
              icon: ShieldCheck,
              bg: "bg-indigo-50",
              fg: "text-indigo-700",
            },
            {
              title: "Easy Payments",
              icon: CreditCard,
              bg: "bg-sky-50",
              fg: "text-sky-600",
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Card
                key={item.title}
                className="flex flex-col items-center justify-center gap-3 p-6 text-center shadow-sm border-slate-200/80"
              >
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl ${item.bg} ${item.fg}`}
                >
                  <Icon className="h-6 w-6" />
                </div>
                <div className="text-sm font-bold text-slate-900">{item.title}</div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* How It Works? + Drive Green Promo Card */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-12 items-stretch">
          {/* How It Works */}
          <Card className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between bg-white border-slate-200/80 shadow-sm">
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900">How It Works?</h2>
              <p className="mt-1 text-sm text-slate-500">
                Simple steps to find and book your parking or EV charging spot
              </p>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-4">
              {[
                {
                  num: "1",
                  title: "Search",
                  desc: "Find nearby locations on map or list",
                  icon: Search,
                },
                {
                  num: "2",
                  title: "Check",
                  desc: "View availability & pricing",
                  icon: MapPin,
                },
                {
                  num: "3",
                  title: "Book",
                  desc: "Pre-order your slot instantly",
                  icon: CalendarCheck,
                },
                {
                  num: "4",
                  title: "Pay & Park",
                  desc: "Complete payment & scan QR gate",
                  icon: CheckCircle2,
                },
              ].map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.num} className="text-center space-y-2">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-700">
                      {step.num}
                    </div>
                    <div className="text-sm font-bold text-slate-900">{step.title}</div>
                    <p className="text-xs text-slate-500 leading-relaxed">{step.desc}</p>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Drive Green Card */}
          <div className="lg:col-span-5 relative overflow-hidden rounded-2xl bg-[#10B981] text-white shadow-sm min-h-[260px] flex flex-col justify-between p-7">
            <img
              src="/images/drive-green-ev.jpg"
              alt="Drive Green EV charging"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#047857]/95 via-[#059669]/80 to-transparent" />
            <div className="relative max-w-xs space-y-2">
              <h3 className="text-2xl font-extrabold">Drive Green</h3>
              <p className="text-sm text-emerald-50">
                Choose EV charging for a cleaner tomorrow
              </p>
            </div>
            <div className="relative pt-6">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-xs font-bold text-[#047857] shadow hover:bg-emerald-50 transition"
              >
                Pre-Order EV Pump
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Hubs Row */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900">
              Featured Parking &amp; EV Hubs
            </h2>
            <p className="text-xs text-slate-500">
              Live database availability across Ludhiana hubs
            </p>
          </div>
          <Link href="/explore">
            <Button variant="outline" size="sm">
              Open Interactive Map
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {preview.items.map((fac) => (
            <Card key={fac.id} className="overflow-hidden flex flex-col border-slate-200/80 shadow-sm">
              <img
                src={getFacilityPhoto(fac.slug, fac.photos)}
                alt={fac.name}
                className="h-44 w-full object-cover"
              />
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <h3 className="font-bold text-slate-900">{fac.name}</h3>
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-600">
                    <span>
                      <strong className="text-slate-900">{formatPaise(fac.hourlyRatePaise)}</strong>
                      /hr · {fac.distanceKm} km
                    </span>
                    <span className="font-semibold text-emerald-700">
                      {fac.availableSpaces}/{fac.totalCapacity} Available
                    </span>
                  </div>
                  {fac.hasEvCharging && (
                    <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700">
                      <BatteryCharging className="h-3.5 w-3.5" />
                      {fac.availableConnectors} EV pumps ({fac.maxChargerKw}kW)
                    </div>
                  )}
                </div>

                <Link href={`/facilities/${fac.slug}`}>
                  <button
                    type="button"
                    className="w-full rounded-xl bg-[#0F2942] py-2.5 text-xs font-bold text-white hover:bg-[#173A5E] transition cursor-pointer"
                  >
                    Book Now
                  </button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
