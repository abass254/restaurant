import type { GeocodeResult, LatLng, MapViewConfig, PlaceSuggestion } from "./types";

const PHOTON_BASE = "https://photon.komoot.io/api/";
const PHOTON_REVERSE = "https://photon.komoot.io/reverse";

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
};

function featureLabel(feature: PhotonFeature): string {
  const props = feature.properties ?? {};
  const parts = [
    props.name,
    props.street,
    props.housenumber,
    props.city ?? props.locality,
    props.state,
    props.country,
  ]
    .map((part) => (part ?? "").trim())
    .filter(Boolean);
  return [...new Set(parts)].join(", ");
}

function featureMainSecondary(feature: PhotonFeature): { mainText: string; secondaryText: string } {
  const props = feature.properties ?? {};
  const mainText = [props.name, props.street].filter(Boolean).join(" ") || featureLabel(feature);
  const secondaryText = [props.city ?? props.locality, props.state, props.country]
    .filter(Boolean)
    .join(", ");
  return { mainText, secondaryText };
}

export async function fetchPlaceSuggestions(
  query: string,
  config: MapViewConfig,
): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    q: trimmed,
    limit: "6",
    lang: "en",
  });
  if (config.default_center_lat != null && config.default_center_lng != null) {
    params.set("lat", String(config.default_center_lat));
    params.set("lon", String(config.default_center_lng));
  }

  const res = await fetch(`${PHOTON_BASE}?${params.toString()}`);
  if (!res.ok) return [];

  const data = (await res.json()) as { features?: PhotonFeature[] };
  return (data.features ?? [])
    .map((feature, index) => {
      const coords = feature.geometry?.coordinates;
      if (!coords) return null;
      const [lng, lat] = coords;
      const placeName = featureLabel(feature) || trimmed;
      const { mainText, secondaryText } = featureMainSecondary(feature);
      return {
        id: `${lng},${lat},${index}`,
        placeName,
        mainText,
        secondaryText,
        lat,
        lng,
      };
    })
    .filter((item): item is PlaceSuggestion => item != null);
}

export async function forwardGeocode(
  query: string,
  config: MapViewConfig,
): Promise<GeocodeResult | null> {
  const suggestions = await fetchPlaceSuggestions(query, config);
  const hit = suggestions[0];
  if (!hit) return null;
  return { placeName: hit.placeName, lat: hit.lat, lng: hit.lng };
}

export async function reverseGeocode(lng: number, lat: number): Promise<string | null> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    limit: "1",
    lang: "en",
  });
  const res = await fetch(`${PHOTON_REVERSE}?${params.toString()}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { features?: PhotonFeature[] };
  const feature = data.features?.[0];
  if (!feature) return null;
  return featureLabel(feature) || null;
}

export function parseCoordinateQuery(raw: string): LatLng | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
