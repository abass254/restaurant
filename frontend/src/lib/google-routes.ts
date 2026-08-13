import { loadGoogleMaps, type LatLng } from "./google-maps";

export type RouteTravelPreference = "motorbike" | "road" | "auto";

export type RoadRouteResult = {
  distanceKm: number;
  durationMinutes: number | null;
  path: LatLng[];
  travelMode: "TWO_WHEELER" | "DRIVING" | "DIRECTIONS";
  source: "routes" | "directions";
};

type ComputedRoute = {
  distanceMeters?: number;
  durationMillis?: number;
  path?: Array<{ lat: number | (() => number); lng: number | (() => number) }>;
  createPolylines?: (options?: {
    polylineOptions?: Record<string, unknown>;
  }) => Array<{ setMap: (map: unknown) => void }>;
};

type RoutesLibrary = {
  Route: {
    computeRoutes: (request: Record<string, unknown>) => Promise<{
      routes?: ComputedRoute[];
    }>;
  };
};

type DirectionsLeg = {
  distance?: { value?: number };
  duration?: { value?: number };
};

type DirectionsRoute = {
  legs?: DirectionsLeg[];
  overview_path?: Array<{ lat: () => number; lng: () => number }>;
};

type DirectionsServiceLike = {
  route: (
    request: Record<string, unknown>,
    callback: (result: { routes?: DirectionsRoute[] } | null, status: string) => void,
  ) => void;
};

/** One preferred Routes travel mode per preference — avoid chaining TWO_WHEELER + DRIVING + Directions. */
const ROUTES_PREFERRED_MODE: Record<
  RouteTravelPreference,
  "TWO_WHEELER" | "DRIVING"
> = {
  motorbike: "TWO_WHEELER",
  road: "DRIVING",
  auto: "TWO_WHEELER",
};

const ROUTE_CACHE_MS = 10 * 60_000;
const routeResultCache = new Map<
  string,
  { expiresAt: number; payload: { result: RoadRouteResult; route: ComputedRoute | null } }
>();

function roundCoord(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

function routeCacheKey(
  origin: LatLng,
  destination: LatLng,
  preference: RouteTravelPreference,
): string {
  return [
    roundCoord(origin.lat),
    roundCoord(origin.lng),
    roundCoord(destination.lat),
    roundCoord(destination.lng),
    preference,
  ].join("|");
}

function readCoord(value: number | (() => number)): number {
  return typeof value === "function" ? value() : value;
}

function readPath(path: ComputedRoute["path"]): LatLng[] {
  if (!path?.length) return [];
  return path.map((point) => ({
    lat: readCoord(point.lat),
    lng: readCoord(point.lng),
  }));
}

async function loadRoutesLibrary(): Promise<RoutesLibrary> {
  if (!window.google?.maps?.importLibrary) {
    throw new Error("Google Maps routes library is unavailable.");
  }
  return (await window.google.maps.importLibrary("routes")) as RoutesLibrary;
}

function getDirectionsService(): DirectionsServiceLike | null {
  const service = (window.google?.maps as { DirectionsService?: new () => DirectionsServiceLike })
    ?.DirectionsService;
  return service ? new service() : null;
}

async function computeWithRoutesApi(
  origin: LatLng,
  destination: LatLng,
  preference: RouteTravelPreference,
): Promise<{ result: RoadRouteResult; route: ComputedRoute } | null> {
  const { Route } = await loadRoutesLibrary();
  const travelMode = ROUTES_PREFERRED_MODE[preference];

  try {
    const { routes } = await Route.computeRoutes({
      origin,
      destination,
      travelMode,
      fields: ["distanceMeters", "durationMillis", "path"],
    });
    const route = routes?.[0];
    if (!route?.distanceMeters) return null;

    return {
      route,
      result: {
        distanceKm: route.distanceMeters / 1000,
        durationMinutes:
          route.durationMillis != null ? route.durationMillis / 60_000 : null,
        path: readPath(route.path),
        travelMode,
        source: "routes",
      },
    };
  } catch (error) {
    console.warn(`Routes API (${travelMode}) failed:`, error);
    return null;
  }
}

async function computeWithDirectionsService(
  origin: LatLng,
  destination: LatLng,
): Promise<RoadRouteResult | null> {
  const directionsService = getDirectionsService();
  if (!directionsService) return null;

  const travelMode =
    (window.google?.maps as { TravelMode?: { DRIVING?: string } })?.TravelMode?.DRIVING ??
    "DRIVING";

  return new Promise((resolve) => {
    directionsService.route(
      { origin, destination, travelMode },
      (result, status) => {
        if (status !== "OK" || !result?.routes?.[0]) {
          resolve(null);
          return;
        }

        const route = result.routes[0];
        const leg = route.legs?.[0];
        const distanceMeters = leg?.distance?.value;
        if (!distanceMeters) {
          resolve(null);
          return;
        }

        const path =
          route.overview_path?.map((point) => ({
            lat: point.lat(),
            lng: point.lng(),
          })) ?? [];

        resolve({
          distanceKm: distanceMeters / 1000,
          durationMinutes:
            leg?.duration?.value != null ? leg.duration.value / 60 : null,
          path,
          travelMode: "DIRECTIONS",
          source: "directions",
        });
      },
    );
  });
}

export async function fetchComputedRoute(
  apiKey: string,
  origin: LatLng,
  destination: LatLng,
  preference: RouteTravelPreference = "auto",
): Promise<{ result: RoadRouteResult; route: ComputedRoute | null } | null> {
  const cacheKey = routeCacheKey(origin, destination, preference);
  const cached = routeResultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      result: cached.payload.result,
      // Polyline factory from Routes API is not serializable across cache — redraw via path.
      route: null,
    };
  }

  await loadGoogleMaps(apiKey);

  const routesResult = await computeWithRoutesApi(origin, destination, preference);
  if (routesResult) {
    const payload = {
      result: routesResult.result,
      route: routesResult.route,
    };
    routeResultCache.set(cacheKey, {
      expiresAt: Date.now() + ROUTE_CACHE_MS,
      payload: { result: routesResult.result, route: null },
    });
    return payload;
  }

  const directionsResult = await computeWithDirectionsService(origin, destination);
  if (directionsResult) {
    const payload = { result: directionsResult, route: null };
    routeResultCache.set(cacheKey, {
      expiresAt: Date.now() + ROUTE_CACHE_MS,
      payload,
    });
    return payload;
  }

  return null;
}

export type { ComputedRoute };
