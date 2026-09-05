export type LatLng = { lat: number; lng: number };

export type MapViewConfig = {
  default_center_lat: number | null;
  default_center_lng: number | null;
  default_zoom: number | null;
  default_country: string | null;
};

export type GeocodeResult = {
  placeName: string;
  lat: number;
  lng: number;
};

export type PlaceSuggestion = {
  id: string;
  placeName: string;
  mainText: string;
  secondaryText: string;
  lat: number;
  lng: number;
};

export type RoadRouteResult = {
  distanceKm: number;
  durationMinutes: number | null;
  path: LatLng[];
  source: "osrm";
};

export const OPEN_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
export const FALLBACK_CENTER: LatLng = { lat: -1.2921, lng: 36.8219 };
export const MIN_AUTOCOMPLETE_CHARS = 3;
