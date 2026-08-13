import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ExpandMapButton } from '@/src/components/ExpandMapButton';
import { DUKAI_MAP_COLORS } from '@/src/map/brandStyle';
import { WebBrandedMap } from '@/src/map/WebBrandedMap';
import type { MapVariant } from '@/src/map/tripLocations';

export type RiderMapProps = {
  variant?: MapVariant;
  showExpand?: boolean;
  interactive?: boolean;
  simulateRide?: boolean;
  navGuide?: boolean;
};

/** Web build — never imports `react-native-maps` (avoids native Fabric specs). */
export function RiderMap({
  variant = 'idle',
  showExpand = true,
  interactive = false,
  simulateRide,
  navGuide: _navGuide,
}: RiderMapProps) {
  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: DUKAI_MAP_COLORS.surface,
          overflow: 'hidden',
        },
      }),
    [],
  );

  return (
    <View style={styles.root}>
      <WebBrandedMap
        variant={variant}
        interactive={interactive}
        simulateRide={simulateRide}
      />
      {showExpand ? <ExpandMapButton variant={variant} /> : null}
    </View>
  );
}
