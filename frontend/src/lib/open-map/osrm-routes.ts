import type { LatLng, RoadRouteResult } from "./types";

const DEFAULT_OSRM_BASE =
  process.env.NEXT_PUBLIC_OSRM_URL?.replace(/\/$/, "") ||
  "https://router.project-osrm.org";

export async function fetchOsrmRoute(
  origin: LatLng,
  destination: LatLng,
): Promise<RoadRouteResult | null> {
  const url =
    `${DEFAULT_OSRM_BASE}/route/v1/driving/` +
    `${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
    "?overview=full&geometries=geojson";

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as {
    code?: string;
    routes?: Array<{
      distance?: number;
      duration?: number;
      geometry?: { coordinates?: Array<[number, number]> };
    }>;
  };

  if (data.code !== "Ok") return null;
  const route = data.routes?.[0];
  const coords = route?.geometry?.coordinates;
  if (!route?.distance || !coords?.length) return null;

  return {
    distanceKm: route.distance / 1000,
    durationMinutes: route.duration != null ? route.duration / 60 : null,
    path: coords.map(([lng, lat]) => ({ lat, lng })),
    source: "osrm",
  };
}
