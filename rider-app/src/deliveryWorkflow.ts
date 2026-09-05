import type { RiderTripPhase } from '@/src/api/types';

/** Merchant-facing labels — keep in sync with frontend/src/lib/delivery-workflow.ts */
export const DELIVERY_STAGE_LABELS = {
  looking_for_rider: 'Looking for rider',
  rider_on_the_way: 'Rider on the way',
  rider_arrived: 'Rider arrived',
  rider_to_client: 'Rider goes to the client',
  delivered: 'Delivered',
} as const;

export type DeliveryProgressStage = keyof typeof DELIVERY_STAGE_LABELS;

/** Map rider trip phase → merchant delivery stage label. */
export function merchantStageLabelForPhase(
  phase: RiderTripPhase | string | null | undefined,
): string {
  switch (phase) {
    case 'en_route_to_store':
      return DELIVERY_STAGE_LABELS.rider_on_the_way;
    case 'at_store':
    case 'picking_up':
      return DELIVERY_STAGE_LABELS.rider_arrived;
    case 'en_route_to_client':
    case 'at_client':
      return DELIVERY_STAGE_LABELS.rider_to_client;
    case 'completed':
      return DELIVERY_STAGE_LABELS.delivered;
    default:
      return DELIVERY_STAGE_LABELS.looking_for_rider;
  }
}

/** Short rider-action title per trip screen (pairs with merchant stage in subtitle). */
export function riderActionTitleForPhase(
  phase: RiderTripPhase | string | null | undefined,
  context?: { storeName?: string; customerName?: string },
): string {
  const store = context?.storeName || 'pickup';
  const customer = context?.customerName || 'customer';
  switch (phase) {
    case 'en_route_to_store':
      return `Head to ${store}`;
    case 'at_store':
      return 'Arrived at pickup';
    case 'picking_up':
      return 'Collect at pickup';
    case 'en_route_to_client':
      return `Go to ${customer}`;
    case 'at_client':
      return 'Arrived at drop-off';
    case 'completed':
      return 'Trip complete';
    default:
      return 'Active delivery';
  }
}

export function tripReferenceLabel(input: {
  delivery_number: string;
  order_number?: string | null;
  has_order?: boolean;
}): string {
  if (input.has_order && input.order_number) {
    return `Order #${input.order_number}`;
  }
  return input.delivery_number;
}
