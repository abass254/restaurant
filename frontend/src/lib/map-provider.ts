import type { GoogleMapsPublicConfig } from "@/lib/types";
import { FALLBACK_CENTER, type MapViewConfig } from "@/lib/open-map";

export type MapProvider = "google" | "open";

export function resolveMapProvider(
  googleConfig: GoogleMapsPublicConfig | null,
): MapProvider {
  const forced = (process.env.NEXT_PUBLIC_MAP_PROVIDER ?? "").trim().toLowerCase();
  if (forced === "google") {
    return googleConfig?.api_key ? "google" : "open";
  }
  if (forced === "open") return "open";
  // Default: open-source stack (MapLibre + Photon + OSRM) — no Google billing required.
  return "open";
}

export function mapViewConfigFromGoogle(
  googleConfig: GoogleMapsPublicConfig | null,
): MapViewConfig {
  return {
    default_center_lat: googleConfig?.default_center_lat ?? FALLBACK_CENTER.lat,
    default_center_lng: googleConfig?.default_center_lng ?? FALLBACK_CENTER.lng,
    default_zoom: googleConfig?.default_zoom ?? 11,
    default_country: googleConfig?.default_country ?? "ke",
  };
}

export function isMapUiEnabled(
  provider: MapProvider,
  googleConfig: GoogleMapsPublicConfig | null,
): boolean {
  if (provider === "open") return true;
  return Boolean(googleConfig?.api_key);
}
