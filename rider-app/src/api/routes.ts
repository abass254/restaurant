import { getApiBaseUrl } from './config';

function base() {
  return getApiBaseUrl().replace(/\/$/, '');
}

export const apiRoutes = {
  riderAuthRequestCode: () => `${base()}/api/v1/rider/auth/request-code`,
  riderAuthVerifyCode: () => `${base()}/api/v1/rider/auth/verify-code`,
  riderAuthLogout: () => `${base()}/api/v1/rider/auth/logout`,
  riderMe: () => `${base()}/api/v1/rider/me`,
  riderPresence: () => `${base()}/api/v1/rider/presence`,
  riderHeartbeat: () => `${base()}/api/v1/rider/heartbeat`,
  riderOffers: () => `${base()}/api/v1/rider/offers`,
  riderOfferAccept: (offerId: string) =>
    `${base()}/api/v1/rider/offers/${encodeURIComponent(offerId)}/accept`,
  riderOfferDecline: (offerId: string) =>
    `${base()}/api/v1/rider/offers/${encodeURIComponent(offerId)}/decline`,
  riderDeliveries: () => `${base()}/api/v1/rider/deliveries`,
  riderDelivery: (orderId: string) =>
    `${base()}/api/v1/rider/deliveries/${encodeURIComponent(orderId)}`,
  riderDeliveryTrip: (orderId: string) =>
    `${base()}/api/v1/rider/deliveries/${encodeURIComponent(orderId)}/trip`,
  riderDeliveryConfirm: (orderId: string) =>
    `${base()}/api/v1/rider/deliveries/${encodeURIComponent(orderId)}/confirm`,
  riderEarnings: (period: string) =>
    `${base()}/api/v1/rider/earnings?period=${encodeURIComponent(period)}`,
};
