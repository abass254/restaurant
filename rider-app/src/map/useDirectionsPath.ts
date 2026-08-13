import { useEffect, useState } from 'react';
import {
  fetchRoutePath,
  routeLegForVariant,
} from '@/src/map/directions';
import type { LatLng, MapVariant } from '@/src/map/tripLocations';

/** Loads a directions polyline for the active trip stage. */
export function useDirectionsPath(variant: MapVariant): {
  path: LatLng[];
  loading: boolean;
} {
  const [path, setPath] = useState<LatLng[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const leg = routeLegForVariant(variant);
    if (!leg) {
      setPath([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    // Show a temporary straight path immediately, then refine
    setPath([leg.origin, leg.destination]);

    void fetchRoutePath(leg.origin, leg.destination)
      .then((coords) => {
        if (!cancelled) setPath(coords);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [variant]);

  return { path, loading };
}
