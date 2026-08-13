import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemeToggle } from '@/src/components/ThemeToggle';
import { FadeIn, FadeInFromBottom, PopIn, PressScale, Pulse } from '@/src/components/motion';
import { requestNotificationPermission } from '@/src/alerts';
import { useApp } from '@/src/AppContext';
import { useTheme } from '@/src/ThemeContext';
import { tripHref } from '@/src/api';
import { fonts, radius, spacing } from '@/src/theme';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { stores, profile, me, authLoading, setOnline } = useApp();
  const { colors, shadow, typography } = useTheme();
  const activeStores = stores.filter((s) => !s.paused).length;
  const firstName = (me?.rider_name || profile.name).trim().split(/\s+/)[0] || 'Rider';

  const goOnline = useCallback(async () => {
    await requestNotificationPermission();
    try {
      await setOnline(true);
      router.push('/online');
    } catch (err) {
      // Presence may fail if an active trip exists — resume that trip instead.
      if (me?.active_trip_id && me.active_trip_phase) {
        router.replace(tripHref(me.active_trip_phase, me.active_trip_id) as never);
        return;
      }
      console.warn(err);
    }
  }, [me?.active_trip_id, me?.active_trip_phase, setOnline]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: colors.bg,
          paddingHorizontal: spacing.xl,
        },
        topBar: {
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 56,
          paddingVertical: spacing.lg,
        },
        topSide: {
          width: 100,
          flexDirection: 'row',
          alignItems: 'center',
        },
        topSideLeft: {
          justifyContent: 'flex-start',
        },
        topSideRight: {
          justifyContent: 'flex-end',
          gap: spacing.sm,
        },
        earnBadge: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
        earnBadgeInner: {
          alignItems: 'center',
          backgroundColor: colors.surface,
          paddingHorizontal: 18,
          paddingVertical: 10,
          borderRadius: radius.cta,
          ...shadow.card,
        },
        earnLabel: {
          fontFamily: fonts.sans,
          fontSize: 11,
          color: colors.muted,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        },
        earnValue: {
          fontFamily: fonts.display,
          fontSize: 18,
          color: colors.primary,
        },
        avatarBtn: {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        avatarImg: { width: 40, height: 40 },
        center: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.md,
        },
        greet: {
          fontFamily: fonts.sans,
          fontSize: 16,
          color: colors.subtext,
        },
        title: {
          fontFamily: fonts.display,
          fontSize: 28,
          color: colors.text,
          textAlign: 'center',
        },
        storesLine: {
          fontFamily: fonts.sans,
          fontSize: 14,
          color: colors.muted,
        },
        dashBtn: {
          marginTop: spacing.lg,
          backgroundColor: colors.primary,
          paddingHorizontal: 40,
          paddingVertical: 18,
          borderRadius: radius.cta,
          ...shadow.lift,
        },
        dashLabel: {
          color: '#fff',
          fontFamily: fonts.sansBold,
          fontSize: 18,
        },
        hint: {
          fontFamily: fonts.sans,
          fontSize: 13,
          color: colors.muted,
          textAlign: 'center',
        },
        footerCards: {
          flexDirection: 'row',
          gap: spacing.md,
          paddingBottom: spacing.xl,
        },
      }),
    [colors, shadow],
  );

  if (authLoading) {
    return (
      <View style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!me) {
    return <Redirect href="/welcome" />;
  }

  const currency = me.currency || 'KES';
  const todayEarn = Math.round(me.today_earnings || 0);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <View style={[styles.topSide, styles.topSideLeft]}>
          <ThemeToggle />
        </View>
        <View style={styles.earnBadge}>
          <PopIn>
            <View style={styles.earnBadgeInner}>
              <Text style={styles.earnLabel}>Today</Text>
              <Text style={styles.earnValue}>
                {currency} {todayEarn.toLocaleString()}
              </Text>
            </View>
          </PopIn>
        </View>
        <View style={[styles.topSide, styles.topSideRight]}>
          <PressScale onPress={() => router.push('/profile')}>
            <View style={styles.avatarBtn}>
              {profile.photoUri ? (
                <Image source={{ uri: profile.photoUri }} style={styles.avatarImg} />
              ) : (
                <Ionicons name="person" size={20} color={colors.primary} />
              )}
            </View>
          </PressScale>
        </View>
      </View>

      <View style={styles.center}>
        <FadeIn delay={80}>
          <Text style={styles.greet}>Hi, {firstName}</Text>
        </FadeIn>
        <FadeIn delay={160}>
          <Text style={styles.title}>Ready to deliver?</Text>
        </FadeIn>
        <FadeIn delay={240}>
          <Text style={styles.storesLine}>
            {activeStores} active store{activeStores === 1 ? '' : 's'} · {me.merchant_name}
          </Text>
        </FadeIn>

        <FadeIn delay={320}>
          <Pulse>
            <PressScale onPress={() => void goOnline()} accessibilityLabel="Go online">
              <View style={styles.dashBtn}>
                <Text style={styles.dashLabel}>Go Online</Text>
              </View>
            </PressScale>
          </Pulse>
        </FadeIn>

        <FadeIn delay={400}>
          <Text style={styles.hint}>Tap to start receiving delivery offers</Text>
        </FadeIn>
      </View>

      <View style={styles.footerCards}>
        <FadeInFromBottom delay={360} style={{ flex: 1 }}>
          <QuickCard
            icon="bicycle"
            title="Active trip"
            subtitle={
              me.active_trip_id
                ? 'Continue current delivery'
                : 'No trip in progress'
            }
            onPress={() => {
              if (me.active_trip_id && me.active_trip_phase) {
                router.replace(tripHref(me.active_trip_phase, me.active_trip_id) as never);
              }
            }}
          />
        </FadeInFromBottom>
        <FadeInFromBottom delay={440} style={{ flex: 1 }}>
          <QuickCard
            icon="wallet-outline"
            title="Earnings"
            subtitle={`${me.today_trip_count} trips today`}
            onPress={() => router.push('/(tabs)/earnings')}
          />
        </FadeInFromBottom>
      </View>
    </View>
  );
}

function QuickCard({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const { colors, shadow, typography } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.surface,
          borderRadius: radius.xl,
          padding: spacing.lg,
          gap: 6,
          ...shadow.card,
        },
        cardIcon: {
          width: 40,
          height: 40,
          borderRadius: radius.sm,
          backgroundColor: colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 4,
        },
        cardTitle: {
          fontFamily: fonts.display,
          fontSize: 17,
          color: colors.text,
        },
      }),
    [colors, shadow.card],
  );

  return (
    <PressScale onPress={onPress} style={{ width: '100%' }}>
      <View style={styles.card}>
        <View style={styles.cardIcon}>
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={typography.caption}>{subtitle}</Text>
      </View>
    </PressScale>
  );
}
