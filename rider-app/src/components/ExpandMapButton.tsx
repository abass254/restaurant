import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MapVariant } from '@/src/map/tripLocations';
import { fonts, radius, spacing } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

/** Opens the in-app Navigate guide for the current trip leg. */
export function ExpandMapButton({ variant }: { variant: MapVariant }) {
  const insets = useSafeAreaInsets();
  const { colors, shadow } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        expand: {
          position: 'absolute',
          top: Math.max(insets.top, spacing.sm) + spacing.sm,
          right: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: colors.surface,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: radius.cta,
          ...shadow.card,
        } as ViewStyle,
        expandLabel: {
          fontFamily: fonts.sansSemi,
          fontSize: 13,
          color: colors.text,
        } as TextStyle,
      }),
    [colors.surface, colors.text, insets.top, shadow.card],
  );

  return (
    <Pressable
      style={styles.expand as StyleProp<ViewStyle>}
      onPress={() =>
        router.push({ pathname: '/map-full', params: { variant, mode: 'navigate' } })
      }
      accessibilityRole="button"
      accessibilityLabel="Navigate"
    >
      <Ionicons name="navigate" size={16} color={colors.text} />
      <Text style={styles.expandLabel}>Navigate</Text>
    </Pressable>
  );
}
