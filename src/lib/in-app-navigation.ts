import { estimateTravelMinutes, haversineKm } from "./utils";

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
}

export interface InAppRoute {
  destinationId: string;
  destinationName: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  coordinates: Array<[number, number]>; // [lat, lng] pairs for Leaflet
  distanceKm: number;
  durationMinutes: number;
  steps: RouteStep[];
  source: "OSRM" | "DIRECT_FALLBACK";
}

interface OsrmResponse {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: {
      coordinates?: Array<[number, number]>; // GeoJSON [lng, lat]
    };
    legs?: Array<{
      steps?: Array<{
        distance?: number;
        name?: string;
        maneuver?: {
          type?: string;
          modifier?: string;
        };
      }>;
    }>;
  }>;
}

function formatManeuver(type?: string, modifier?: string, roadName?: string): string {
  const cleanRoad = roadName && roadName.trim().length > 0 ? ` onto ${roadName}` : "";
  const mod = modifier ? ` ${modifier}` : "";
  switch (type) {
    case "depart":
      return `Head${mod}${cleanRoad}`.trim();
    case "arrive":
      return "Arrive at EV charging destination";
    case "turn":
      return `Turn${mod}${cleanRoad}`.trim();
    case "roundabout":
      return `Enter roundabout${cleanRoad}`.trim();
    case "merge":
      return `Merge${mod}${cleanRoad}`.trim();
    case "fork":
      return `Keep${mod} at fork${cleanRoad}`.trim();
    case "continue":
      return `Continue${mod}${cleanRoad}`.trim();
    default:
      return `${type ? type.replace(/_/g, " ") : "Proceed"}${mod}${cleanRoad}`.trim();
  }
}

export async function computeInAppRoute(params: {
  destinationId: string;
  destinationName: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
}): Promise<InAppRoute> {
  const fallbackDistanceKm = haversineKm(
    params.originLat,
    params.originLng,
    params.destLat,
    params.destLng
  );

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const url = `https://router.project-osrm.org/route/v1/driving/${params.originLng},${params.originLat};${params.destLng},${params.destLat}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const json = (await res.json()) as OsrmResponse;
      const route = json.routes?.[0];
      const coords = route?.geometry?.coordinates;
      if (json.code === "Ok" && route && Array.isArray(coords) && coords.length >= 2) {
        const leafletCoords: Array<[number, number]> = coords.map(([lng, lat]) => [lat, lng]);
        const steps: RouteStep[] = (route.legs?.[0]?.steps ?? [])
          .map((s) => ({
            instruction: formatManeuver(s.maneuver?.type, s.maneuver?.modifier, s.name),
            distanceMeters: Math.round(s.distance ?? 0),
          }))
          .filter((s) => s.instruction.length > 0);

        return {
          destinationId: params.destinationId,
          destinationName: params.destinationName,
          origin: { lat: params.originLat, lng: params.originLng },
          destination: { lat: params.destLat, lng: params.destLng },
          coordinates: leafletCoords,
          distanceKm: Math.round(((route.distance ?? fallbackDistanceKm * 1000) / 1000) * 10) / 10,
          durationMinutes: Math.max(1, Math.round((route.duration ?? 0) / 60)),
          steps:
            steps.length > 0
              ? steps
              : [
                  {
                    instruction: `Drive to ${params.destinationName}`,
                    distanceMeters: Math.round((route.distance ?? fallbackDistanceKm * 1000)),
                  },
                ],
          source: "OSRM",
        };
      }
    }
  } catch {
    // Fall back to direct route polyline on offline/blocked networks
  }

  return {
    destinationId: params.destinationId,
    destinationName: params.destinationName,
    origin: { lat: params.originLat, lng: params.originLng },
    destination: { lat: params.destLat, lng: params.destLng },
    coordinates: [
      [params.originLat, params.originLng],
      [params.destLat, params.destLng],
    ],
    distanceKm: fallbackDistanceKm,
    durationMinutes: estimateTravelMinutes(fallbackDistanceKm),
    steps: [
      {
        instruction: `Head toward ${params.destinationName}`,
        distanceMeters: Math.round(fallbackDistanceKm * 1000),
      },
      {
        instruction: "Arrive at EV charging destination",
        distanceMeters: 0,
      },
    ],
    source: "DIRECT_FALLBACK",
  };
}
