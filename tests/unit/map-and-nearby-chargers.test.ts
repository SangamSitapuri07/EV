import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET as getFacilities } from "@/app/api/v1/facilities/route";
import { GET as getNearbyChargers } from "@/app/api/v1/ev-chargers/nearby/route";
import { discoverNearbyExternalEvChargers } from "@/features/search/nearby-chargers.service";
import { computeInAppRoute } from "@/lib/in-app-navigation";
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

  it("computes in-app OSRM route or clean fallback without redirecting outside the website", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: "Ok",
            routes: [
              {
                distance: 3200,
                duration: 420,
                geometry: {
                  coordinates: [
                    [77.209, 28.6139],
                    [77.219, 28.625],
                  ],
                },
                legs: [
                  {
                    steps: [
                      { distance: 1200, name: "Janpath", maneuver: { type: "depart", modifier: "north" } },
                      { distance: 0, name: "", maneuver: { type: "arrive" } },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 }
        )
      )
    );

    const route = await computeInAppRoute({
      destinationId: "ocm-1",
      destinationName: "Connaught Place Charger",
      originLat: 28.6139,
      originLng: 77.209,
      destLat: 28.625,
      destLng: 77.219,
    });

    expect(route.source).toBe("OSRM");
    expect(route.distanceKm).toBe(3.2);
    expect(route.durationMinutes).toBe(7);
    expect(route.coordinates[0]).toEqual([28.6139, 77.209]);
    expect(route.steps.length).toBeGreaterThanOrEqual(2);

    vi.unstubAllGlobals();
  });

  it("discovers commercial EV stations from Google Places API (New) when GOOGLE_PLACES_API_KEY is configured", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "test-google-places-key";
    try {
      const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("places.googleapis.com")) {
          return new Response(
            JSON.stringify({
              places: [
                {
                  id: "ChIJ_Statiq",
                  displayName: { text: "Statiq Charging Station" },
                  formattedAddress: "Model Town, Jalandhar, Punjab",
                  location: { latitude: 31.309, longitude: 75.576 },
                  evChargeOptions: {
                    connectorCount: 2,
                    connectorAggregation: [
                      {
                        type: "EV_CONNECTOR_TYPE_CCS_COMBO_2",
                        maxChargeRateKw: 60,
                        count: 2,
                        availableCount: 1,
                        availabilityLastUpdateTime: new Date().toISOString(),
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ elements: [] }), { status: 200 });
      }) as unknown as typeof fetch;

      const result = await discoverNearbyExternalEvChargers({
        lat: 31.29,
        lng: 75.57,
        radiusKm: 25,
        fetchFn: mockFetch,
      });

      expect(result.sources.googlePlaces.status).toBe("OK");
      expect(result.stations).toHaveLength(1);
      expect(result.stations[0]).toMatchObject({
        id: "gplaces-ChIJ_Statiq",
        source: "GOOGLE_PLACES",
        name: "Statiq Charging Station",
        connectorStandards: ["CCS2"],
        maxPowerKw: 60,
        availableConnectors: 1,
        totalConnectors: 2,
        liveAvailabilityConnected: true,
        availabilityStatus: "LIVE",
      });
    } finally {
      delete process.env.GOOGLE_PLACES_API_KEY;
    }
  });

  it("discovers real commercial Indian EV stations from the free bundled ODbL dataset in Jalandhar with zero API keys", async () => {
    const result = await discoverNearbyExternalEvChargers({
      lat: 31.29,
      lng: 75.57,
      radiusKm: 25,
      includeLocalIndiaDataset: true,
      includeBeeIndiaApi: false,
      fetchFn: vi.fn(async () => new Response(JSON.stringify({ elements: [] }), { status: 200 })) as unknown as typeof fetch,
    });

    expect(result.sources.indiaOpenDataset.status).toBe("OK");
    expect(result.stations.length).toBeGreaterThanOrEqual(5);
    for (const s of result.stations) {
      expect(s.source).toBe("INDIA_OPEN_EV_DATA");
      expect(s.distanceKm).toBeLessThanOrEqual(25);
      expect(s.ownerVerified).toBe(false);
      expect(s.liveAvailabilityConnected).toBe(false);
      expect(s.availabilityStatus).toBe("UNKNOWN");
    }
  });

  it("discovers keyless BEE India EV stations when BEE API is enabled", async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("ev-charging-stations-api.vercel.app")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: "evs_1234567890",
                name: "BEE Public Charger Ludhiana",
                operator: "PSPCL / EESL",
                address: "Ferozepur Road",
                city: "Ludhiana",
                state: "Punjab",
                latitude: 30.896,
                longitude: 75.823,
                max_power_kw: 60,
                total_chargers: 2,
                standards: ["CCS2"],
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ elements: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await discoverNearbyExternalEvChargers({
      lat: 30.9,
      lng: 75.85,
      radiusKm: 25,
      includeLocalIndiaDataset: false,
      includeBeeIndiaApi: true,
      fetchFn: mockFetch,
    });

    expect(result.sources.beeIndiaApi.status).toBe("OK");
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0]).toMatchObject({
      id: "bee-evs_1234567890",
      source: "BEE_INDIA_API",
      name: "BEE Public Charger Ludhiana",
      operator: "PSPCL / EESL",
      connectorStandards: ["CCS2"],
      maxPowerKw: 60,
      availabilityStatus: "UNKNOWN",
    });
  });
});
