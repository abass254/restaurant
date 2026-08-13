import type { LatLng } from "./google-maps";

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Straight-line distance between two coordinates (km). */
export function haversineDistanceKm(from: LatLng, to: LatLng): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function deliveryFeeFromDistanceKm(distanceKm: number, ratePerKm: number): number {
  if (!Number.isFinite(distanceKm) || !Number.isFinite(ratePerKm) || ratePerKm < 0) {
    return 0;
  }
  return Math.round(distanceKm * ratePerKm * 100) / 100;
}
