import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET as getFacilities } from "@/app/api/v1/facilities/route";
import { GET as getNearbyChargers } from "@/app/api/v1/ev-chargers/nearby/route";
import { discoverNearbyExternalEvChargers } from "@/features/search/nearby-chargers.service";
import { resetDbForTests, ensureDatabaseReady } from "@/db";
import { facilities } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("Search validation, nearby EV discovery, radius & authenticity", () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = "pglite://memory";
    await resetDbForTests();
    await ensureDatabaseReady();
  });

  it("rejects radiusKm > 100 and malformed/partial coordinates with 400 validation error", async () => {
    const resRadius = await getFacilities(
      new Request(
        "http://localhost/api/v1/facilities?lat=31.29&lng=75.57&radiusKm=500&hasEvCharging=true"
      )
    );
    expect(resRadius.status).toBe(400);
    const jsonRadius = await resRadius.json();
    expect(jsonRadius.ok).toBe(false);
    expect(jsonRadius.error.code).toBe("VALIDATION_ERROR");

    const resPartial = await getFacilities(
      new Request("http://localhost/api/v1/facilities?lat=31.29")
    );
    expect(resPartial.status).toBe(400);

    const resOutOfBounds = await getFacilities(
      new Request("http://localhost/api/v1/facilities?lat=120&lng=75.57")
    );
    expect(resOutOfBounds.status).toBe(400);

    const resNearbyBad = await getNearbyChargers(
      new Request("http://localhost/api/v1/ev-chargers/nearby?lat=notanumber&lng=75.57")
    );
    expect(resNearbyBad.status).toBe(400);

    const resNearbyMissing = await getNearbyChargers(
      new Request("http://localhost/api/v1/ev-chargers/nearby")
    );
    expect(resNearbyMissing.status).toBe(400);
  });

  it("filters facilities cleanly by radius, connector, price, parking, and returns separated authenticity & availability statuses", async () => {
    // Valid coordinates around seeded Ludhiana hubs
    const res = await getFacilities(
      new Request(
        "http://localhost/api/v1/facilities?lat=30.8965&lng=75.8235&radiusKm=25&hasEvCharging=true&connectorStandard=CCS2&maxPricePaise=5000"
      )
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.items.length).toBeGreaterThan(0);

    for (const item of json.data.items) {
      expect(item.distanceKm).toBeLessThanOrEqual(25);
      expect(item.hourlyRatePaise).toBeLessThanOrEqual(5000);
      expect(item.connectorStandards).toContain("CCS2");
      expect(typeof item.ownerVerified).toBe("boolean");
      expect(typeof item.stationDocsVerified).toBe("boolean");
      expect(typeof item.liveAvailabilityConnected).toBe("boolean");
      expect(["LIVE", "STALE", "UNKNOWN"]).toContain(item.availabilityStatus);
    }

    // Empty results far away (e.g. inside 10km of remote point)
    const emptyRes = await getFacilities(
      new Request(
        "http://localhost/api/v1/facilities?lat=10.0&lng=76.0&radiusKm=5"
      )
    );
    expect(emptyRes.status).toBe(200);
    const emptyJson = await emptyRes.json();
    expect(emptyJson.ok).toBe(true);
    expect(emptyJson.data.items).toEqual([]);
  });

  it("reports STALE availability when facility availabilityUpdatedAt is older than 15 minutes", async () => {
    const { db } = await ensureDatabaseReady();
    await db
      .update(facilities)
      .set({
        dataSourceType: "VERIFIED_REAL",
        availabilityUpdatedAt: new Date(Date.now() - 45 * 60 * 1000),
      })
      .where(eq(facilities.slug, "sarabha-nagar-central-plaza"));

    const res = await getFacilities(
      new Request("http://localhost/api/v1/facilities?q=Sarabha")
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.items[0].isStale).toBe(true);
    expect(json.data.items[0].availabilityStatus).toBe("STALE");
  });

  it("discovers real OSM stations with exact coordinates, filters strictly by radius, and keeps availability UNKNOWN", async () => {
    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          elements: [
            {
              id: 101,
              lat: 31.326,
              lon: 75.5762,
              tags: {
                name: "Jalandhar Station A",
                operator: "ChargeZone",
                "socket:type2": "2",
                "socket:type2:output": "22 kW",
              },
            },
            {
              id: 102,
              lat: 32.5,
              lon: 77.5,
              tags: {
                name: "Far Station Outside Radius",
                "socket:chademo": "1",
              },
            },
          ],
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const result = await discoverNearbyExternalEvChargers({
      lat: 31.29,
      lng: 75.57,
      radiusKm: 25,
      fetchFn: mockFetch,
    });

    expect(result.sources.openStreetMapOverpass.status).toBe("OK");
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0]).toMatchObject({
      id: "osm-101",
      name: "Jalandhar Station A",
      latitude: 31.326,
      longitude: 75.5762,
      ownerVerified: false,
      stationDocsVerified: false,
      liveAvailabilityConnected: false,
      availabilityStatus: "UNKNOWN",
    });
    expect(result.stations[0]!.distanceKm).toBeLessThanOrEqual(25);
  });

  it("surfaces external Overpass API failure cleanly instead of fabricating stations", async () => {
    const failingFetch = vi.fn(async () => {
      throw new Error("Network timeout");
    }) as unknown as typeof fetch;

    const result = await discoverNearbyExternalEvChargers({
      lat: 31.29,
      lng: 75.57,
      radiusKm: 25,
      fetchFn: failingFetch,
    });

    expect(result.stations).toEqual([]);
    expect(result.sources.openStreetMapOverpass.status).toBe("UNAVAILABLE");
    expect(result.sources.openStreetMapOverpass.message).toBeTruthy();
  });
});
