import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RiderMap } from '@/src/components/RiderMap';
import { FadeIn, FadeInFromBottom, PressScale, PulseRing } from '@/src/components/motion';
import { notifyRider } from '@/src/alerts';
import { useApp } from '@/src/AppContext';
import { useTheme } from '@/src/ThemeContext';
import { fonts, radius, spacing } from '@/src/theme';

export default function OnlineScreen() {
  const insets = useSafeAreaInsets();
  const { colors, shadow, typography } = useTheme();
  const { offers, setOnline, me } = useApp();
  const notified = useRef<Set<string>>(new Set());

  const goOffline = useCallback(async () => {
    try {
      await setOnline(false);
    } catch {
      // still leave the screen
    }
    router.replace('/(tabs)/home');
  }, [setOnline]);

  useEffect(() => {
    const offer = offers[0];
    if (!offer) return;
    if (notified.current.has(offer.id)) return;
    notified.current.add(offer.id);
    void notifyRider('new_offer', {
      offerId: offer.id,
      payoutKes: Math.round(offer.payout_estimate || 0),
    }).then(() => {
      router.push(`/offer/${offer.id}`);
    });
  }, [offers]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: colors.map },
        mapWrap: {
          ...StyleSheet.absoluteFill,
        },
        sheetWrap: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
        },
        overlay: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          paddingHorizontal: spacing.lg,
          gap: spacing.md,
        },
        back: {
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          paddingHorizontal: 14,
          paddingVertical: 11,
          borderRadius: radius.cta,
          gap: 2,
          ...shadow.card,
        },
        backText: {
          fontFamily: fonts.sansSemi,
          color: colors.text,
        },
        pill: {
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          backgroundColor: colors.surface,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: radius.cta,
          ...shadow.card,
        },
        pillText: {
          fontFamily: fonts.sansSemi,
          color: colors.text,
        },
        sheet: {
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xxl,
          borderTopRightRadius: radius.xxl,
          padding: spacing.xl,
          ...shadow.lift,
        },
        title: {
          fontFamily: fonts.display,
          fontSize: 26,
          color: colors.text,
        },
        sub: {
          ...typography.caption,
          marginTop: spacing.sm,
          lineHeight: 20,
        },
      }),
    [colors, shadow, typography.caption],
  );

  return (
    <View style={styles.root}>
      <View style={styles.mapWrap}>
        <RiderMap variant="idle" showExpand />
      </View>
      <View style={[styles.overlay, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <FadeIn delay={40}>
          <PressScale onPress={() => void goOffline()}>
            <View style={styles.back}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
              <Text style={styles.backText}>Go Offline</Text>
            </View>
          </PressScale>
        </FadeIn>

        <FadeIn delay={160}>
          <View style={styles.pill}>
            <PulseRing color={colors.primary} size={8} />
            <Text style={styles.pillText}>You&apos;re online</Text>
          </View>
        </FadeIn>
      </View>

      <View style={styles.sheetWrap} pointerEvents="box-none">
        <FadeInFromBottom delay={220}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Text style={styles.title}>Waiting for offers</Text>
            <Text style={styles.sub}>
              New ready orders from {me?.merchant_name || 'your store'} will appear here. Stay
              nearby and keep the app open.
            </Text>
          </View>
        </FadeInFromBottom>
      </View>
    </View>
  );
}
