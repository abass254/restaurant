import { ActivityIndicator, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { TripStageLayout } from '@/src/components/TripStageLayout';
import { FactRow } from '@/src/components/FactRow';
import { useActiveDelivery } from '@/src/hooks/useActiveDelivery';
import { useTheme } from '@/src/ThemeContext';
import {
  merchantStageLabelForPhase,
  riderActionTitleForPhase,
  tripReferenceLabel,
} from '@/src/deliveryWorkflow';

export default function ToCustomerScreen() {
  const { order } = useLocalSearchParams<{ order: string }>();
  const orderId = typeof order === 'string' ? order : '';
  const { delivery, loading, acting, error, goToPhase } = useActiveDelivery(orderId);
  const { colors } = useTheme();

  if (loading || !delivery) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <TripStageLayout
      stageTitle={riderActionTitleForPhase('en_route_to_client', {
        customerName: delivery.customer_name || 'customer',
      })}
      subtitle={`${merchantStageLabelForPhase('en_route_to_client')} · ${tripReferenceLabel(delivery)}`}
      mapVariant="customer"
      primaryLabel={acting ? 'Updating…' : 'Arrive at customer'}
      onPrimary={() => void goToPhase('at_client')}
      secondaryLabel="Navigate"
      onSecondary={() =>
        router.push({
          pathname: '/map-full',
          params: { variant: 'customer', mode: 'navigate' },
        })
      }
    >
      <FactRow
        icon="storefront-outline"
        label="From (A)"
        value={delivery.store_name || 'Store'}
      />
      <FactRow
        icon="home-outline"
        label="To (B)"
        value={delivery.delivery_address || 'Address'}
      />
      <FactRow
        icon="chatbubble-outline"
        label="Note"
        value={delivery.delivery_notes || '—'}
      />
      {error ? <FactRow icon="alert-circle-outline" label="Error" value={error} /> : null}
    </TripStageLayout>
  );
}
