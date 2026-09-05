import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FadeIn, FadeInFromBottom } from '@/src/components/motion';
import { fetchEarnings, type RiderEarnings } from '@/src/api';
import { useTheme } from '@/src/ThemeContext';
import { fonts, radius, spacing } from '@/src/theme';

function formatTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function EarningsScreen() {
  const { colors, shadow, typography } = useTheme();
  const [today, setToday] = useState<RiderEarnings | null>(null);
  const [week, setWeek] = useState<RiderEarnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [t, w] = await Promise.all([fetchEarnings('today'), fetchEarnings('week')]);
        if (!alive) return;
        setToday(t);
        setWeek(w);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load earnings');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: colors.bg },
        content: { padding: spacing.xl, paddingBottom: spacing.xxl },
        summary: {
          backgroundColor: colors.surface,
          borderRadius: radius.xxl,
          padding: spacing.xl,
          flexDirection: 'row',
          ...shadow.card,
        },
        stat: { flex: 1, gap: 6 },
        amount: {
          fontSize: 24,
          fontFamily: fonts.display,
          letterSpacing: -0.4,
          color: colors.text,
        },
        divider: {
          width: 1,
          backgroundColor: colors.border,
          marginHorizontal: spacing.lg,
        },
        section: {
          fontFamily: fonts.sansSemi,
          fontSize: 13,
          color: colors.muted,
          marginTop: spacing.xl,
          marginBottom: spacing.md,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
        },
        row: {
          backgroundColor: colors.surface,
          borderRadius: radius.xl,
          padding: spacing.lg,
          marginBottom: spacing.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          ...shadow.card,
        },
        thumb: {
          width: 52,
          height: 52,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceMuted,
        },
        rowMeta: { flex: 1, gap: 2 },
        rowTitle: {
          fontFamily: fonts.display,
          fontSize: 17,
          color: colors.text,
        },
        rowAmt: {
          fontSize: 16,
          fontFamily: fonts.sansSemi,
          color: colors.primary,
        },
        center: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.xl,
        },
      }),
    [colors, shadow.card],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={typography.caption}>{error}</Text>
      </View>
    );
  }

  const currency = today?.currency || week?.currency || 'KES';
  const trips = today?.trips?.length ? today.trips : week?.trips || [];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <FadeIn delay={60}>
        <View style={styles.summary}>
          <View style={styles.stat}>
            <Text style={typography.caption}>Today</Text>
            <Text style={styles.amount}>
              {currency} {Math.round(today?.earnings_total || 0).toLocaleString()}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.stat}>
            <Text style={typography.caption}>This week</Text>
            <Text style={styles.amount}>
              {currency} {Math.round(week?.earnings_total || 0).toLocaleString()}
            </Text>
          </View>
        </View>
      </FadeIn>

      <FadeIn delay={140}>
        <Text style={styles.section}>Recent trips</Text>
      </FadeIn>
      {trips.length === 0 ? (
        <Text style={typography.caption}>No completed trips yet.</Text>
      ) : (
        trips.map((e, i) => (
          <FadeInFromBottom key={e.id} delay={180 + i * 60}>
            <View style={styles.row}>
              <View style={styles.thumb} />
              <View style={styles.rowMeta}>
                <Text style={styles.rowTitle}>{e.delivery_number}</Text>
                <Text style={typography.caption}>
                  {e.delivery_address || formatTime(e.completed_at)}
                </Text>
              </View>
              <Text style={styles.rowAmt}>
                +{Math.round(e.delivery_fee || 0).toLocaleString()}
              </Text>
            </View>
          </FadeInFromBottom>
        ))
      )}
    </ScrollView>
  );
}
