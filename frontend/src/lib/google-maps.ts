/**
 * Google Maps JavaScript API loader (Maps + Places New).
 *
 * Uses importLibrary/bootstrap loading. Autocomplete goes through Places API
 * (New) — legacy AutocompleteService is not available on new GCP projects.
 */

import {
  TRANSCHAP_MAP_MARKER_ICON,
  TRANSCHAP_MAP_STYLES,
  createStoreMarkerElement,
  getStoreMarkerIcon,
  isStoreMarkerIcon,
} from "./google-maps-style";

export type LatLng = { lat: number; lng: number };

export type GoogleMapsMap = {
  setCenter: (center: LatLng) => void;
  panTo: (center: LatLng) => void;
  setZoom: (zoom: number) => void;
  addListener: (event: string, handler: (e: GoogleMapsMouseEvent) => void) => void;
};

export type GoogleMapsMarker = {
  setPosition?: (position: LatLng) => void;
  getPosition?: () => { lat: () => number; lng: () => number } | null | undefined;
  position?: LatLng | null;
  setMap: (map: GoogleMapsMap | null) => void;
  addListener: (event: string, handler: () => void) => void;
};

export type GoogleMapsMouseEvent = {
  latLng: { lat: () => number; lng: () => number } | null;
};

export type GoogleMapsGeocoder = {
  geocode: (
    request: Record<string, unknown>,
    callback: (results: GoogleGeocodeResult[] | null, status: string) => void,
  ) => void;
};

export type GoogleGeocodeResult = {
  formatted_address: string;
  geometry: { location: { lat: () => number; lng: () => number } };
};

export type PlacePredictionSource = {
  placeId: string;
  text?: { text?: string } | string;
  mainText?: { text?: string } | string;
  secondaryText?: { text?: string } | string;
  toPlace: () => PlaceSource;
};

export type PlaceSource = {
  fetchFields: (options: { fields: string[] }) => Promise<void>;
  formattedAddress?: string;
  location?: { lat: () => number; lng: () => number } | LatLng;
};

export type PlacesLibrary = {
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (
      request: Record<string, unknown>,
    ) => Promise<{ suggestions: Array<{ placePrediction?: PlacePredictionSource }> }>;
  };
  AutocompleteSessionToken: new () => unknown;
};

export type MapsLibrary = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapsMap;
  Marker?: new (options: Record<string, unknown>) => GoogleMapsMarker;
};

export type MarkerLibrary = {
  AdvancedMarkerElement: new (options: Record<string, unknown>) => GoogleMapsMarker;
};

export type GoogleMapsRuntime = {
  maps: MapsLibrary;
  places: PlacesLibrary;
  Geocoder: new () => GoogleMapsGeocoder;
  requiresMapId: boolean;
  createMarker: (options: {
    map: GoogleMapsMap | null;
    position: LatLng;
    draggable?: boolean;
    icon?: Record<string, unknown>;
  }) => GoogleMapsMarker;
};

export type PlacePrediction = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
  source: PlacePredictionSource;
};

/** Optional Cloud Console map style; when unset, TransChap JSON styles are applied. */
const BUILD_TIME_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim() || null;
let runtimeMapId: string | null = BUILD_TIME_MAP_ID;

/** Apply map ID from public config (server env or admin settings). */
export function configureGoogleMapsRuntime(options: { mapId?: string | null } = {}): void {
  const nextMapId = options.mapId?.trim() || BUILD_TIME_MAP_ID || null;
  runtimeMapId = nextMapId || null;
}

export function getCloudMapId(): string | null {
  return runtimeMapId;
}

export function hasCloudMapId(): boolean {
  return Boolean(getCloudMapId());
}

type MarkerConstructor = new (options: Record<string, unknown>) => GoogleMapsMarker;

function getLegacyMarkerClass(): MarkerConstructor | null {
  const Marker = (window.google?.maps as { Marker?: MarkerConstructor })?.Marker;
  return Marker ?? null;
}

declare global {
  interface Window {
    google?: {
      maps: {
        importLibrary: (name: string) => Promise<unknown>;
        Geocoder?: new () => GoogleMapsGeocoder;
      };
    };
  }
}

let runtimePromise: Promise<GoogleMapsRuntime> | null = null;
let loadedKey: string | null = null;
let sessionToken: unknown | null = null;

