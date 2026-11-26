import { estimateTravelMinutes, haversineKm } from "./utils";

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  location?: [number, number]; // [lat, lng]
}

export interface LiveGpsSample {
  lat: number;
  lng: number;
  heading?: number | null;
  speedMps?: number | null;
  accuracyMeters?: number | null;
  timestamp?: number;
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

export interface NavigationProgress {
  remainingDistanceKm: number;
  remainingMinutes: number;
  currentStepIndex: number;
  offRoute: boolean;
  arrived: boolean;
  distanceFromRouteKm: number;
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
          location?: [number, number]; // [lng, lat]
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

function pointToSegmentKm(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): { distKm: number; projLat: number; projLng: number } {
  const cosLat = Math.cos(((aLat + bLat) * 0.5 * Math.PI) / 180);
  const kx = 111.32 * cosLat;
  const ky = 110.574;

  const ax = (aLng - pLng) * kx;
  const ay = (aLat - pLat) * ky;
  const bx = (bLng - pLng) * kx;
  const by = (bLat - pLat) * ky;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) {
    return {
      distKm: Math.hypot(ax, ay),
      projLat: aLat,
      projLng: aLng,
    };
  }

  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;

  return {
    distKm: Math.hypot(cx, cy),
    projLat: aLat + t * (bLat - aLat),
    projLng: aLng + t * (bLng - aLng),
  };
}

export function distanceToPolylineKm(
  point: [number, number],
  polyline: Array<[number, number]>
): { distKm: number; closestSegmentIndex: number; projLat: number; projLng: number } {
  if (polyline.length === 0) {
    return { distKm: 0, closestSegmentIndex: 0, projLat: point[0], projLng: point[1] };
  }
  if (polyline.length === 1) {
    const [lat, lng] = polyline[0]!;
    return {
      distKm: haversineKm(point[0], point[1], lat, lng),
      closestSegmentIndex: 0,
      projLat: lat,
      projLng: lng,
    };
  }

  let bestDist = Infinity;
  let bestSeg = 0;
  let bestLat = polyline[0]![0];
  let bestLng = polyline[0]![1];

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    const res = pointToSegmentKm(point[0], point[1], a[0], a[1], b[0], b[1]);
    if (res.distKm < bestDist) {
      bestDist = res.distKm;
      bestSeg = i;
      bestLat = res.projLat;
      bestLng = res.projLng;
    }
  }

  return {
    distKm: Math.round(bestDist * 1000) / 1000,
    closestSegmentIndex: bestSeg,
    projLat: bestLat,
    projLng: bestLng,
  };
}

export function getNavigationProgress(
  route: InAppRoute,
  currentPos: { lat: number; lng: number; speedMps?: number | null }
): NavigationProgress {
  const directToDestKm = haversineKm(
    currentPos.lat,
    currentPos.lng,
    route.destination.lat,
    route.destination.lng
  );
  const arrived = directToDestKm <= 0.05; // within 50 meters

  const polyMatch = distanceToPolylineKm(
    [currentPos.lat, currentPos.lng],
    route.coordinates
  );

  // Sum remaining polyline distance from closest projected point to destination
  let remainingDistanceKm = directToDestKm;
  if (route.coordinates.length >= 2) {
    let alongRoute = haversineKm(
      polyMatch.projLat,
      polyMatch.projLng,
      route.coordinates[polyMatch.closestSegmentIndex + 1]![0],
      route.coordinates[polyMatch.closestSegmentIndex + 1]![1]
    );
    for (let i = polyMatch.closestSegmentIndex + 1; i < route.coordinates.length - 1; i++) {
      const a = route.coordinates[i]!;
      const b = route.coordinates[i + 1]!;
      alongRoute += haversineKm(a[0], a[1], b[0], b[1]);
    }
    remainingDistanceKm = Math.round(Math.max(0, alongRoute) * 10) / 10;
  }

  if (arrived) {
    return {
      remainingDistanceKm: 0,
      remainingMinutes: 0,
      currentStepIndex: Math.max(0, route.steps.length - 1),
      offRoute: false,
      arrived: true,
      distanceFromRouteKm: polyMatch.distKm,
    };
  }

  let remainingMinutes = estimateTravelMinutes(remainingDistanceKm);
  if (
    typeof currentPos.speedMps === "number" &&
    Number.isFinite(currentPos.speedMps) &&
    currentPos.speedMps > 2
  ) {
    const kmPerHour = Math.min(110, Math.max(10, currentPos.speedMps * 3.6));
    remainingMinutes = Math.max(1, Math.round((remainingDistanceKm / kmPerHour) * 60));
  } else if (route.distanceKm > 0.1 && route.durationMinutes > 0) {
    remainingMinutes = Math.max(
      1,
      Math.round((remainingDistanceKm / route.distanceKm) * route.durationMinutes)
    );
  }

  // Determine active step by finding the nearest upcoming maneuver point
  let currentStepIndex = 0;
  if (route.steps.length > 1) {
    let closestStepIdx = 0;
    let closestDistKm = Infinity;
    for (let i = 0; i < route.steps.length; i++) {
      const loc = route.steps[i]!.location;
      if (!loc) continue;
      const d = haversineKm(currentPos.lat, currentPos.lng, loc[0], loc[1]);
      if (d < closestDistKm) {
        closestDistKm = d;
        closestStepIdx = i;
      }
    }
    // If within 45m of the closest maneuver point, advance to the next step
    currentStepIndex =
      closestDistKm <= 0.045 && closestStepIdx < route.steps.length - 1
        ? closestStepIdx + 1
        : closestStepIdx;
  }

  const offRoute = route.source === "OSRM" && polyMatch.distKm > 0.08;

  return {
    remainingDistanceKm,
    remainingMinutes,
    currentStepIndex,
    offRoute,
    arrived: false,
    distanceFromRouteKm: polyMatch.distKm,
  };
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
          .map((s) => {
            const loc = s.maneuver?.location;
            return {
              instruction: formatManeuver(s.maneuver?.type, s.maneuver?.modifier, s.name),
              distanceMeters: Math.round(s.distance ?? 0),
              location:
                Array.isArray(loc) && loc.length === 2
                  ? ([loc[1], loc[0]] as [number, number])
                  : undefined,
            };
          })
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
                    distanceMeters: Math.round(route.distance ?? fallbackDistanceKm * 1000),
                    location: [params.destLat, params.destLng],
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
        location: [params.originLat, params.originLng],
      },
      {
        instruction: "Arrive at EV charging destination",
        distanceMeters: 0,
        location: [params.destLat, params.destLng],
      },
    ],
    source: "DIRECT_FALLBACK",
  };
}
