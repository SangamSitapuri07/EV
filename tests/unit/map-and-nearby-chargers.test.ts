import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET as getFacilities } from "@/app/api/v1/facilities/route";
import { GET as getNearbyChargers } from "@/app/api/v1/ev-chargers/nearby/route";
import {
  clearNearbyChargersCacheForTests,
  deduplicateStations,
  discoverNearbyExternalEvChargers,
} from "@/features/search/nearby-chargers.service";
import { computeInAppRoute } from "@/lib/in-app-navigation";
import { resetDbForTests, ensureDatabaseReady } from "@/db";
import { facilities } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("Search validation, nearby EV discovery, radius & authenticity", () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = "pglite://memory";
    delete process.env.OPEN_CHARGE_MAP_API_KEY;
    clearNearbyChargersCacheForTests();
    await resetDbForTests();
    await ensureDatabaseReady();
  });

  afterEach(() => {
    delete process.env.OPEN_CHARGE_MAP_API_KEY;
    clearNearbyChargersCacheForTests();
    vi.unstubAllGlobals();
  });

  it("rejects radiusKm > 100 and malformed/partial coordinates with 400 and field-level validation details", async () => {
    const resRadius = await getFacilities(
      new Request(
        "http://localhost/api/v1/facilities?lat=31.29&lng=75.57&radiusKm=500&hasEvCharging=true"
      )
    );
    expect(resRadius.status).toBe(400);
    const jsonRadius = await resRadius.json();
    expect(jsonRadius.ok).toBe(false);
    expect(jsonRadius.error.code).toBe("VALIDATION_ERROR");
    expect(jsonRadius.error.message).toContain("Invalid request payload:");
    expect(jsonRadius.error.message).toContain("radiusKm");

    const resPartial = await getFacilities(
      new Request("http://localhost/api/v1/facilities?lat=31.29")
    );
    expect(resPartial.status).toBe(400);
    const jsonPartial = await resPartial.json();
    expect(jsonPartial.error.message).toContain("Invalid request payload:");

    const resOutOfBounds = await getFacilities(
      new Request("http://localhost/api/v1/facilities?lat=120&lng=75.57")
    );
    expect(resOutOfBounds.status).toBe(400);

    const resNearbyBad = await getNearbyChargers(
      new Request("http://localhost/api/v1/ev-chargers/nearby?lat=notanumber&lng=75.57")
    );
    expect(resNearbyBad.status).toBe(400);
    const jsonNearbyBad = await resNearbyBad.json();
    expect(jsonNearbyBad.error.message).toContain("Invalid request payload:");
    expect(jsonNearbyBad.error.message).toContain("lat");

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

  it("treats an Overpass HTTP 200 timeout remark as unavailable and retries the mirror", async () => {
    const timedOutFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          remark: "runtime error: Query timed out.",
          elements: [],
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const result = await discoverNearbyExternalEvChargers({
      lat: 31.326,
      lng: 75.576,
      radiusKm: 99,
      fetchFn: timedOutFetch,
    });

    expect(timedOutFetch).toHaveBeenCalledTimes(2);
    expect(result.stations).toEqual([]);
    expect(result.sources.openStreetMapOverpass.status).toBe("UNAVAILABLE");
    expect(result.sources.openStreetMapOverpass.message).toContain("Query timed out");
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

    const res100 = await discoverNearbyExternalEvChargers({
      lat: 31.29,
      lng: 75.57,
      radiusKm: 100,
      includeLocalIndiaDataset: true,
      includeBeeIndiaApi: false,
      fetchFn: vi.fn(async () => new Response(JSON.stringify({ elements: [] }), { status: 200 })) as unknown as typeof fetch,
    });
    expect(res100.stations.length).toBeGreaterThan(result.stations.length);
    expect(res100.stations.some((s) => s.distanceKm > 50)).toBe(true);
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
      sourceId: "evs_1234567890",
      name: "BEE Public Charger Ludhiana",
      operator: "PSPCL / EESL",
      connectorStandards: ["CCS2"],
      maxPowerKw: 60,
      listingType: "SOURCE_LISTED",
      freshnessLabel: "BEE snapshot Oct 26, 2025",
      availabilityStatus: "UNKNOWN",
    });
  });

  it("queries Open Charge Map securely via X-API-Key header, parses pricing/freshness, and enforces 429 cooldown", async () => {
    process.env.OPEN_CHARGE_MAP_API_KEY = "test-ocm-key-123";
    const capturedCalls: Array<{ url: string; headers: HeadersInit | undefined }> = [];

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      capturedCalls.push({ url, headers: init?.headers });
      return new Response(
        JSON.stringify([
          {
            ID: 998877,
            DateLastStatusUpdate: "2026-11-20T10:15:00Z",
            UsageCost: "₹18/kWh + GST",
            DataProvider: { Title: "Open Charge Map Contributors" },
            AddressInfo: {
              Title: "Model Town Plaza EV Hub",
              AddressLine1: "GT Road",
              Town: "Jalandhar",
              Latitude: 31.305,
              Longitude: 75.575,
            },
            OperatorInfo: { Title: "Tata Power EZ Charge" },
            Connections: [
              { PowerKW: 60, Quantity: 2, ConnectionType: { Title: "CCS (Type 2)" } },
              { PowerKW: 22, Quantity: 1, ConnectionType: { Title: "Type 2 (Socket Only)" } },
            ],
          },
        ]),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await discoverNearbyExternalEvChargers({
      lat: 31.29,
      lng: 75.57,
      radiusKm: 25,
      includeLocalIndiaDataset: false,
      includeBeeIndiaApi: false,
      includeOpenChargeMap: true,
      includeOverpass: false,
      fetchFn: mockFetch,
    });

    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0]!.url).not.toContain("key=");
    expect((capturedCalls[0]!.headers as Record<string, string>)["X-API-Key"]).toBe(
      "test-ocm-key-123"
    );
    expect(result.sources.openChargeMap.status).toBe("OK");
    expect(result.attributions).toContain(
      "Open Charge Map contributors (CC BY 4.0, openchargemap.org)"
    );
    expect(result.stations[0]).toMatchObject({
      id: "ocm-998877",
      source: "OPEN_CHARGE_MAP",
      sourceId: "998877",
      name: "Model Town Plaza EV Hub",
      operator: "Tata Power EZ Charge",
      pricing: "₹18/kWh + GST",
      maxPowerKw: 60,
      totalConnectors: 3,
      connectorStandards: ["CCS2", "TYPE2_AC"],
      listingType: "SOURCE_LISTED",
      sourceUpdatedAt: "2026-11-20T10:15:00Z",
      availabilityStatus: "UNKNOWN",
    });

    // Simulate HTTP 429 rate limit and verify cooldown suppresses immediate retry
    const rateLimitedFetch = vi.fn(
      async () => new Response("Too Many Requests", { status: 429 })
    ) as unknown as typeof fetch;
    const rateLimitedRes = await discoverNearbyExternalEvChargers({
      lat: 31.29,
      lng: 75.57,
      radiusKm: 25,
      includeLocalIndiaDataset: false,
      includeBeeIndiaApi: false,
      includeOpenChargeMap: true,
      includeOverpass: false,
      fetchFn: rateLimitedFetch,
    });
    expect(rateLimitedRes.sources.openChargeMap.status).toBe("UNAVAILABLE");
    expect(rateLimitedRes.allEnabledProvidersFailed).toBe(true);

    const secondCallFetch = vi.fn() as unknown as typeof fetch;
    const cooledDownRes = await discoverNearbyExternalEvChargers({
      lat: 31.29,
      lng: 75.57,
      radiusKm: 25,
      includeLocalIndiaDataset: false,
      includeBeeIndiaApi: false,
      includeOpenChargeMap: true,
      includeOverpass: false,
      fetchFn: secondCallFetch,
    });
    expect(secondCallFetch).not.toHaveBeenCalled();
    expect(cooledDownRes.sources.openChargeMap.message).toContain("cooldown");
  });

  it("preserves distinct operators 55m apart while merging true duplicate station records", () => {
    const deduped = deduplicateStations([
      {
        id: "india-ev-1",
        source: "INDIA_OPEN_EV_DATA",
        sourceId: "1",
        name: "Tata Power Model Town Mall",
        operator: "Tata Power",
        address: "Model Town, Jalandhar",
        latitude: 31.305,
        longitude: 75.575,
        distanceKm: 1.5,
        connectors: [{ standard: "CCS2", powerKw: 60, count: 2, label: "CCS2 @ 60kW" }],
        connectorStandards: ["CCS2"],
        maxPowerKw: 60,
        sockets: "CCS2 · 60 kW",
        pricing: "₹18/kWh",
        sourceUpdatedAt: "2026-11-16",
        freshnessLabel: "Updated Nov 16, 2026",
        listingType: "SOURCE_LISTED",
        ownerVerified: false,
        stationDocsVerified: false,
        liveAvailabilityConnected: false,
        availabilityStatus: "UNKNOWN",
        availabilityUpdatedAt: "2026-11-16",
      },
      {
        id: "osm-2",
        source: "OPENSTREETMAP_OVERPASS",
        sourceId: "node/2",
        name: "HPCL eCharge Model Town",
        operator: "HPCL",
        address: "Opposite Model Town Mall, Jalandhar",
        // ~55 meters away from Tata Power
        latitude: 31.30545,
        longitude: 75.5752,
        distanceKm: 1.55,
        connectors: [{ standard: "TYPE2_AC", powerKw: 22, count: 1, label: "Type 2 (22 kW)" }],
        connectorStandards: ["TYPE2_AC"],
        maxPowerKw: 22,
        sockets: "Type 2 · 22 kW",
        pricing: null,
        sourceUpdatedAt: null,
        freshnessLabel: "Community map data",
        listingType: "SOURCE_LISTED",
        ownerVerified: false,
        stationDocsVerified: false,
        liveAvailabilityConnected: false,
        availabilityStatus: "UNKNOWN",
        availabilityUpdatedAt: null,
      },
      {
        id: "ocm-3",
        source: "OPEN_CHARGE_MAP",
        sourceId: "3",
        name: "Tata Power Model Town Mall Hub",
        operator: "Tata Power EZ Charge",
        address: "Model Town, Jalandhar",
        // Same station duplicate 80m away in another feed
        latitude: 31.3056,
        longitude: 75.5754,
        distanceKm: 1.56,
        connectors: [{ standard: "TYPE2_AC", powerKw: 7.4, count: 1, label: "Type 2 (7.4 kW)" }],
        connectorStandards: ["TYPE2_AC"],
        maxPowerKw: 7.4,
        sockets: null,
        pricing: null,
        sourceUpdatedAt: null,
        freshnessLabel: "Open Charge Map listing",
        listingType: "SOURCE_LISTED",
        ownerVerified: false,
        stationDocsVerified: false,
        liveAvailabilityConnected: false,
        availabilityStatus: "UNKNOWN",
        availabilityUpdatedAt: null,
      },
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((s) => s.operator)).toEqual(["Tata Power", "HPCL"]);
    expect(deduped[0]!.connectorStandards).toEqual(["CCS2", "TYPE2_AC"]);
  });

  it("returns 502 PROVIDER_UNAVAILABLE from /api/v1/ev-chargers/nearby when all enabled providers fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Upstream Overpass unreachable");
      })
    );

    // Coordinates outside India so local India CSV and BEE API are skipped; only Overpass is enabled
    const res = await getNearbyChargers(
      new Request("http://localhost/api/v1/ev-chargers/nearby?lat=51.5074&lng=-0.1278&radiusKm=10")
    );

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(json.error.message).toContain("openStreetMapOverpass");
    expect(json.error.details.providerErrors).toHaveLength(1);
  });
});
