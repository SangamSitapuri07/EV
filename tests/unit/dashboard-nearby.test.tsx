// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CustomerDashboardPage from "@/app/dashboard/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("Customer Dashboard — Location-Aware EV Station Discovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    class MockEventSource {
      addEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("isSecureContext", true);
  });

  it("tracks nearby EV stations via GPS and Search Hub / City in EV Pumps & Pre-Order", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/customer/overview")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              user: { id: "u1", email: "driver@test.com", fullName: "Zwiter", role: "CUSTOMER" },
              profile: null,
              vehicles: [],
              notifications: [],
              tickets: [],
              reservations: [],
              payments: [],
              refunds: [],
              chargingSessions: [],
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/v1/ev-pumps")) {
        return new Response(JSON.stringify({ ok: true, data: { pumps: [] } }), { status: 200 });
      }
      if (url.includes("nominatim.openstreetmap.org/search")) {
        return new Response(
          JSON.stringify([
            { lat: "31.3260", lon: "75.5762", display_name: "Jalandhar, Punjab, India" },
          ]),
          { status: 200 }
        );
      }
      if (url.includes("/api/v1/ev-chargers/nearby")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              stations: [
                {
                  id: "india-ev-344",
                  source: "INDIA_OPEN_EV_DATA",
                  sourceId: "344",
                  name: "Jiobp Eastwoods Village, Jalandhar",
                  operator: "Jio-bp Pulse Charge",
                  address: "NH-44, Jalandhar Phagwara Highway",
                  latitude: 31.2738,
                  longitude: 75.6846,
                  distanceKm: 2.38,
                  connectors: [{ standard: "CCS2", powerKw: 60, count: 1, label: "CCS2@60kW" }],
                  connectorStandards: ["CCS2"],
                  maxPowerKw: 60,
                  sockets: "CCS2@60kW",
                  pricing: "₹25.99/kWh",
                  sourceUpdatedAt: "2026-11-15T07:00:16.005Z",
                  freshnessLabel: "Updated 15 Nov 2026",
                  listingType: "SOURCE_LISTED",
                  ownerVerified: false,
                  stationDocsVerified: false,
                  liveAvailabilityConnected: false,
                  availabilityStatus: "UNKNOWN",
                  availabilityUpdatedAt: "2026-11-15T07:00:16.005Z",
                },
              ],
              center: { lat: 31.326, lng: 75.5762 },
              radiusKm: 25,
              sources: {
                indiaOpenDataset: { status: "OK", count: 1 },
                beeIndiaApi: { status: "SKIPPED" },
                openChargeMap: { configured: false, status: "NOT_CONFIGURED" },
                openStreetMapOverpass: { status: "OK" },
              },
              providerErrors: [],
              allEnabledProvidersFailed: false,
              attributions: [],
            },
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CustomerDashboardPage />);

    // Open EV Pumps & Pre-Order tab
    const tabBtn = await screen.findByRole("button", { name: /^EV Pumps & Pre-Order$/i });
    fireEvent.click(tabBtn);

    const cityInput = await screen.findByPlaceholderText(/City or hub/i);
    fireEvent.change(cityInput, { target: { value: "Jalandhar" } });
    fireEvent.click(screen.getByRole("button", { name: /Check Availability/i }));

    await waitFor(() => {
      expect(screen.getByText(/Found 1 EV charging station/i)).toBeInTheDocument();
    });
    expect(screen.getByText("Jiobp Eastwoods Village, Jalandhar")).toBeInTheDocument();
    expect(screen.getByText(/Live availability not connected/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Navigate on Map/i })).toHaveAttribute(
      "href",
      "/explore?lat=31.2738&lng=75.6846&stationId=india-ev-344"
    );
  });
});
