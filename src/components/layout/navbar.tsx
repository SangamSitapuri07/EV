"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  MapPin,
  LogOut,
  Menu,
  X,
  Bell,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";

interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: "CUSTOMER" | "PARKING_OPERATOR" | "EV_OPERATOR" | "SUPER_ADMIN";
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "U";
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");

  const isHome = pathname === "/";

  useEffect(() => {
    let active = true;
    fetch("/api/v1/auth/session")
      .then((r) => r.json())
      .then((res) => {
        if (!active) return;
        if (res.ok && res.data?.authenticated) {
          setUser(res.data.user);
          setUnreadCount(res.data.unreadNotificationsCount ?? 0);
        } else {
          setUser(null);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/");
    router.refresh();
  }

  function handleQuickSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = quickQuery.trim();
    router.push(q ? `/explore?q=${encodeURIComponent(q)}` : "/explore");
  }

  const navItems = [
    { href: "/", label: "Home" },
    { href: "/explore", label: "Explore" },
    ...(!user || user.role === "CUSTOMER" || user.role === "SUPER_ADMIN"
      ? [{ href: "/dashboard", label: "User Dashboard" }]
      : []),
    ...(!user ||
    user.role === "EV_OPERATOR" ||
    user.role === "PARKING_OPERATOR" ||
    user.role === "SUPER_ADMIN"
      ? [{ href: "/ev-pumps", label: "EV Pumps" }]
      : []),
    ...(user?.role === "PARKING_OPERATOR" ||
    user?.role === "EV_OPERATOR" ||
    user?.role === "SUPER_ADMIN"
      ? [{ href: "/operator", label: "For Operators" }]
      : !user
        ? [{ href: "/trip-planner", label: "Trip Planner" }]
        : []),
    ...(user?.role === "SUPER_ADMIN" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <header
      className={`sticky top-0 z-40 transition-colors ${
        isHome
          ? "bg-[#0B2241]/95 text-white border-b border-white/10 backdrop-blur"
          : "bg-white/95 text-slate-900 border-b border-slate-200 backdrop-blur"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* ParkSmart Brand Mark */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white shadow-xs">
            <MapPin className="h-4.5 w-4.5" />
          </span>
          <span
            className={`text-lg font-bold tracking-tight ${
              isHome ? "text-white" : "text-[#0F2942]"
            }`}
          >
            ParkSmart
          </span>
        </Link>

        {/* Center Search Input on inner pages (matches Explore screen) */}
        {!isHome && (
          <form
            onSubmit={handleQuickSearch}
            className="hidden lg:flex relative w-72 xl:w-80"
          >
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              placeholder="Search here..."
              className="h-9 w-full rounded-full border border-slate-200 bg-slate-50 pl-9 pr-4 text-xs text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none"
            />
          </form>
        )}

        {/* Primary Nav Links */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
          {navItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative px-3 py-2 text-sm font-medium transition-colors rounded-lg ${
                  isHome
                    ? active
                      ? "text-white after:absolute after:bottom-1 after:left-3 after:right-3 after:h-0.5 after:bg-emerald-400"
                      : "text-slate-200 hover:text-white hover:bg-white/10"
                    : active
                      ? "bg-[#0F2942] text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right Actions: Bell + Initials Avatar or Login/Sign Up */}
        <div className="hidden items-center gap-2.5 md:flex shrink-0">
          {user ? (
            <>
              <Link
                href={
                  user.role === "SUPER_ADMIN"
                    ? "/admin"
                    : user.role === "CUSTOMER"
                      ? "/dashboard"
                      : user.role === "EV_OPERATOR"
                        ? "/ev-pumps"
                        : "/operator"
                }
                className={`relative flex h-9 w-9 items-center justify-center rounded-full border transition ${
                  isHome
                    ? "border-white/20 bg-white/10 text-white hover:bg-white/20"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
                title="Notifications & Dashboard"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </Link>

              <Link
                href={
                  user.role === "CUSTOMER"
                    ? "/dashboard"
                    : user.role === "EV_OPERATOR"
                      ? "/ev-pumps"
                      : user.role === "SUPER_ADMIN"
                        ? "/admin"
                        : "/operator"
                }
                className="flex items-center gap-2"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1E40AF] text-xs font-bold text-white">
                  {getInitials(user.fullName)}
                </span>
                <span
                  className={`hidden xl:inline text-xs font-semibold ${
                    isHome ? "text-slate-100" : "text-slate-800"
                  }`}
                >
                  {user.fullName.split(" ")[0]}
                </span>
              </Link>

              <button
                type="button"
                onClick={handleLogout}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  isHome
                    ? "border border-white/20 text-white hover:bg-white/10"
                    : "border border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                <LogOut className="h-3.5 w-3.5" />
                Logout
              </button>
            </>
          ) : (
            <>
              <Link href="/login">
                <span
                  className={`inline-flex items-center rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                    isHome
                      ? "border border-white/25 bg-white/10 text-white hover:bg-white/20"
                      : "border border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  Login
                </span>
              </Link>
              <Link href="/register">
                <span className="inline-flex items-center rounded-full bg-[#0F2942] border border-white/20 px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#173A5E] transition">
                  Sign Up
                </span>
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className={`rounded-lg p-2 md:hidden ${
            isHome ? "text-white hover:bg-white/10" : "text-slate-700 hover:bg-slate-100"
          }`}
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle navigation menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-slate-200 bg-white px-4 py-3 text-slate-900 md:hidden">
          <div className="flex flex-col gap-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 border-t border-slate-200 pt-2">
              {user ? (
                <Button variant="outline" size="sm" className="w-full" onClick={handleLogout}>
                  <LogOut className="h-4 w-4" />
                  Sign out ({user.fullName})
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Link href="/login" className="flex-1" onClick={() => setMobileOpen(false)}>
                    <Button variant="outline" size="sm" className="w-full">
                      Login
                    </Button>
                  </Link>
                  <Link href="/register" className="flex-1" onClick={() => setMobileOpen(false)}>
                    <Button variant="primary" size="sm" className="w-full">
                      Sign Up
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
