/**
 * Lazily loads Mapbox GL JS (script + stylesheet) from the Mapbox CDN.
 *
 * We load on demand rather than bundling `mapbox-gl` so the public marketing
 * pages stay lightweight — the map only ships to browsers that actually open
 * the registration form while a Mapbox token is configured.
 */

const MAPBOX_VERSION = "v3.9.0";
const SCRIPT_SRC = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.js`;
const STYLE_HREF = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.css`;

// Minimal surface of the Mapbox GL global we rely on. Kept loose on purpose so
// we don't need the full `@types/mapbox-gl` package as a dependency.
export type MapboxGl = {
  Map: new (options: Record<string, unknown>) => MapboxMap;
  Marker: new (options?: Record<string, unknown>) => MapboxMarker;
  accessToken: string;
};

export type MapboxLngLat = { lng: number; lat: number };

export type MapboxMap = {
  on: (event: string, handler: (e: MapboxMapMouseEvent) => void) => void;
  remove: () => void;
  flyTo: (options: Record<string, unknown>) => void;
  resize: () => void;
};

export type MapboxMarker = {
  setLngLat: (lngLat: [number, number] | MapboxLngLat) => MapboxMarker;
  addTo: (map: MapboxMap) => MapboxMarker;
  getLngLat: () => MapboxLngLat;
  on: (event: string, handler: () => void) => void;
};

export type MapboxMapMouseEvent = { lngLat: MapboxLngLat };

let loaderPromise: Promise<MapboxGl> | null = null;

function loadStylesheet(): void {
  if (document.querySelector(`link[data-mapbox-gl="${MAPBOX_VERSION}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_HREF;
  link.dataset.mapboxGl = MAPBOX_VERSION;
  document.head.appendChild(link);
}

export function loadMapboxGl(): Promise<MapboxGl> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Mapbox GL can only load in the browser."));
  }
  const existing = (window as unknown as { mapboxgl?: MapboxGl }).mapboxgl;
  if (existing) {
    loadStylesheet();
    return Promise.resolve(existing);
  }
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<MapboxGl>((resolve, reject) => {
    loadStylesheet();
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      const gl = (window as unknown as { mapboxgl?: MapboxGl }).mapboxgl;
      if (gl) {
        resolve(gl);
      } else {
        reject(new Error("Mapbox GL failed to initialise."));
      }
    };
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error("Could not load Mapbox GL JS."));
    };
    document.head.appendChild(script);
  });

  return loaderPromise;
}

export type GeocodeResult = {
  placeName: string;
  lng: number;
  lat: number;
};

/** Forward geocode a free-text query into a place + coordinates. */
export async function forwardGeocode(
  query: string,
  token: string,
  options: { country?: string | null; proximity?: MapboxLngLat | null } = {},
): Promise<GeocodeResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const params = new URLSearchParams({
    access_token: token,
    limit: "1",
    language: "en",
  });
  if (options.country) params.set("country", options.country);
  if (options.proximity) {
    params.set("proximity", `${options.proximity.lng},${options.proximity.lat}`);
  }
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    trimmed,
  )}.json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { features?: Array<{ place_name: string; center: [number, number] }> };
  const feature = data.features?.[0];
  if (!feature) return null;
  return { placeName: feature.place_name, lng: feature.center[0], lat: feature.center[1] };
}

/** Reverse geocode coordinates into a human-readable place name. */
export async function reverseGeocode(
  lng: number,
  lat: number,
  token: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    access_token: token,
    limit: "1",
    language: "en",
  });
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { features?: Array<{ place_name: string }> };
  return data.features?.[0]?.place_name ?? null;
}
