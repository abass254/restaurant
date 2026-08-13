import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { TripStageLayout } from '@/src/components/TripStageLayout';
import { FactRow } from '@/src/components/FactRow';
import { notifyRider } from '@/src/alerts';
import { useActiveDelivery } from '@/src/hooks/useActiveDelivery';
import { useTheme } from '@/src/ThemeContext';
import { spacing, typography } from '@/src/theme';

export default function ArrivedScreen() {
  const { order } = useLocalSearchParams<{ order: string }>();
  const orderId = typeof order === 'string' ? order : '';
  const { delivery, loading, acting, error, goToPhase } = useActiveDelivery(orderId);
  const { colors } = useTheme();

  useEffect(() => {
    void notifyRider('arrived_store');
  }, []);

  if (loading || !delivery) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <TripStageLayout
      stageTitle="Arrived at store"
      subtitle={`Order #${delivery.order_number}`}
      mapVariant="store"
      primaryLabel={acting ? 'Updating…' : 'Pickup'}
      onPrimary={() => void goToPhase('picking_up')}
      secondaryLabel="Call store"
      onSecondary={() => {}}
    >
      <FactRow
        icon="storefront-outline"
        label="Store"
        value={delivery.store_name || 'Store'}
      />
      <Text style={[styles.label, { color: colors.muted }]}>Items to pick up</Text>
      {(delivery.items || []).map((item, index) => (
        <View
          key={`${item.product_name}-${index}`}
          style={[styles.item, { borderBottomColor: colors.border }]}
        >
          <Text style={[typography.bodyBold, { color: colors.text }]}>
            {item.quantity}× {item.product_name}
          </Text>
        </View>
      ))}
      {error ? <Text style={{ color: '#B42318', marginTop: 8 }}>{error}</Text> : null}
    </TripStageLayout>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typography.captionBold,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
  },
  item: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
