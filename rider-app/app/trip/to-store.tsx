import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { TripStageLayout } from '@/src/components/TripStageLayout';
import { FactRow } from '@/src/components/FactRow';
import { useActiveDelivery } from '@/src/hooks/useActiveDelivery';
import { useTheme } from '@/src/ThemeContext';

export default function ToStoreScreen() {
  const { order } = useLocalSearchParams<{ order: string }>();
  const orderId = typeof order === 'string' ? order : '';
  const { delivery, loading, acting, error, goToPhase } = useActiveDelivery(orderId);
  const { colors } = useTheme();

  if (loading || !delivery) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
        {error ? <Text style={{ marginTop: 12, color: colors.muted }}>{error}</Text> : null}
      </View>
    );
  }

  const storeName = delivery.store_name || 'Store';
  const payout = Math.round(delivery.delivery_fee || 0);
  const currency = delivery.currency || 'KES';

  return (
    <TripStageLayout
      stageTitle={`Head to ${storeName}`}
      subtitle={`Order #${delivery.order_number} · pull sheet down for more map`}
      mapVariant="store"
      primaryLabel={acting ? 'Updating…' : 'Arrive at store'}
      onPrimary={() => void goToPhase('at_store')}
      secondaryLabel="Navigate"
      onSecondary={() => {
        // TripStageLayout / map-full still use demo coords; address shown in facts.
      }}
    >
      <FactRow icon="navigate-outline" label="From (A)" value="Your location" />
      <FactRow
        icon="storefront-outline"
        label="To (B)"
        value={delivery.store_location || storeName}
      />
      <FactRow icon="cash-outline" label="Payout" value={`${currency} ${payout}`} />
      {error ? <FactRow icon="alert-circle-outline" label="Error" value={error} /> : null}
    </TripStageLayout>
  );
}
