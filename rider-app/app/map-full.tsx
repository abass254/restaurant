import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NavigateWebMap } from '@/src/map/NavigateWebMap';
import { bearingAtProgress, guidanceAlongRoute } from '@/src/map/navGuidance';
import { useDirectionsPath } from '@/src/map/useDirectionsPath';
import type { MapVariant } from '@/src/map/tripLocations';
import { useTheme } from '@/src/ThemeContext';
import { fonts, radius, spacing } from '@/src/theme';

function parseVariant(raw: string | string[] | undefined): MapVariant {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === 'store' || v === 'customer' || v === 'idle') return v;
  return 'store';
}

function ManeuverIcon({
  kind,
  size = 36,
  color,
}: {
  kind: 'left' | 'right' | 'straight' | 'arrive';
  size?: number;
  color: string;
}) {
  const name =
    kind === 'left'
      ? 'arrow-back'
      : kind === 'right'
        ? 'arrow-forward'
        : kind === 'arrive'
          ? 'flag'
          : 'arrow-up';
  return <Ionicons name={name} size={size} color={color} />;
}

/** DukAI-branded navigation: cream/olive light + deep olive dark. */
export default function NavigateScreen() {
  const insets = useSafeAreaInsets();
  const { variant: raw } = useLocalSearchParams<{ variant?: string }>();
  const variant = parseVariant(raw);
  const { colors, isDark, toggleScheme } = useTheme();
  const { path } = useDirectionsPath(variant);
  const [progress, setProgress] = useState(0.02);
  const [muted, setMuted] = useState(true);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (path.length < 2) return;
    const id = setInterval(() => {
      setProgress((p) => {
        const next = p + 0.0035;
        return next >= 0.98 ? 0.02 : next;
      });
    }, 120);
    return () => clearInterval(id);
  }, [path.length]);

  const bearing = useMemo(
    () => (path.length >= 2 ? bearingAtProgress(path, progress) : 0),
    [path, progress],
  );
  const guide = useMemo(
    () => guidanceAlongRoute(variant, path, progress),
    [variant, path, progress],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: colors.map },
        topBanner: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 3,
          paddingTop: insets.top + spacing.sm,
          paddingHorizontal: spacing.md,
          paddingBottom: spacing.md,
          backgroundColor: colors.primary,
          gap: spacing.sm,
        },
        primaryRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
        },
        turnBlock: {
          width: 56,
          alignItems: 'center',
          justifyContent: 'center',
        },
        primaryCopy: { flex: 1 },
        distance: {
          fontFamily: fonts.sansSemi,
          fontSize: 17,
          color: isDark ? 'rgba(18,20,16,0.78)' : 'rgba(255,255,255,0.88)',
        },
        street: {
          fontFamily: fonts.display,
          fontSize: 28,
          color: isDark ? colors.bg : '#FFFFFF',
          marginTop: 2,
        },
        iconBtn: {
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: isDark ? 'rgba(18,20,16,0.18)' : 'rgba(255,255,255,0.18)',
          alignItems: 'center',
          justifyContent: 'center',
        },
        thenRow: {
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: isDark ? 'rgba(18,20,16,0.22)' : 'rgba(0,0,0,0.18)',
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 10,
        },
        thenLabel: {
          fontFamily: fonts.sans,
          fontSize: 12,
          color: isDark ? 'rgba(18,20,16,0.7)' : 'rgba(255,255,255,0.72)',
        },
        thenStreet: {
          fontFamily: fonts.sansSemi,
          fontSize: 14,
          color: isDark ? colors.bg : '#FFFFFF',
        },
        sideStack: {
          position: 'absolute',
          right: spacing.md,
          top: insets.top + 150,
          zIndex: 3,
          gap: 10,
        },
        sideBtn: {
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.border,
        },
        bottomBar: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 3,
          backgroundColor: colors.surface,
          paddingTop: spacing.md,
          paddingBottom: Math.max(insets.bottom, spacing.md),
          paddingHorizontal: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
        exitBtn: {
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        },
        stats: {
          flex: 1,
          alignItems: 'center',
        },
        eta: {
          fontFamily: fonts.display,
          fontSize: 30,
          color: colors.primary,
          lineHeight: 34,
        },
        meta: {
          fontFamily: fonts.sans,
          fontSize: 15,
          color: colors.muted,
          marginTop: 2,
        },
        altBtn: {
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        },
        speedBubble: {
          position: 'absolute',
          left: spacing.md,
          bottom: Math.max(insets.bottom, spacing.md) + 76,
          zIndex: 3,
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: colors.surface,
          borderWidth: 2,
          borderColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
        },
        speedValue: {
          fontFamily: fonts.sansSemi,
          fontSize: 16,
          color: colors.text,
        },
        speedUnit: {
          fontFamily: fonts.sans,
          fontSize: 10,
          color: colors.muted,
        },
        gpsPill: {
          position: 'absolute',
          alignSelf: 'center',
          bottom: Math.max(insets.bottom, spacing.md) + 86,
          zIndex: 3,
          backgroundColor: colors.surfaceMuted,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: radius.cta,
          borderWidth: 1,
          borderColor: colors.border,
        },
        gpsText: {
          fontFamily: fonts.sans,
          fontSize: 12,
          color: colors.muted,
        },
      }),
    [colors, insets.bottom, insets.top, isDark],
  );

  const onBanner = isDark ? colors.bg : '#FFFFFF';

  return (
    <View style={styles.root}>
      <NavigateWebMap
        key={isDark ? 'dark' : 'light'}
        path={path}
        progress={progress}
        bearing={bearing}
        scheme={isDark ? 'dark' : 'light'}
        onReady={() => setMapReady(true)}
      />

      <View style={styles.topBanner}>
        <View style={styles.primaryRow}>
          <View style={styles.turnBlock}>
            <ManeuverIcon kind={guide.current.icon} size={40} color={onBanner} />
          </View>
          <View style={styles.primaryCopy}>
            <Text style={styles.distance}>{guide.current.distanceLabel}</Text>
            <Text style={styles.street} numberOfLines={1}>
              {guide.current.street}
            </Text>
          </View>
          <Pressable
            style={styles.iconBtn}
            onPress={toggleScheme}
            accessibilityLabel={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <Ionicons
              name={isDark ? 'sunny-outline' : 'moon-outline'}
              size={20}
              color={onBanner}
            />
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={() => setMuted((m) => !m)}
            accessibilityLabel={muted ? 'Unmute voice' : 'Mute voice'}
          >
            <Ionicons name={muted ? 'mic-off' : 'mic'} size={20} color={onBanner} />
          </Pressable>
        </View>

        {guide.next ? (
          <View style={styles.thenRow}>
            <Text style={styles.thenLabel}>Then</Text>
            <ManeuverIcon kind={guide.next.icon} size={16} color={onBanner} />
            <Text style={styles.thenStreet} numberOfLines={1}>
              {guide.next.street}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.sideStack} pointerEvents="box-none">
        <Pressable style={styles.sideBtn} accessibilityLabel="Compass">
          <Ionicons name="compass-outline" size={22} color={colors.text} />
        </Pressable>
        <Pressable style={styles.sideBtn} accessibilityLabel="Search along route">
          <Ionicons name="search" size={20} color={colors.text} />
        </Pressable>
        <Pressable
          style={styles.sideBtn}
          onPress={() => setMuted((m) => !m)}
          accessibilityLabel="Audio"
        >
          <Ionicons
            name={muted ? 'volume-mute' : 'volume-high'}
            size={20}
            color={colors.text}
          />
        </Pressable>
        <Pressable
          style={styles.sideBtn}
          onPress={toggleScheme}
          accessibilityLabel="Toggle theme"
        >
          <Ionicons
            name={isDark ? 'sunny-outline' : 'moon-outline'}
            size={20}
            color={colors.primary}
          />
        </Pressable>
      </View>

      <View style={styles.speedBubble}>
        <Text style={styles.speedValue}>{mapReady ? '24' : '--'}</Text>
        <Text style={styles.speedUnit}>km/h</Text>
      </View>

      {!mapReady ? (
        <View style={styles.gpsPill}>
          <Text style={styles.gpsText}>Searching for GPS…</Text>
        </View>
      ) : null}

      <View style={styles.bottomBar}>
        <Pressable
          style={styles.exitBtn}
          onPress={() => router.back()}
          accessibilityLabel="Exit navigation"
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.stats}>
          <Text style={styles.eta}>{guide.etaMin} min</Text>
          <Text style={styles.meta}>
            {guide.distanceLabel} · {guide.arrivalLabel}
          </Text>
        </View>
        <Pressable style={styles.altBtn} accessibilityLabel="Alternate routes">
          <Ionicons name="swap-horizontal" size={22} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}
