import { apiFetch } from './client';
import { apiRoutes } from './routes';
import type {
  RiderDelivery,
  RiderEarnings,
  RiderHeartbeat,
  RiderMe,
  RiderOffer,
} from './types';

export async function fetchRiderMe(): Promise<RiderMe> {
  const res = await apiFetch<{ data: RiderMe }>(apiRoutes.riderMe());
  return res.data;
}

export async function setRiderPresence(body: {
  online: boolean;
  lat?: number | null;
  lng?: number | null;
}): Promise<RiderMe> {
  const res = await apiFetch<{ data: RiderMe }>(apiRoutes.riderPresence(), {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function riderHeartbeat(body: {
  lat?: number | null;
  lng?: number | null;
} = {}): Promise<RiderHeartbeat> {
  const res = await apiFetch<{ data: RiderHeartbeat }>(apiRoutes.riderHeartbeat(), {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function listOffers(): Promise<RiderOffer[]> {
  const res = await apiFetch<{ data: RiderOffer[] }>(apiRoutes.riderOffers());
  return res.data;
}

export async function acceptOffer(offerId: string): Promise<RiderDelivery> {
  const res = await apiFetch<{ data: RiderDelivery }>(apiRoutes.riderOfferAccept(offerId), {
    method: 'POST',
    body: '{}',
  });
  return res.data;
}

export async function declineOffer(offerId: string): Promise<void> {
  await apiFetch(apiRoutes.riderOfferDecline(offerId), {
    method: 'POST',
    body: '{}',
  });
}

export async function fetchDelivery(orderId: string): Promise<RiderDelivery> {
  const res = await apiFetch<{ data: RiderDelivery }>(apiRoutes.riderDelivery(orderId));
  return res.data;
}

export async function advanceTrip(orderId: string, phase: string): Promise<RiderDelivery> {
  const res = await apiFetch<{ data: RiderDelivery }>(apiRoutes.riderDeliveryTrip(orderId), {
    method: 'POST',
    body: JSON.stringify({ phase }),
  });
  return res.data;
}

export async function confirmDelivery(orderId: string): Promise<RiderDelivery> {
  const res = await apiFetch<{ data: RiderDelivery }>(apiRoutes.riderDeliveryConfirm(orderId), {
    method: 'POST',
    body: '{}',
  });
  return res.data;
}

export async function fetchEarnings(period: string): Promise<RiderEarnings> {
  const res = await apiFetch<{ data: RiderEarnings }>(apiRoutes.riderEarnings(period));
  return res.data;
}
