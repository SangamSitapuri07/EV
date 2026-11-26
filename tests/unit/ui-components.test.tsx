// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Badge, Button, StatusPill } from "@/components/ui/primitives";
import { InteractiveCityMap } from "@/components/map/interactive-city-map";
import type { FacilitySearchResultItem } from "@/features/search/search.service";

const sampleFacility: FacilitySearchResultItem = {
  id: "f1",
  slug: "sarabha-nagar-central-plaza",
  name: "Sarabha Plaza",
  description: "Test garage",
  facilityType: "MULTI_LEVEL_GARAGE",
  dataSourceType: "OPERATOR_MANAGED",
  ownerVerified: true,
  stationDocsVerified: false,
  liveAvailabilityConnected: false,
  availabilityStatus: "UNKNOWN",
  addressLine1: "Plot 14, Main Market",
  landmark: null,
  city: "Ludhiana",
  state: "Punjab",
  latitude: 30.8886,
  longitude: 75.8195,
  is24Hours: true,
  isCovered: true,
  hasSecurity: true,
  hasAccessibility: true,
  hasEvCharging: true,
  totalCapacity: 10,
  availableSpaces: 5,
  occupiedSpaces: 5,
  availableConnectors: 2,
  totalConnectors: 2,
  maxChargerKw: 60,
  connectorStandards: ["CCS2"],
  hourlyRatePaise: 4000,
  dailyMaxPaise: 24000,
  currency: "INR",
  distanceKm: 1.2,
  estimatedTravelMinutes: 4,
  averageRating: 4.8,
  reviewCount: 12,
  suitabilityScore: 92,
  availabilityUpdatedAt: new Date().toISOString(),
  isStale: false,
  amenities: ["CCTV 24x7"],
  photos: ["/images/facility-mall.jpg"],
};

describe("UI Components (React Testing Library)", () => {
  it("renders status pills and badges with accurate text", () => {
    render(
      <div>
        <StatusPill status="AVAILABLE" />
        <StatusPill status="FAULTED" />
        <Badge variant="warning">Owner Verified</Badge>
        <Button onClick={() => {}}>Reserve Bay</Button>
      </div>
    );

    expect(screen.getByText("AVAILABLE")).toBeInTheDocument();
    expect(screen.getByText("FAULTED")).toBeInTheDocument();
    expect(screen.getByText("Owner Verified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reserve Bay" })).toBeInTheDocument();
  });

  it("renders InteractiveCityMap markers, authenticity/unknown availability badges, and locate callback", () => {
    const onSelectFacility = vi.fn();
    const onLocateUser = vi.fn();

    render(
      <InteractiveCityMap
        facilities={[sampleFacility]}
        osmStations={[
          {
            id: "osm-99",
            source: "OPENSTREETMAP_OVERPASS",
            name: "Public Highway Charger",
            operator: "Highway Grid",
            address: "NH44",
            latitude: 31.32,
            longitude: 75.57,
            distanceKm: 2.1,
            connectorStandards: ["CCS2"],
            maxPowerKw: 60,
            sockets: "Connectors: CCS2 (2)",
            ownerVerified: false,
            stationDocsVerified: false,
            liveAvailabilityConnected: false,
            availabilityStatus: "UNKNOWN",
            availabilityUpdatedAt: null,
          },
        ]}
        selectedId="osm-99"
        onSelectFacility={onSelectFacility}
        userLocation={null}
        onSearchBounds={vi.fn()}
        onLocateUser={onLocateUser}
      />
    );

    expect(screen.getByText("Public Highway Charger")).toBeInTheDocument();
    expect(screen.getByText(/Availability unknown/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Use my current location/i }));
    expect(onLocateUser).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Occupancy Heatmap/i }));
    fireEvent.click(screen.getByRole("button", { name: /Sarabha Plaza/i }));
    expect(onSelectFacility).toHaveBeenCalledWith("f1");
  });
});
