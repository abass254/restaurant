import { Platform } from 'react-native';
import { getGoogleMapsApiKey } from '@/src/map/config';
import {
  CUSTOMER_COORD,
  RIDER_COORD,
  STORE_COORD,
  type LatLng,
  type MapVariant,
} from '@/src/map/tripLocations';

export type RouteLeg = {
  origin: LatLng;
  destination: LatLng;
  label: string;
};

/** Which route to draw for each map stage. */
export function routeLegForVariant(variant: MapVariant): RouteLeg | null {
  if (variant === 'store') {
    return {
      origin: RIDER_COORD,
      destination: STORE_COORD,
      label: 'To store',
    };
  }
  if (variant === 'customer') {
    return {
      origin: STORE_COORD,
      destination: CUSTOMER_COORD,
      label: 'To customer',
    };
  }
  return null;
}

/** Decode Google encoded polyline → coordinates. */
export function decodePolyline(encoded: string): LatLng[] {
  const coordinates: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coordinates.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return coordinates;
}

function straightFallback(origin: LatLng, destination: LatLng): LatLng[] {
  // Slight mid-point drift so it doesn't look like a ruler line
  const mid: LatLng = {
    latitude: (origin.latitude + destination.latitude) / 2 + 0.0012,
    longitude: (origin.longitude + destination.longitude) / 2 - 0.0008,
  };
  return [origin, mid, destination];
}

type CacheEntry = { path: LatLng[]; at: number };
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 5 * 60_000;

function cacheKey(origin: LatLng, destination: LatLng): string {
  return [
    origin.latitude.toFixed(5),
    origin.longitude.toFixed(5),
    destination.latitude.toFixed(5),
    destination.longitude.toFixed(5),
  ].join(',');
}

async function fetchViaDirectionsRest(
  origin: LatLng,
  destination: LatLng,
  apiKey: string,
): Promise<LatLng[] | null> {
  const url =
    'https://maps.googleapis.com/maps/api/directions/json' +
    `?origin=${origin.latitude},${origin.longitude}` +
    `&destination=${destination.latitude},${destination.longitude}` +
    '&mode=driving&alternatives=false' +
    `&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    status?: string;
    routes?: Array<{ overview_polyline?: { points?: string } }>;
  };
  if (data.status !== 'OK') return null;
  const points = data.routes?.[0]?.overview_polyline?.points;
  if (!points) return null;
  const path = decodePolyline(points);
  return path.length >= 2 ? path : null;
}

type DirectionsServiceLike = {
  route: (
    request: Record<string, unknown>,
    callback: (
      result: {
        routes?: Array<{
          overview_path?: Array<{ lat: () => number; lng: () => number }>;
          overview_polyline?: string | { points?: string };
        }>;
      } | null,
      status: string,
    ) => void,
  ) => void;
};

async function fetchViaDirectionsService(
  origin: LatLng,
  destination: LatLng,
): Promise<LatLng[] | null> {
  const g = (globalThis as { google?: { maps?: { DirectionsService?: new () => DirectionsServiceLike; TravelMode?: { DRIVING: string } } } })
    .google;
  if (!g?.maps?.DirectionsService) return null;

  const service = new g.maps.DirectionsService();
  return new Promise((resolve) => {
    service.route(
      {
        origin: { lat: origin.latitude, lng: origin.longitude },
        destination: { lat: destination.latitude, lng: destination.longitude },
        travelMode: g.maps!.TravelMode?.DRIVING ?? 'DRIVING',
      },
      (result, status) => {
        if (status !== 'OK' || !result?.routes?.[0]) {
          resolve(null);
          return;
        }
        const route = result.routes[0];
        if (route.overview_path?.length) {
          resolve(
            route.overview_path.map((p) => ({
              latitude: p.lat(),
              longitude: p.lng(),
            })),
          );
          return;
        }
        resolve(null);
      },
    );
  });
}

async function fetchViaOsrm(
  origin: LatLng,
  destination: LatLng,
): Promise<LatLng[] | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}` +
    `?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    code?: string;
    routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }>;
  };
  if (data.code !== 'Ok') return null;
  const coords = data.routes?.[0]?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  return coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}

/**
 * Returns road-following coordinates for a ride segment.
 *
 * Uses OSRM by default — Google Directions often returns REQUEST_DENIED
 * when the Maps JS key lacks the Directions API (and Google logs that loudly).
 * Set EXPO_PUBLIC_USE_GOOGLE_DIRECTIONS=1 to try Google first when enabled.
 */
export async function fetchRoutePath(
  origin: LatLng,
  destination: LatLng,
): Promise<LatLng[]> {
  const key = cacheKey(origin, destination);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.path;
  }

  let path: LatLng[] | null = null;
  const preferGoogle =
    process.env.EXPO_PUBLIC_USE_GOOGLE_DIRECTIONS === '1' ||
    process.env.EXPO_PUBLIC_USE_GOOGLE_DIRECTIONS === 'true';

  if (preferGoogle) {
    const apiKey = getGoogleMapsApiKey();
    try {
      if (Platform.OS === 'web') {
        path = await fetchViaDirectionsService(origin, destination);
      } else if (apiKey) {
        path = await fetchViaDirectionsRest(origin, destination, apiKey);
      }
    } catch {
      path = null;
    }
  }

  if (!path || path.length < 2) {
    try {
      path = await fetchViaOsrm(origin, destination);
    } catch {
      path = null;
    }
  }

  if (!path || path.length < 2) {
    path = straightFallback(origin, destination);
  }

  cache.set(key, { path, at: Date.now() });
  return path;
}

export function useRoutePathKey(variant: MapVariant): string {
  const leg = routeLegForVariant(variant);
  if (!leg) return 'none';
  return cacheKey(leg.origin, leg.destination);
}
