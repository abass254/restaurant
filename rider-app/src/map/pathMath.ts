import type { LatLng } from '@/src/map/tripLocations';

/** Distance in meters (approx, haversine-lite for Nairobi-scale legs). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function pathLengthMeters(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += distanceMeters(path[i - 1], path[i]);
  }
  return total;
}

/** Point at fraction t ∈ [0, 1] along a polyline. */
export function pointAlongPath(path: LatLng[], t: number): LatLng {
  if (path.length === 0) return { latitude: 0, longitude: 0 };
  if (path.length === 1) return path[0];
  const clamped = Math.max(0, Math.min(1, t));
  const total = pathLengthMeters(path);
  if (total <= 0) return path[0];
  let remain = total * clamped;
  for (let i = 1; i < path.length; i++) {
    const seg = distanceMeters(path[i - 1], path[i]);
    if (remain <= seg || i === path.length - 1) {
      const ratio = seg > 0 ? remain / seg : 0;
      return {
        latitude: path[i - 1].latitude + (path[i].latitude - path[i - 1].latitude) * ratio,
        longitude:
          path[i - 1].longitude + (path[i].longitude - path[i - 1].longitude) * ratio,
      };
    }
    remain -= seg;
  }
  return path[path.length - 1];
}

export function formatDistanceKm(meters: number): string {
  const km = meters / 1000;
  if (km < 0.1) return `${Math.round(meters)} m`;
  return `${km.toFixed(1)} km`;
}
