import { ReactNode, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { RiderMap } from '@/src/components/RiderMap';
import { CollapsibleTripSheet } from '@/src/components/CollapsibleTripSheet';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import { TextButton } from '@/src/components/TextButton';
import type { MapVariant } from '@/src/map/tripLocations';
import { useTheme } from '@/src/ThemeContext';

type Props = {
  stageTitle: string;
  subtitle?: string;
  mapVariant?: MapVariant;
  children: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  tertiaryLabel?: string;
  onTertiary?: () => void;
};

export function TripStageLayout({
  stageTitle,
  subtitle,
  mapVariant = 'store',
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  secondaryLabel,
  onSecondary,
  tertiaryLabel,
  onTertiary,
}: Props) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: colors.map },
        mapWrap: {
          ...StyleSheet.absoluteFill,
        },
      }),
    [colors.map],
  );

  return (
    <View style={styles.root}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.mapWrap}>
        <RiderMap variant={mapVariant} showExpand />
      </View>
      <CollapsibleTripSheet
        title={stageTitle}
        subtitle={subtitle}
        footer={
          <>
            {tertiaryLabel && onTertiary ? (
              <TextButton label={tertiaryLabel} onPress={onTertiary} />
            ) : null}
            {secondaryLabel && onSecondary ? (
              <TextButton label={secondaryLabel} onPress={onSecondary} />
            ) : null}
            <PrimaryButton
              label={primaryLabel}
              onPress={onPrimary}
              disabled={primaryDisabled}
            />
          </>
        }
      >
        {children}
      </CollapsibleTripSheet>
    </View>
  );
}
