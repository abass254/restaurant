/** @deprecated Demo fixtures — kept for map/nav labels until live GPS pins land. */
export type { TripItem } from '@/src/api';

export const mockTrip = {
  offerId: 'offer-1',
  orderId: 'ORD-4821',
  payoutKes: 280,
  distanceKm: 3.4,
  etaMinutes: 18,
  timerSeconds: 45,
  store: {
    name: 'Store',
    address: 'Pickup location',
    phone: '',
    latitude: -1.2985,
    longitude: 36.7906,
  },
  customer: {
    name: 'Customer',
    address: 'Delivery address',
    phone: '',
    note: '',
    latitude: -1.2892,
    longitude: 36.7855,
  },
  items: [] as import('@/src/api').TripItem[],
};
