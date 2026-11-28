// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import EvPumpsDashboardPage from "@/app/ev-pumps/page";
import { getEvPumpsDashboardData } from "@/features/operator/operator.service";

describe("EV Pumps Operator Dashboard — empty EV owner safety", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    class MockEventSource {
      addEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", MockEventSource);
  });

  it("returns facilities: [] from getEvPumpsDashboardData when an EV owner has no operator facilities yet", async () => {
    const result = await getEvPumpsDashboardData({
      id: "00000000-0000-4000-8000-000000000099",
      email: "owner@example.com",
      role: "EV_OPERATOR",
      fullName: "New EV Owner",
      emailVerified: true,
    });

    expect(Array.isArray(result.facilities)).toBe(true);
    expect(result.facilities).toEqual([]);
    expect(result.pumps).toEqual([]);
    expect(result.preOrders).toEqual([]);
  });

  it("renders /ev-pumps without crashing when facilities is empty or missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/v1/ev-pumps/dashboard")) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                pumps: [],
                preOrders: [],
                chargingSessions: [],
                metrics: {
                  totalPumps: 0,
                  totalGuns: 0,
                  availableGuns: 0,
                  chargingGuns: 0,
                  faultedGuns: 0,
                  upcomingPreOrders: 0,
                  activeSessions: 0,
                  totalEnergyKwh: 0,
                  totalEvRevenuePaise: 0,
                },
              },
            }),
            { status: 200 }
          );
        }
        if (url.includes("/api/v1/operator/verification")) {
          return new Response(JSON.stringify({ ok: true, data: { verification: null } }), {
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      })
    );

    render(<EvPumpsDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("EV Pumps Dashboard")).toBeInTheDocument();
    });
    expect(screen.getByText(/No EV pump facilities registered yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add EV Hub in Facilities Hub/i })).toBeInTheDocument();
  });
});