function waitForImportLibrary(timeoutMs = 20_000): Promise<void> {
  if (window.google?.maps?.importLibrary) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = window.setInterval(() => {
      if (window.google?.maps?.importLibrary) {
        window.clearInterval(tick);
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        window.clearInterval(tick);
        reject(new Error("Google Maps importLibrary was not available in time."));
      }
    }, 50);
  });
}

function injectBootstrap(apiKey: string): Promise<void> {
  if (window.google?.maps?.importLibrary) {
    return Promise.resolve();
  }

  const existing = document.querySelector<HTMLScriptElement>(
    'script[data-google-maps-loader="true"]',
  );
  if (existing) {
    return waitForImportLibrary();
  }

  return new Promise((resolve, reject) => {
    const bootstrap = document.createElement("script");
    bootstrap.dataset.googleMapsLoader = "true";
    bootstrap.text = [
      "(g=>{var h,a,k,p=\"The Google Maps JavaScript API\",c=\"google\",l=\"importLibrary\",q=\"__ib__\",m=document,b=window;",
      "b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{",
      "await (a=m.createElement(\"script\"));e.set(\"libraries\",[...r]+\"\");for(k in g)e.set(k.replace(/[A-Z]/g,t=>\"_\"+t[0].toLowerCase()),g[k]);",
      "e.set(\"callback\",c+\".maps.\"+q);a.src=\"https://maps.\"+c+\"apis.com/maps/api/js?\"+e;d[q]=f;a.onerror=()=>h=n(Error(p+\" could not load.\"));",
      "a.nonce=m.querySelector(\"script[nonce]\")?.nonce||\"\";m.head.append(a)}));",
      "d[l]?console.warn(p+\" only loads once. Ignoring:\",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})",
      `(${JSON.stringify({ key: apiKey, v: "weekly" })});`,
    ].join("");
    bootstrap.onerror = () =>
      reject(new Error("Could not bootstrap Google Maps JavaScript API."));
    document.head.appendChild(bootstrap);

    void waitForImportLibrary()
      .then(resolve)
      .catch(reject);
  });
}

async function loadGeocoder(importLibrary: (name: string) => Promise<unknown>): Promise<
  new () => GoogleMapsGeocoder
> {
  try {
    const geocodingLib = (await importLibrary("geocoding")) as {
      Geocoder: new () => GoogleMapsGeocoder;
    };
    if (geocodingLib.Geocoder) return geocodingLib.Geocoder;
  } catch {
    // Fall through to global Geocoder after maps core loads.
  }

  await importLibrary("maps");
  const Geocoder = window.google?.maps?.Geocoder;
  if (Geocoder) return Geocoder;

  throw new Error("Google Maps Geocoder is unavailable.");
}

async function buildRuntime(apiKey: string): Promise<GoogleMapsRuntime> {
  await injectBootstrap(apiKey);
  const importLibrary = window.google!.maps.importLibrary;

  const [mapsLib, placesLib, Geocoder, markerLib] = await Promise.all([
    importLibrary("maps"),
    importLibrary("places"),
    loadGeocoder(importLibrary),
    importLibrary("marker").catch(() => null),
  ]);

  const maps = mapsLib as MapsLibrary;
  const places = placesLib as PlacesLibrary;
  const advancedMarker = markerLib
    ? (markerLib as MarkerLibrary).AdvancedMarkerElement
    : null;
  const classicMarker = getLegacyMarkerClass();
  const canUseAdvancedMarkers = Boolean(advancedMarker) && hasCloudMapId();
  const requiresMapId = !classicMarker && canUseAdvancedMarkers;

  sessionToken = new places.AutocompleteSessionToken();

  const createMarker: GoogleMapsRuntime["createMarker"] = ({
    map,
    position,
    draggable,
    icon,
  }) => {
    if (classicMarker) {
      return new classicMarker({
        map,
        position,
        draggable: draggable ?? false,
        icon: isStoreMarkerIcon(icon) ? getStoreMarkerIcon() : (icon ?? TRANSCHAP_MAP_MARKER_ICON),
      });
    }
    if (canUseAdvancedMarkers) {
      const options: Record<string, unknown> = {
        map,
        position,
        gmpDraggable: draggable ?? false,
      };
      if (isStoreMarkerIcon(icon)) {
        options.content = createStoreMarkerElement();
      }
      return new advancedMarker!(options);
    }
    throw new Error("No supported Google Maps marker implementation is available.");
  };

  return { maps, places, Geocoder, createMarker, requiresMapId };
}

