import { describe, it, expect, beforeAll } from "vitest";
import { ensureDatabaseReady } from "@/db";
import { seedIfEmpty } from "@/db/seed-data";
import { facilities } from "@/db/schema";
import { eq } from "drizzle-orm";
import { calculatePriceEstimate } from "@/features/pricing/pricing.service";
import {
  hashPassword,
  verifyPassword,
  signQrPayload,
  verifyQrPayload,
} from "@/lib/auth";
import { formatPaise, haversineKm } from "@/lib/utils";

describe("Unit: Pricing Engine, Auth Hashing, QR HMAC & Geo Helpers", () => {
  let facilityId: string;

  beforeAll(async () => {
    const state = await ensureDatabaseReady();
    await seedIfEmpty(state.db);
    const [fac] = await state.db
      .select()
      .from(facilities)
      .where(eq(facilities.slug, "sarabha-nagar-central-plaza"))
      .limit(1);
    if (!fac) throw new Error("Seed facility missing");
    facilityId = fac.id;
  });

  it("formats integer paise amounts cleanly in INR", () => {
    expect(formatPaise(0)).toBe("₹0");
    expect(formatPaise(4500)).toBe("₹45");
    expect(formatPaise(12345)).toBe("₹123.45");
  });

  it("calculates accurate integer-paise parking prices with 5% platform fee & 18% GST", async () => {
    const start = new Date("2026-12-01T05:00:00.000Z"); // 10:30 IST (non-peak weekday)
    const end = new Date("2026-12-01T07:00:00.000Z"); // 2 hours

    const price = await calculatePriceEstimate({
      facilityId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      spaceCategory: "STANDARD",
      estimatedKwh: 0,
    });

    expect(price.durationMinutes).toBe(120);
    expect(price.parkingBasePaise).toBeGreaterThan(0);
    expect(price.platformFeePaise).toBe(Math.round(price.subtotalPaise * 0.05));
    expect(price.taxPaise).toBeGreaterThan(0);
    expect(price.totalEstimatedPaise).toBe(
      price.subtotalPaise + price.platformFeePaise + price.taxPaise
    );
    expect(Number.isInteger(price.totalEstimatedPaise)).toBe(true);
  });

  it("applies promo code EVFIRST10 discount cleanly", async () => {
    const start = new Date("2026-12-01T05:00:00.000Z");
    const end = new Date("2026-12-01T07:00:00.000Z");

    const regular = await calculatePriceEstimate({
      facilityId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      estimatedKwh: 0,
    });

    const discounted = await calculatePriceEstimate({
      facilityId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      estimatedKwh: 0,
      promoCode: "EVFIRST10",
    });

    expect(discounted.discountPaise).toBeGreaterThan(0);
    expect(discounted.totalEstimatedPaise).toBeLessThan(regular.totalEstimatedPaise);
  });

  it("rejects inverted time windows", async () => {
    await expect(
      calculatePriceEstimate({
        facilityId,
        startTime: "2026-12-01T10:00:00.000Z",
        endTime: "2026-12-01T09:00:00.000Z",
        estimatedKwh: 0,
      })
    ).rejects.toThrow();
  });

  it("hashes passwords with bcrypt and rejects wrong passwords", async () => {
    const hash = await hashPassword("SecretPass@123");
    expect(hash).not.toBe("SecretPass@123");
    expect(await verifyPassword("SecretPass@123", hash)).toBe(true);
    expect(await verifyPassword("WrongPass", hash)).toBe(false);
  });

  it("signs and verifies QR gate tokens and rejects tampered tokens", () => {
    const token = signQrPayload({
      reservationId: "11111111-1111-4111-8111-111111111111",
      bookingReference: "SM-TEST-999",
    });
    const decoded = verifyQrPayload(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.bookingReference).toBe("SM-TEST-999");

    const tampered = `${token.slice(0, -3)}xxx`;
    expect(verifyQrPayload(tampered)).toBeNull();
  });

  it("computes realistic Haversine distance between Ludhiana landmarks", () => {
    const km = haversineKm(30.901, 75.8573, 30.8768, 75.7924);
    expect(km).toBeGreaterThan(5);
    expect(km).toBeLessThan(9);
  });
});
