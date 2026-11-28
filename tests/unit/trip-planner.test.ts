import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDbForTests, ensureDatabaseReady } from "@/db";
import { planEvTrip } from "@/features/search/search.service";
import { formatSourceFreshness } from "@/features/search/nearby-chargers.shared";
import { POST as planTripPost } from "@/app/api/v1/insights/ev-trip/route";

describe("EV Corridor Trip Planner & Snapshot Freshness", () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = "pglite://memory";
    await resetDbForTests();
    await ensureDatabaseReady();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("handles long corridors (>100km) cleanly, builds routePolyline, and finds real public EV corridor stops", async () => {
    // Stub OSRM to fail quickly so fallback straight-line corridor is deterministic offline
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("offline", { status: 503 }))
    );

    // Ludhiana (30.901, 75.857) -> Chandigarh (30.733, 76.779) ~90 km
    // And longer trip Ludhiana -> New Delhi (28.6139, 77.2090) ~285 km (>100 km previously crashed radiusKm!)
    const res = await planTripPost(
      new Request("http://localhost/api/v1/insights/ev-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originLat: 30.901,
          originLng: 75.857,
          destLat: 28.6139,
          destLng: 77.209,
          currentBatteryPct: 35,
          vehicleRangeKm: 320,
          connectorStandard: "CCS2",
        }),
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.totalDistanceKm).toBeGreaterThan(200);
    expect(json.data.needsChargingStop).toBe(true);
    expect(json.data.routePolyline.length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(json.data.corridorPublicStops)).toBe(true);
    expect(json.data.corridorPublicStops.length).toBeGreaterThan(0);

    for (const stop of json.data.corridorPublicStops) {
      expect(stop.distanceFromCorridorKm).toBeLessThanOrEqual(15);
      expect(stop.listingType).toBe("SOURCE_LISTED");
      expect(stop.liveAvailabilityConnected).toBe(false);
    }
  });

  it("formats dataset snapshot timestamps accurately without claiming live verification", () => {
    const label = formatSourceFreshness("2026-11-15T07:00:16.005Z");
    expect(label).toContain("Dataset snapshot:");
    expect(label).not.toMatch(/verified/i);
  });

  it("returns both ParkSmart bookable stops and public corridor stops for Ludhiana -> Chandigarh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("offline", { status: 503 }))
    );

    const plan = await planEvTrip({
      originLat: 30.901,
      originLng: 75.8573,
      destLat: 30.7333,
      destLng: 76.7794,
      currentBatteryPct: 25,
      vehicleRangeKm: 250,
      connectorStandard: "CCS2",
    });

    expect(plan.recommendedStops.length).toBeGreaterThan(0);
    expect(plan.corridorPublicStops.length).toBeGreaterThan(0);
    expect(plan.dataDisclosure).toContain("public directory listings do not have live charger availability connected");
  });
});