export function createMapWithMarker(
  runtime: GoogleMapsRuntime,
  container: HTMLElement,
  center: LatLng,
  zoom: number,
  draggable = true,
): { map: GoogleMapsMap; marker: GoogleMapsMarker } {
  const map = new runtime.maps.Map(
    container,
    defaultMapOptions(center, zoom, { requiresMapId: runtime.requiresMapId }),
  );
  const marker = runtime.createMarker({ map, position: center, draggable });
  return { map, marker };
}

export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsRuntime> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps can only load in the browser."));
  }
  if (runtimePromise && loadedKey === apiKey) {
    return runtimePromise;
  }

  loadedKey = apiKey;
  runtimePromise = buildRuntime(apiKey).catch((error) => {
    runtimePromise = null;
    loadedKey = null;
    throw error;
  });

  return runtimePromise;
}

export function defaultMapOptions(
  center: LatLng,
  zoom: number,
  options: { requiresMapId?: boolean } = {},
): Record<string, unknown> {
  const mapOptions: Record<string, unknown> = {
    center,
    zoom,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  };

  const cloudMapId = getCloudMapId();
  if (cloudMapId) {
    mapOptions.mapId = cloudMapId;
    return mapOptions;
  }

  mapOptions.styles = TRANSCHAP_MAP_STYLES;
  return mapOptions;
}

function getSessionToken(places: PlacesLibrary): unknown {
  if (!sessionToken) {
    sessionToken = new places.AutocompleteSessionToken();
  }
  return sessionToken;
}

function resetSessionToken(places: PlacesLibrary): void {
  sessionToken = new places.AutocompleteSessionToken();
}

export type GeocodeResult = {
  placeName: string;
  lng: number;
  lat: number;
};

/** Session caches — avoid repeat Geocoding API charges for the same query/coords. */
const forwardGeocodeCache = new Map<string, GeocodeResult | null>();
const reverseGeocodeCache = new Map<string, string | null>();

function normalizeForwardCacheKey(
  query: string,
  options: { country?: string | null; proximity?: LatLng | null },
): string {
  const country = (options.country ?? "").trim().toLowerCase();
  const proximity =
    options.proximity != null
      ? `${options.proximity.lat.toFixed(3)},${options.proximity.lng.toFixed(3)}`
      : "";
  return `${query.trim().toLowerCase()}|${country}|${proximity}`;
}

function reverseCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function geocodePromise(
  geocoder: GoogleMapsGeocoder,
  request: Record<string, unknown>,
): Promise<GoogleGeocodeResult[]> {
  return new Promise((resolve, reject) => {
    geocoder.geocode(request, (results, status) => {
      if (status === "OK" && results?.length) {
        resolve(results);
      } else {
        reject(new Error(status || "Geocoding failed"));
      }
    });
  });
}

/** Forward geocode a free-text query into a place + coordinates. */
export async function forwardGeocode(
  query: string,
  runtime: GoogleMapsRuntime,
  options: { country?: string | null; proximity?: LatLng | null } = {},
): Promise<GeocodeResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const cacheKey = normalizeForwardCacheKey(trimmed, options);
  if (forwardGeocodeCache.has(cacheKey)) {
    return forwardGeocodeCache.get(cacheKey) ?? null;
  }

  const geocoder = new runtime.Geocoder();
  const request: Record<string, unknown> = { address: trimmed };
  if (options.country) {
    request.componentRestrictions = { country: options.country.toLowerCase() };
  }
  if (options.proximity) {
    request.location = options.proximity;
  }

  try {
    const results = await geocodePromise(geocoder, request);
    const hit = results[0];
    const lat = hit.geometry.location.lat();
    const lng = hit.geometry.location.lng();
    const result = { placeName: hit.formatted_address, lat, lng };
    forwardGeocodeCache.set(cacheKey, result);
    reverseGeocodeCache.set(reverseCacheKey(lat, lng), result.placeName);
    return result;
  } catch {
    forwardGeocodeCache.set(cacheKey, null);
    return null;
  }
}

