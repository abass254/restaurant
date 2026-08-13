import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { ExpandMapButton } from '@/src/components/ExpandMapButton';
import { DUKAI_MAP_COLORS } from '@/src/map/brandStyle';
import { NativeWebMap } from '@/src/map/NativeWebMap';
import { type MapVariant } from '@/src/map/tripLocations';
import { useDirectionsPath } from '@/src/map/useDirectionsPath';
import { fonts } from '@/src/theme';

export type RiderMapProps = {
  variant?: MapVariant;
  showExpand?: boolean;
  interactive?: boolean;
  /** Animate rider along the route (opt-in; used by Navigate → Simulate). */
  simulateRide?: boolean;
  /** Street-level zoomed navigation guide. */
  navGuide?: boolean;
};

/** Built-in map (Leaflet + OSM) — works in Expo Go without a Google Maps key. */
export function RiderMap({
  variant = 'idle',
  showExpand = true,
  interactive = false,
  simulateRide,
  navGuide,
}: RiderMapProps) {
  const { path } = useDirectionsPath(variant);
  const [loaded, setLoaded] = useState(false);
  const shouldSimulate = simulateRide === true;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          minHeight: 180,
          backgroundColor: DUKAI_MAP_COLORS.cream100,
          overflow: 'hidden',
        },
        loading: {
          ...StyleSheet.absoluteFill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: DUKAI_MAP_COLORS.cream100,
          gap: 10,
          zIndex: 1,
        },
        loadingText: {
          fontFamily: fonts.sans,
          fontSize: 13,
          color: DUKAI_MAP_COLORS.textMuted,
        },
      }),
    [],
  );

  return (
    <View style={styles.root}>
      <NativeWebMap
        variant={variant}
        path={path}
        interactive={interactive}
        simulateRide={shouldSimulate}
        navGuide={navGuide === true}
        onLoad={() => setLoaded(true)}
      />
      {!loaded ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={DUKAI_MAP_COLORS.primary} />
          <Text style={styles.loadingText}>Loading map…</Text>
        </View>
      ) : null}
      {showExpand ? <ExpandMapButton variant={variant} /> : null}
    </View>
  );
}
