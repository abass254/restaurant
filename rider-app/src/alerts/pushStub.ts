/**
 * Push-ready stub for a future backend integration.
 *
 * Expected payload shape from the server:
 * {
 *   "event": "new_offer" | "trip_accepted" | "arrived_store" | "delivery_complete",
 *   "title"?: string,
 *   "body"?: string,
 *   "payoutKes"?: number,
 *   "route"?: string   // e.g. "/offer/offer-1"
 * }
 */

import type { RiderAlertEvent } from '@/src/alerts/riderAlerts';

export type PushPayload = {
  event?: string;
  title?: string;
  body?: string;
  payoutKes?: number | string;
  route?: string;
};

const KNOWN_EVENTS: RiderAlertEvent[] = [
  'new_offer',
  'trip_accepted',
  'arrived_store',
  'delivery_complete',
];

/** Not implemented in v1 — remote push requires a native build + Expo push token. */
export async function registerForPushNotifications(): Promise<string | null> {
  return null;
}

export function parsePushPayload(
  data: Record<string, unknown> | PushPayload | null | undefined,
): { event: RiderAlertEvent; meta: { title?: string; body?: string; payoutKes?: number }; route?: string } | null {
  if (!data || typeof data !== 'object') return null;
  const event = String((data as PushPayload).event ?? '');
  if (!KNOWN_EVENTS.includes(event as RiderAlertEvent)) return null;

  const payoutRaw = (data as PushPayload).payoutKes;
  let payoutKes: number | undefined;
  if (typeof payoutRaw === 'number') {
    payoutKes = payoutRaw;
  } else if (typeof payoutRaw === 'string') {
    const n = Number(payoutRaw.trim());
    payoutKes = Number.isFinite(n) ? n : undefined;
  }

  return {
    event: event as RiderAlertEvent,
    meta: {
      title: typeof (data as PushPayload).title === 'string' ? (data as PushPayload).title : undefined,
      body: typeof (data as PushPayload).body === 'string' ? (data as PushPayload).body : undefined,
      payoutKes,
    },
    route: typeof (data as PushPayload).route === 'string' ? (data as PushPayload).route : undefined,
  };
}
