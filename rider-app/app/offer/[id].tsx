import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import { TextButton } from '@/src/components/TextButton';
import { notifyRider } from '@/src/alerts';
import { useApp } from '@/src/AppContext';
import { useTheme } from '@/src/ThemeContext';
import { acceptOffer, declineOffer, listOffers, tripHref, type RiderOffer } from '@/src/api';
import { parseIso } from '@/src/lib/parseIso';
import { fonts, radius, spacing } from '@/src/theme';

export default function OfferScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const offerId = typeof id === 'string' ? id : '';
  const { refresh, offers } = useApp();
  const [offer, setOffer] = useState<RiderOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = useSharedValue(1);
  const { colors, shadow, typography } = useTheme();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const fromCtx = offers.find((o) => o.id === offerId);
        if (fromCtx) {
          if (alive) setOffer(fromCtx);
        } else {
          const list = await listOffers();
          if (!alive) return;
          const found = list.find((o) => o.id === offerId) || list[0] || null;
          setOffer(found);
          if (!found) {
            router.replace('/online');
          }
        }
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : 'Could not load offer');
          router.replace('/online');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [offerId, offers]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = offer?.expires_at
    ? Math.max(0, Math.ceil(((parseIso(offer.expires_at)?.getTime() ?? 0) - now) / 1000))
    : 0;
  const totalSeconds = offer?.expires_at
    ? Math.max(
        secondsLeft,
        Math.ceil(((parseIso(offer.expires_at)?.getTime() ?? Date.now()) - Date.now()) / 1000) || 45,
      )
    : 45;

  useEffect(() => {
    if (offer && secondsLeft <= 0) {
      router.replace('/online');
    }
  }, [offer, secondsLeft]);

  useEffect(() => {
    if (!offer || trackWidth <= 0) return;
    const fraction = totalSeconds > 0 ? secondsLeft / totalSeconds : 0;
    progress.value = fraction;
    progress.value = withTiming(0, {
      duration: Math.max(secondsLeft, 1) * 1000,
      easing: Easing.linear,
    });
  }, [offer?.id, progress, secondsLeft, totalSeconds, trackWidth]);

  useEffect(() => {
    if (!offer) return;
    void notifyRider('new_offer', {
      offerId: offer.id,
      payoutKes: Math.round(offer.payout_estimate || 0),
      skipToast: true,
    });
  }, [offer?.id]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          justifyContent: 'flex-end',
          backgroundColor: colors.overlay,
        },
        scrim: {
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        },
        sheet: {
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xxl,
          borderTopRightRadius: radius.xxl,
          padding: spacing.xl,
          ...shadow.lift,
        },
        timerHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.sm,
        },
        timerLabel: {
          ...typography.caption,
          flex: 1,
        },
        timerText: {
          fontFamily: fonts.sansBold,
          fontSize: 13,
          color: colors.primary,
        },
        track: {
          height: 6,
          borderRadius: 999,
          backgroundColor: colors.surfaceMuted,
          overflow: 'hidden',
          marginBottom: spacing.md,
        },
        fill: {
          height: '100%',
          borderRadius: 999,
          backgroundColor: colors.primary,
        },
        pay: {
          ...typography.pay,
          marginTop: spacing.sm,
        },
        meta: {
          ...typography.caption,
          marginTop: 4,
        },
        strip: {
          marginTop: spacing.lg,
          backgroundColor: colors.bg,
          borderRadius: radius.xl,
          padding: spacing.lg,
          gap: spacing.sm,
        },
        line: {
          width: 2,
          height: 16,
          backgroundColor: colors.border,
          marginLeft: 17,
        },
        error: {
          marginTop: spacing.md,
          color: '#B42318',
          fontFamily: fonts.sans,
        },
        center: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
      }),
    [colors, shadow.lift, typography],
  );

  const fillStyle = useAnimatedStyle(() => ({
    width: trackWidth * progress.value,
  }));

  const onAccept = async () => {
    if (!offer || acting) return;
    setActing(true);
    setError(null);
    try {
      const delivery = await acceptOffer(offer.id);
      await notifyRider('trip_accepted', { skipToast: true });
      await refresh();
      router.replace(
        tripHref(delivery.rider_trip_phase || 'en_route_to_store', delivery.id) as never,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept offer');
      setActing(false);
    }
  };

  const onDecline = async () => {
    if (!offer || acting) return;
    setActing(true);
    try {
      await declineOffer(offer.id);
      router.replace('/online');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not decline');
      setActing(false);
    }
  };

  if (loading || !offer) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const currency = offer.currency || 'KES';
  const payout = Math.round(offer.payout_estimate || 0);

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.scrim} />
      <View style={styles.sheet}>
        <View style={styles.timerHeader}>
          <Text style={styles.timerLabel}>New delivery · #{offer.order_number}</Text>
          <Text style={styles.timerText}>{secondsLeft}s</Text>
        </View>
        <View
          style={styles.track}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        >
          <Animated.View style={[styles.fill, fillStyle]} />
        </View>

        <Text style={styles.pay}>
          {currency} {payout.toLocaleString()}
        </Text>
        <Text style={styles.meta}>
          {offer.item_count} item{offer.item_count === 1 ? '' : 's'} · order total{' '}
          {currency} {Math.round(offer.total || 0).toLocaleString()}
        </Text>

        <View style={styles.strip}>
          <StripStop
            icon="storefront"
            title={offer.store_name}
            subtitle={offer.store_location || 'Pickup'}
          />
          <View style={styles.line} />
          <StripStop
            icon="home"
            title="Customer"
            subtitle={offer.delivery_address || 'Delivery address'}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <PrimaryButton
          label={acting ? 'Working…' : 'Accept'}
          onPress={() => void onAccept()}
          style={{ marginTop: spacing.lg, opacity: acting ? 0.7 : 1 }}
        />
        <TextButton label="Reject" danger onPress={() => void onDecline()} />
      </View>
    </View>
  );
}

function StripStop({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        stop: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
        stopIcon: {
          width: 36,
          height: 36,
          borderRadius: radius.sm,
          backgroundColor: colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        },
        stopTitle: {
          fontFamily: fonts.display,
          fontSize: 17,
          color: colors.text,
        },
      }),
    [colors],
  );

  return (
    <View style={styles.stop}>
      <View style={styles.stopIcon}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stopTitle}>{title}</Text>
        <Text style={typography.caption}>{subtitle}</Text>
      </View>
    </View>
  );
}
