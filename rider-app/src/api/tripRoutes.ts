import type { RiderTripPhase } from './types';

/** Map backend trip phase → Expo Router path. */
export function expoRouteForPhase(phase: RiderTripPhase | string | null | undefined): string {
  switch (phase) {
    case 'en_route_to_store':
      return '/trip/to-store';
    case 'at_store':
      return '/trip/arrived';
    case 'picking_up':
      return '/trip/pickup';
    case 'en_route_to_client':
      return '/trip/to-customer';
    case 'at_client':
      return '/trip/deliver';
    case 'completed':
      return '/trip/complete';
    default:
      return '/(tabs)/home';
  }
}

export function tripHref(phase: RiderTripPhase | string | null | undefined, orderId: string) {
  const path = expoRouteForPhase(phase);
  if (path.startsWith('/trip/')) {
    return {
      pathname: path as
        | '/trip/to-store'
        | '/trip/arrived'
        | '/trip/pickup'
        | '/trip/to-customer'
        | '/trip/deliver'
        | '/trip/complete',
      params: { order: orderId },
    };
  }
  return { pathname: '/(tabs)/home' as const };
}
