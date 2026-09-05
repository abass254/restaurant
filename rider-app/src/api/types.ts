export type RiderTripPhase =
  | 'en_route_to_store'
  | 'at_store'
  | 'picking_up'
  | 'en_route_to_client'
  | 'at_client'
  | 'completed'
  | 'cancelled';

export type RiderMe = {
  rider_id: string;
  rider_name: string;
  phone: string;
  status: string;
  is_online: boolean;
  last_seen_at: string | null;
  merchant_name: string;
  store_location: string | null;
  store_lat: number | null;
  store_lng: number | null;
  active_trip_id: string | null;
  active_trip_phase: RiderTripPhase | null;
  active_trip_route: string | null;
  today_trip_count: number;
  today_earnings: number;
  currency: string;
};

export type RiderMeAuth = RiderMe & {
  session_token: string;
  csrf_token?: string;
};

export type RiderDeliveryItem = {
  product_name: string;
  quantity: number;
};

export type RiderDelivery = {
  id: string;
  delivery_number: string;
  order_id?: string | null;
  order_number?: string | null;
  has_order?: boolean;
  status: string;
  customer_name: string | null;
  customer_phone_masked: string | null;
  customer_phone?: string | null;
  delivery_address: string | null;
  delivery_notes: string | null;
  total: number;
  currency: string;
  delivery_fee?: number;
  items: RiderDeliveryItem[];
  can_dispatch: boolean;
  can_confirm: boolean;
  rider_trip_phase?: RiderTripPhase | null;
  trip_route?: string | null;
  store_name?: string | null;
  store_location?: string | null;
  store_lat?: number | null;
  store_lng?: number | null;
};

export type RiderOffer = {
  id: string;
  delivery_id: string;
  delivery_number: string;
  order_id?: string | null;
  order_number?: string | null;
  has_order?: boolean;
  expires_at: string;
  store_name: string;
  store_location: string | null;
  store_lat?: number | null;
  store_lng?: number | null;
  delivery_address: string | null;
  item_count: number;
  payout_estimate: number;
  currency: string;
  total: number;
};

export type RiderHeartbeat = {
  is_online: boolean;
  last_seen_at: string | null;
  offers: RiderOffer[];
  active_trip_id: string | null;
  active_trip_phase: RiderTripPhase | null;
  active_trip_route: string | null;
};

export type RiderLoginCode = {
  message: string;
  expires_in_seconds: number;
  login_code: string | null;
  phone_masked: string | null;
  email_masked?: string | null;
  channel?: 'phone' | 'email' | string;
  code_sent?: boolean;
};

export type RiderEarningsTrip = {
  id: string;
  delivery_number: string;
  order_number?: string | null;
  completed_at: string | null;
  delivery_fee: number;
  total: number;
  currency: string;
  delivery_address: string | null;
};

export type RiderEarnings = {
  period: string;
  trip_count: number;
  currency: string;
  earnings_total: number;
  handled_volume: number;
  trips: RiderEarningsTrip[];
};

export type TripItem = {
  id: string;
  name: string;
  qty: number;
  barcode: string;
  checked?: boolean;
};

export function deliveryItemsToTripItems(items: RiderDeliveryItem[]): TripItem[] {
  return items.map((item, index) => ({
    id: String(index + 1),
    name: item.product_name,
    qty: item.quantity,
    barcode: `ITEM-${index + 1}`,
    checked: false,
  }));
}
