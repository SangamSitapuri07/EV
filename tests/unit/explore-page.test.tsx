// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ExplorePage from "@/app/explore/page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

describe("Explore Page Interactions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock EventSource for jsdom
    class MockEventSource {
      addEventListener() {}
      close() {}
      onerror: (() => void) | null = null;
    }
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("isSecureContext", true);
  });

  it("handles geolocation permission denied without crashing or showing fake stations", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/facilities")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { items: [], total: 0, page: 1, pageSize: 20, searchCenter: null },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
    }));

    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_ok: unknown, err: (e: { code: number; PERMISSION_DENIED: number }) => void) => {
          err({ code: 1, PERMISSION_DENIED: 1 });
        },
      },
    });

    render(<ExplorePage />);

    const allowBtn = await screen.findByRole("button", {
      name: /Allow Location & Find Chargers/i,
    });
    fireEvent.click(allowBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/Location permission was declined/i).length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/No matching hubs found/i)).toBeInTheDocument();
  });

  it("tries browser Overpass when the server source fails and Open Charge Map has no stations", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/facilities")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { items: [], total: 0, page: 1, pageSize: 20, searchCenter: null },
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/v1/ev-chargers/nearby")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              stations: [],
              center: { lat: 28.6139, lng: 77.209 },
              radiusKm: 25,
              sources: {
                openChargeMap: {
                  configured: true,
                  status: "OK",
                },
                openStreetMapOverpass: {
                  status: "UNAVAILABLE",
                  message: "Server Overpass unavailable",
                },
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("overpass-api.de/api/interpreter")) {
        return new Response(
          JSON.stringify({
            elements: [
              {
                id: 101,
                lat: 28.614,
                lon: 77.21,
                tags: { name: "Nearby Public Charger" },
              },
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: (position: GeolocationPosition) => void) => {
          success({
            coords: { latitude: 28.6139, longitude: 77.209 },
          } as GeolocationPosition);
        },
      },
    });

    render(<ExplorePage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Allow Location & Find Chargers/i })
    );

    expect(await screen.findByText(/EV Charging Stations Within 25 km \(1\)/i))
      .toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("overpass-api.de/api/interpreter"),
      expect.any(Object)
    );
  });

  it("shows API validation error without claiming 'No matching hubs found', and resets filters on Clear All", async () => {
    let failNext = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/facilities")) {
        if (failNext) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: { code: "VALIDATION_ERROR", message: "Invalid request payload" },
            }),
            { status: 400 }
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: { items: [], total: 0, page: 1, pageSize: 20, searchCenter: null },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ExplorePage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid request payload");
    });
    expect(screen.queryByText(/No matching hubs found/i)).not.toBeInTheDocument();

    // Change filter, then Clear All and succeed
    failNext = false;
    const radiusSlider = screen.getByLabelText("Search radius") as HTMLInputElement;
    fireEvent.change(radiusSlider, { target: { value: "50" } });
    expect(radiusSlider.value).toBe("50");

    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    expect(radiusSlider.value).toBe("25");

    await waitFor(() => {
      expect(screen.getByText(/No matching hubs found/i)).toBeInTheDocument();
    });
  });
});