/** Reverse geocode coordinates into a human-readable place name. */
export async function reverseGeocode(
  lng: number,
  lat: number,
  runtime: GoogleMapsRuntime,
): Promise<string | null> {
  const cacheKey = reverseCacheKey(lat, lng);
  if (reverseGeocodeCache.has(cacheKey)) {
    return reverseGeocodeCache.get(cacheKey) ?? null;
  }

  const geocoder = new runtime.Geocoder();
  try {
    const results = await geocodePromise(geocoder, { location: { lat, lng } });
    const place = results[0]?.formatted_address ?? null;
    reverseGeocodeCache.set(cacheKey, place);
    return place;
  } catch {
    reverseGeocodeCache.set(cacheKey, null);
    return null;
  }
}

export function setMarkerPosition(marker: GoogleMapsMarker, position: LatLng): void {
  if (typeof marker.setPosition === "function") {
    marker.setPosition(position);
    return;
  }
  marker.position = position;
}

export function latLngFromMarker(marker: GoogleMapsMarker): LatLng | null {
  if (typeof marker.getPosition === "function") {
    const pos = marker.getPosition();
    if (!pos) return null;
    return { lat: pos.lat(), lng: pos.lng() };
  }
  if (marker.position) {
    return { lat: marker.position.lat, lng: marker.position.lng };
  }
  return null;
}

export function flyTo(map: GoogleMapsMap, center: LatLng, zoom: number): void {
  map.setCenter(center);
  map.setZoom(zoom);
}

export function triggerMapResize(map: GoogleMapsMap): void {
  const eventApi = (
    window.google?.maps as { event?: { trigger: (target: unknown, name: string) => void } }
  )?.event;
  eventApi?.trigger(map, "resize");
}

function clampMapZoom(map: GoogleMapsMap, maxZoom: number): void {
  const getZoom = (map as { getZoom?: () => number | undefined }).getZoom;
  const currentZoom = getZoom?.();
  if (currentZoom != null && currentZoom > maxZoom) {
    map.setZoom(maxZoom);
  }
}

/** Pan/zoom the map to show every plotted position. */
export async function fitMapToPositions(
  map: GoogleMapsMap,
  positions: LatLng[],
  options: {
    padding?: number;
    singleZoom?: number;
    fixedZoom?: number;
    maxZoom?: number;
    fallbackCenter?: LatLng;
    fallbackZoom?: number;
  } = {},
): Promise<void> {
  const padding = options.padding ?? 56;
  const singleZoom = options.singleZoom ?? 15;
  const maxZoom = options.maxZoom;

  triggerMapResize(map);

  if (positions.length === 0) {
    if (options.fallbackCenter) {
      map.setCenter(options.fallbackCenter);
      map.setZoom(options.fallbackZoom ?? 11);
    }
    return;
  }

  if (positions.length === 1) {
    map.setCenter(positions[0]);
    map.setZoom(maxZoom != null ? Math.min(singleZoom, maxZoom) : singleZoom);
    return;
  }

  if (options.fixedZoom != null) {
    const lats = positions.map((p) => p.lat);
    const lngs = positions.map((p) => p.lng);
    map.setCenter({
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    });
    map.setZoom(maxZoom != null ? Math.min(options.fixedZoom, maxZoom) : options.fixedZoom);
    return;
  }

  const fitBounds = (map as GoogleMapsMap & { fitBounds?: (bounds: unknown, padding?: number | Record<string, number>) => void })
    .fitBounds;

  if (window.google?.maps?.importLibrary && fitBounds) {
    try {
      const coreLib = (await window.google.maps.importLibrary("core")) as {
        LatLng: new (lat: number, lng: number) => unknown;
        LatLngBounds: new () => { extend: (point: unknown) => void };
      };
      const bounds = new coreLib.LatLngBounds();
      positions.forEach((position) => {
        bounds.extend(new coreLib.LatLng(position.lat, position.lng));
      });
      fitBounds(bounds, { top: padding, right: padding, bottom: padding, left: padding });

      if (maxZoom != null) {
        const eventApi = (
          window.google?.maps as { event?: { addListenerOnce: (target: unknown, name: string, handler: () => void) => void } }
        )?.event;
        if (eventApi?.addListenerOnce) {
          eventApi.addListenerOnce(map, "idle", () => clampMapZoom(map, maxZoom));
        } else {
          clampMapZoom(map, maxZoom);
        }
      }
      return;
    } catch {
      // Fall through to manual center/zoom.
    }
  }

  const lats = positions.map((p) => p.lat);
  const lngs = positions.map((p) => p.lng);
  map.setCenter({
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  });
  const fallbackZoom = options.fallbackZoom ?? 11;
  map.setZoom(maxZoom != null ? Math.min(fallbackZoom, maxZoom) : fallbackZoom);
}

