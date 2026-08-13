import type { LatLng, MapVariant } from '@/src/map/tripLocations';
import { distanceMeters, pathLengthMeters, pointAlongPath } from '@/src/map/pathMath';
import { mockTrip } from '@/src/data/mockTrip';

export type NavManeuver = {
  icon: 'left' | 'right' | 'straight' | 'arrive';
  distanceLabel: string;
  street: string;
};

export type NavGuidance = {
  current: NavManeuver;
  next: NavManeuver | null;
  etaMin: number;
  distanceLabel: string;
  arrivalLabel: string;
  destinationName: string;
};

function bearingDeg(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a.latitude);
  const φ2 = toRad(b.latitude);
  const Δλ = toRad(b.longitude - a.longitude);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function turnFromBearings(from: number, to: number): 'left' | 'right' | 'straight' {
  let delta = ((to - from + 540) % 360) - 180;
  if (Math.abs(delta) < 25) return 'straight';
  return delta > 0 ? 'right' : 'left';
}

function formatMeters(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.max(10, Math.round(m / 10) * 10)} m`;
}

function streetsFor(variant: MapVariant): { primary: string; secondary: string; arrive: string } {
  if (variant === 'customer') {
    return {
      primary: 'Rose Ave',
      secondary: 'Kilimani Rd',
      arrive: mockTrip.customer.name,
    };
  }
  return {
    primary: 'Ngong Rd',
    secondary: 'Lenana Rd',
    arrive: mockTrip.store.name,
  };
}

/** Demo turn-by-turn guidance driven by progress along the polyline. */
export function guidanceAlongRoute(
  variant: MapVariant,
  path: LatLng[],
  progress: number,
): NavGuidance {
  const streets = streetsFor(variant);
  const total = path.length >= 2 ? pathLengthMeters(path) : mockTrip.distanceKm * 1000;
  const remaining = Math.max(0, total * (1 - progress));
  const etaMin = Math.max(1, Math.ceil((remaining / 1000) * 3.5));

  const arrive = new Date(Date.now() + etaMin * 60_000);
  const arrivalLabel = arrive.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let current: NavManeuver;
  let next: NavManeuver | null;

  if (progress >= 0.92 || remaining < 80) {
    current = {
      icon: 'arrive',
      distanceLabel: formatMeters(remaining),
      street: streets.arrive,
    };
    next = null;
  } else if (progress < 0.45) {
    const toTurn = Math.max(40, remaining * 0.35);
    current = {
      icon: path.length >= 3 ? inferFirstTurn(path) : 'left',
      distanceLabel: formatMeters(toTurn),
      street: streets.primary,
    };
    next = {
      icon: 'right',
      distanceLabel: formatMeters(Math.max(60, remaining * 0.25)),
      street: streets.secondary,
    };
  } else {
    current = {
      icon: 'straight',
      distanceLabel: formatMeters(Math.max(50, remaining * 0.55)),
      street: streets.primary,
    };
    next = {
      icon: 'arrive',
      distanceLabel: formatMeters(Math.max(40, remaining * 0.35)),
      street: streets.arrive,
    };
  }

  return {
    current,
    next,
    etaMin,
    distanceLabel: formatMeters(remaining),
    arrivalLabel,
    destinationName: streets.arrive,
  };
}

function inferFirstTurn(path: LatLng[]): 'left' | 'right' | 'straight' {
  if (path.length < 3) return 'left';
  const mid = Math.min(4, path.length - 1);
  const b0 = bearingDeg(path[0], path[1]);
  const b1 = bearingDeg(path[mid - 1], path[mid]);
  return turnFromBearings(b0, b1);
}

export function bearingAtProgress(path: LatLng[], progress: number): number {
  if (path.length < 2) return 0;
  const here = pointAlongPath(path, progress);
  const ahead = pointAlongPath(path, Math.min(1, progress + 0.02));
  if (distanceMeters(here, ahead) < 1) {
    const i = Math.max(1, Math.floor((path.length - 1) * progress));
    return bearingDeg(path[i - 1], path[i]);
  }
  return bearingDeg(here, ahead);
}
