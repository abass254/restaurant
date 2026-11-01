import { createElement, useEffect, useId, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { TRANSCHAP_MAP_COLORS, TRANSCHAP_MAP_STYLES } from '@/src/map/brandStyle';
import { getGoogleMapsApiKey, getGoogleMapsMapId } from '@/src/map/config';
import { fetchRoutePath, routeLegForVariant } from '@/src/map/directions';
import { pathLengthMeters, pointAlongPath } from '@/src/map/pathMath';
import { focusForVariant, type MapVariant } from '@/src/map/tripLocations';

type Props = {
  variant: MapVariant;
  interactive?: boolean;
  simulateRide?: boolean;
};

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if ((globalThis as { google?: { maps?: unknown } }).google?.maps) {
    return Promise.resolve();
  }
  const g = globalThis as { __TransChapMapsReady?: Promise<void> };
  if (g.__TransChapMapsReady) return g.__TransChapMapsReady;

  g.__TransChapMapsReady = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-TransChap-maps="true"]',
    );
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Maps failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.dataset.TransChapMaps = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Maps failed'));
    document.head.appendChild(script);
  });

  return g.__TransChapMapsReady;
}

/** Web map using TransChap JSON styles + real driving directions + ride simulation. */
export function WebBrandedMap({
  variant,
  interactive = false,
  simulateRide = false,
}: Props) {
  const hostId = `TransChap-map-${useId().replace(/:/g, '')}`;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const focus = useMemo(() => focusForVariant(variant), [variant]);
  const apiKey = getGoogleMapsApiKey();
  const mapId = getGoogleMapsMapId();
  const shouldSimulate = simulateRide === true;

  useEffect(() => {
    if (Platform.OS !== 'web' || !apiKey) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    (async () => {
      try {
        await loadGoogleMaps(apiKey);
        if (cancelled) return;

        const g = (globalThis as {
          google?: {
            maps: {
              Map: new (el: HTMLElement, opts: Record<string, unknown>) => {
                fitBounds: (b: unknown, padding?: number) => void;
                panTo: (p: { lat: number; lng: number }) => void;
              };
              Marker: new (opts: Record<string, unknown>) => {
                setMap: (m: null) => void;
                setPosition: (p: { lat: number; lng: number }) => void;
              };
              Polyline: new (opts: Record<string, unknown>) => { setMap: (m: null) => void };
              LatLngBounds: new () => {
                extend: (p: { lat: number; lng: number }) => void;
              };
              SymbolPath: { CIRCLE: unknown };
            };
          };
        }).google;
        if (!g?.maps) return;

        const el =
          hostRef.current ??
          (typeof document !== 'undefined' ? document.getElementById(hostId) : null);
        if (!el) return;

        const map = new g.maps.Map(el as HTMLElement, {
          center: {
            lat: focus.center.latitude,
            lng: focus.center.longitude,
          },
          zoom: variant === 'idle' ? 13 : 14,
          disableDefaultUI: true,
          gestureHandling: interactive ? 'greedy' : 'none',
          ...(mapId ? { mapId } : { styles: TRANSCHAP_MAP_STYLES }),
        });

        const pins = shouldSimulate
          ? focus.pins.filter((p) => p.kind !== 'rider')
          : focus.pins;

        for (const pin of pins) {
          const color =
            pin.kind === 'rider' ? '#6b2e14' : pin.kind === 'store' ? '#855538' : '#3d2418';
          const marker = new g.maps.Marker({
            map,
            position: {
              lat: pin.coord.latitude,
              lng: pin.coord.longitude,
            },
            icon: {
              path: g.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: color,
              fillOpacity: 1,
              strokeColor: '#faf8f4',
              strokeWeight: 2,
            },
          });
          cleanups.push(() => marker.setMap(null));
        }

        const startPin = focus.pins.find((p) => p.kind === 'rider') ?? focus.pins[0];
        const rider = new g.maps.Marker({
          map,
          position: {
            lat: startPin.coord.latitude,
            lng: startPin.coord.longitude,
          },
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 11,
            fillColor: '#6b2e14',
            fillOpacity: 1,
            strokeColor: '#fff8f0',
            strokeWeight: 3,
          },
        });
        cleanups.push(() => rider.setMap(null));

        const leg = routeLegForVariant(variant);
        if (leg) {
          const path = await fetchRoutePath(leg.origin, leg.destination);
          if (cancelled || path.length < 2) return;

          const polyline = new g.maps.Polyline({
            map,
            path: path.map((p) => ({ lat: p.latitude, lng: p.longitude })),
            geodesic: true,
            strokeColor: TRANSCHAP_MAP_COLORS.primary,
            strokeOpacity: 0.92,
            strokeWeight: 5,
          });
          cleanups.push(() => polyline.setMap(null));

          const bounds = new g.maps.LatLngBounds();
          path.forEach((p) => bounds.extend({ lat: p.latitude, lng: p.longitude }));
          map.fitBounds(bounds, 48);

          if (shouldSimulate && pathLengthMeters(path) > 0) {
            let t = 0;
            let dir = 1;
            const timer = setInterval(() => {
              t += 0.004 * dir;
              if (t >= 1) {
                t = 1;
                dir = -1;
              }
              if (t <= 0) {
                t = 0;
                dir = 1;
              }
              const pos = pointAlongPath(path, t);
              rider.setPosition({ lat: pos.latitude, lng: pos.longitude });
              if (!interactive) map.panTo({ lat: pos.latitude, lng: pos.longitude });
            }, 80);
            cleanups.push(() => clearInterval(timer));
          }
        }
      } catch {
        // Leave branded cream surface
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [apiKey, focus, hostId, interactive, mapId, shouldSimulate, variant]);

  if (Platform.OS !== 'web') return null;

  if (!apiKey) {
    return <View style={styles.fallback} />;
  }

  return (
    <View style={styles.root}>
      {createElement('div', {
        id: hostId,
        ref: hostRef,
        style: { width: '100%', height: '100%' },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fallback: { flex: 1, backgroundColor: '#f3efe8' },
});
