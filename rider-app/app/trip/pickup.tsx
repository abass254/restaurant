import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ItemScanScreen } from '@/src/components/ItemScanScreen';
import { useActiveDelivery } from '@/src/hooks/useActiveDelivery';
import { deliveryItemsToTripItems, type TripItem } from '@/src/api';
import { useTheme } from '@/src/ThemeContext';

export default function PickupScreen() {
  const { order } = useLocalSearchParams<{ order: string }>();
  const orderId = typeof order === 'string' ? order : '';
  const { delivery, loading, acting, error, goToPhase } = useActiveDelivery(orderId);
  const { colors } = useTheme();
  const [items, setItems] = useState<TripItem[]>([]);

  useEffect(() => {
    if (delivery?.items) {
      setItems(deliveryItemsToTripItems(delivery.items));
    }
  }, [delivery?.id, delivery?.items]);

  const allChecked = items.length === 0 || items.every((i) => i.checked);

  const onScan = useCallback(
    (code: string) => {
      const normalized = code.trim().toUpperCase();
      const match = items.find(
        (i) => i.barcode.toUpperCase() === normalized || i.id === normalized,
      );
      if (!match) {
        return { ok: false, message: 'Unknown barcode — try another item' };
      }
      if (match.checked) {
        return { ok: false, message: `${match.name} already picked` };
      }
      setItems((prev) =>
        prev.map((i) => (i.id === match.id ? { ...i, checked: true } : i)),
      );
      return { ok: true, message: `Picked ${match.name}` };
    },
    [items],
  );

  if (loading || !delivery) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
        {error ? <Text style={{ marginTop: 12, color: colors.muted }}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <ItemScanScreen
      title="Pickup at store"
      subtitle="Hold each product barcode in the camera above"
      items={items}
      onScan={onScan}
      pendingLabel="Still to pick"
      scannedLabel="Picked up"
      primaryLabel={acting ? 'Updating…' : 'Confirm & go to customer'}
      primaryDisabled={!allChecked || acting}
      onPrimary={() => void goToPhase('en_route_to_client')}
    />
  );
}