const MIN_AUTOCOMPLETE_CHARS = 3;

const COORDINATE_LIKE_PATTERN = /^-?\d+(?:\.\d+)?\s*[, ]\s*-?\d+(?:\.\d+)?$/;

/** True when text is only a lat/lng pair (not a street address). */
export function isCoordinateLikeText(text: string): boolean {
  return COORDINATE_LIKE_PATTERN.test(text.trim());
}

/** Parse "lat, lng" or "lat lng" from user input. */
export function parseCoordinateQuery(text: string): LatLng | null {
  const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Label shown in autocomplete (matches the dropdown row, not formattedAddress). */
export function placePredictionDisplayName(prediction: PlacePrediction): string {
  const main = prediction.mainText.trim();
  const secondary = prediction.secondaryText.trim();
  if (main && secondary) return `${main}, ${secondary}`;
  if (main) return main;
  return prediction.description.trim();
}

function readFormattableText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const formatted = value as { text?: string; toString?: () => string };
    if (typeof formatted.text === "string") return formatted.text;
    if (typeof formatted.toString === "function") return formatted.toString();
  }
  return String(value);
}

function readLatLng(
  location: PlaceSource["location"],
): { lat: number; lng: number } | null {
  if (!location) return null;
  if (typeof (location as { lat: () => number }).lat === "function") {
    const loc = location as { lat: () => number; lng: () => number };
    return { lat: loc.lat(), lng: loc.lng() };
  }
  const loc = location as LatLng;
  return { lat: loc.lat, lng: loc.lng };
}

/** Fetch place suggestions via Places API (New). */
export async function fetchPlacePredictions(
  query: string,
  runtime: GoogleMapsRuntime,
  options: { country?: string | null; proximity?: LatLng | null } = {},
): Promise<PlacePrediction[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_AUTOCOMPLETE_CHARS) return [];

  const request: Record<string, unknown> = {
    input: trimmed,
    sessionToken: getSessionToken(runtime.places),
    language: "en",
  };

  if (options.country) {
    request.includedRegionCodes = [options.country.toUpperCase()];
  }
  if (options.proximity) {
    // JS AutocompleteRequest expects CircleLiteral, not REST's { circle: { ... } }.
    request.locationBias = {
      center: { lat: options.proximity.lat, lng: options.proximity.lng },
      radius: 50_000,
    };
  }

  try {
    const { suggestions } =
      await runtime.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);

    return suggestions
      .map((item) => item.placePrediction)
      .filter((item): item is PlacePredictionSource => Boolean(item))
      .map((prediction) => {
        const description = readFormattableText(prediction.text);
        const mainText =
          readFormattableText(prediction.mainText) || description;
        const secondaryText = readFormattableText(prediction.secondaryText);
        return {
          placeId: prediction.placeId,
          description,
          mainText,
          secondaryText,
          source: prediction,
        };
      })
      .filter((prediction) => {
        const label = placePredictionDisplayName(prediction);
        return !isCoordinateLikeText(label) && !isCoordinateLikeText(prediction.mainText);
      });
  } catch (error) {
    console.error("Google Places autocomplete failed:", error);
    return [];
  }
}

/** Resolve a Places API (New) prediction into coordinates. */
export async function resolvePlacePrediction(
  prediction: PlacePrediction,
  runtime: GoogleMapsRuntime,
): Promise<GeocodeResult | null> {
  try {
    const place = prediction.source.toPlace();
    await place.fetchFields({ fields: ["formattedAddress", "location"] });
    resetSessionToken(runtime.places);

    const coords = readLatLng(place.location);
    if (!coords) return null;

    return {
      placeName: place.formattedAddress ?? "",
      lat: coords.lat,
      lng: coords.lng,
    };
  } catch {
    return null;
  }
}

export { MIN_AUTOCOMPLETE_CHARS };
