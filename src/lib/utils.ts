import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPaise(paise: number, currency = "INR"): string {
  const major = paise / 100;
  if (currency === "INR") {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(major);
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

export function estimateTravelMinutes(distanceKm: number): number {
  // Urban average speed ~24 km/h
  return Math.max(2, Math.round((distanceKm / 24) * 60));
}

export function generateBookingRef(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `SM-${code}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// In-memory sliding window rate limiter (Redis-compatible interface for multi-instance prod)
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  limit = 60,
  windowMs = 60_000
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const next = { count: 1, resetAt: now + windowMs };
    rateBuckets.set(key, next);
    return { allowed: true, remaining: limit - 1, resetAt: next.resetAt };
  }
  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }
  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

export function getFacilityPhoto(slug: string, photos?: string[] | null): string {
  const first = photos?.[0];
  if (first && (first.endsWith(".jpg") || first.endsWith(".png") || first.endsWith(".webp"))) {
    return first;
  }
  const s = slug.toLowerCase();
  if (s.includes("ev") || s.includes("charge") || s.includes("hub") || s.includes("ferozepur")) {
    return "/images/facility-evhub.jpg";
  }
  if (s.includes("model") || s.includes("city") || s.includes("surface") || s.includes("tower")) {
    return "/images/facility-citycenter.jpg";
  }
  return "/images/facility-mall.jpg";
}

export function getFacilityGallery(slug: string, photos?: string[] | null): string[] {
  const primary = getFacilityPhoto(slug, photos);
  const pool = [
    primary,
    "/images/facility-mall.jpg",
    "/images/facility-evhub.jpg",
    "/images/facility-citycenter.jpg",
  ];
  return Array.from(new Set(pool)).slice(0, 4);
}
