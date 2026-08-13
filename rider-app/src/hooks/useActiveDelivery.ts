import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import {
  advanceTrip,
  confirmDelivery,
  fetchDelivery,
  tripHref,
  type RiderDelivery,
} from '@/src/api';

export function useActiveDelivery(orderId: string | undefined) {
  const [delivery, setDelivery] = useState<RiderDelivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!orderId) {
      setDelivery(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await fetchDelivery(orderId);
      setDelivery(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load delivery');
      setDelivery(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const goToPhase = useCallback(
    async (nextPhase: string | 'confirm') => {
      if (!orderId) return;
      setActing(true);
      setError(null);
      try {
        if (nextPhase === 'confirm') {
          const next = await confirmDelivery(orderId);
          setDelivery(next);
          router.replace({
            pathname: '/trip/complete',
            params: {
              order: orderId,
              payout: String(next.delivery_fee ?? next.total ?? 0),
              orderNumber: next.order_number,
            },
          });
          return next;
        }
        const next = await advanceTrip(orderId, nextPhase);
        setDelivery(next);
        const href = tripHref(next.rider_trip_phase || nextPhase, orderId);
        router.replace(href as never);
        return next;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update trip');
        throw err;
      } finally {
        setActing(false);
      }
    },
    [orderId],
  );

  return { delivery, loading, acting, error, reload, goToPhase };
}
