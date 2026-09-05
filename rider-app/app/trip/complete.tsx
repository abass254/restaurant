import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import { notifyRider } from '@/src/alerts';
import { useApp } from '@/src/AppContext';
import { DELIVERY_STAGE_LABELS } from '@/src/deliveryWorkflow';
import { colors, radius, spacing, typography } from '@/src/theme';

export default function CompleteScreen() {
  const insets = useSafeAreaInsets();
  const { order, payout, orderNumber } = useLocalSearchParams<{
    order?: string;
    payout?: string;
    orderNumber?: string;
  }>();
  const { refresh, setOnline } = useApp();
  const payoutKes = Math.round(Number(payout) || 0);
  const displayOrder = orderNumber || order || '';

  useEffect(() => {
    void notifyRider('delivery_complete', { payoutKes });
    void refresh();
  }, [payoutKes, refresh]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xxl }]}>
      <View style={styles.badge}>
        <Ionicons name="checkmark" size={48} color="#fff" />
      </View>
      <Text style={styles.title}>Delivery complete</Text>
      <Text style={styles.sub}>
        {DELIVERY_STAGE_LABELS.delivered} — payout added to today&apos;s earnings.
      </Text>

      <View style={styles.card}>
        <Text style={typography.caption}>You earned</Text>
        <Text style={styles.pay}>KES {payoutKes.toLocaleString()}</Text>
        {displayOrder ? (
          <Text style={typography.caption}>Order {displayOrder}</Text>
        ) : null}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <PrimaryButton
          label="Back online"
          onPress={() => {
            void (async () => {
              try {
                await setOnline(true);
              } catch {
                // ignore
              }
              router.replace('/online');
            })();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  badge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  sub: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  card: {
    marginTop: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  pay: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.primary,
  },
  footer: {
    marginTop: 'auto',
    width: '100%',
  },
});
