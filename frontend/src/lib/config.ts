/**
 * Browser API calls use same-origin paths (proxied to Laravel via next.config rewrites).
 * Set NEXT_PUBLIC_API_URL only if you need a direct cross-origin API (not recommended).
 */
export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Debug-mode flag for diagnostic UI (raw payload panels, etc.).
 * Defaults to on in dev, off in prod. Override either way with
 * `NEXT_PUBLIC_DEBUG=true|false`. Truthy values: "1", "true", "yes".
 */
export const isDebugMode: boolean = (() => {
  const raw = process.env.NEXT_PUBLIC_DEBUG;
  if (raw != null && raw !== "") {
    return /^(1|true|yes)$/i.test(raw);
  }
  return process.env.NODE_ENV !== "production";
})();

/** True when running a local/dev build (not production). */
export const isDevEnvironment = process.env.NODE_ENV !== "production";

/** Public site URL (marketing + dashboard). */
export const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:7100";

/** Google Analytics 4 measurement ID (e.g. G-XXXXXXXX). Leave empty to disable. */
export const gaMeasurementId =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";

/** Relative Instagram OAuth entrypoint (proxied to backend via next.config rewrites). */
export const instagramAuthPath = "/auth/instagram";

/**
 * Resolve an API OAuth path (or stale absolute dev URL) to the app domain
 * the user is actually on — e.g. https://dukai.app/auth/instagram.
 */
export function resolveSameOriginUrl(path: string | null | undefined): string {
  if (!path) return "";

  if (typeof window !== "undefined") {
    const origin = window.location.origin;
    if (/^https?:\/\//i.test(path)) {
      try {
        const parsed = new URL(path);
        if (parsed.pathname.startsWith("/auth/")) {
          return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
      } catch {
        return path;
      }
      return path;
    }
    if (path.startsWith("/")) {
      return `${origin}${path}`;
    }
    return path;
  }

  if (path.startsWith("/")) {
    const base = appUrl.replace(/\/$/, "");
    return base ? `${base}${path}` : path;
  }
  return path;
}

/** Instagram OAuth — always on the current app host. */
export const instagramAuthUrl = resolveSameOriginUrl(instagramAuthPath);

export const apiRoutes = {
  test: `${apiUrl}/test`,
  csrf: `${apiUrl}/sanctum/csrf-cookie`,
  register: `${apiUrl}/api/v1/register`,
  createShop: `${apiUrl}/api/v1/accounts`,
  signup: `${apiUrl}/api/v1/auth/signup`,
  signupOptions: `${apiUrl}/api/v1/auth/signup-options`,
  googleAuth: (next?: string) => {
    const base = `${apiUrl}/auth/google`;
    if (!next) return base;
    return `${base}?next=${encodeURIComponent(next)}`;
  },
  login: `${apiUrl}/api/v1/auth/login`,
  requestLoginCode: `${apiUrl}/api/v1/auth/request-code`,
  verifyLoginCode: `${apiUrl}/api/v1/auth/verify-code`,
  user: `${apiUrl}/api/v1/auth/user`,
  switchMerchant: `${apiUrl}/api/v1/auth/switch-merchant`,
  sessionRefresh: `${apiUrl}/api/v1/auth/session/refresh`,
  logout: `${apiUrl}/api/v1/auth/logout`,
  settings: `${apiUrl}/api/v1/settings`,
  settingsBusiness: `${apiUrl}/api/v1/settings/business`,
  settingsBusinessLocation: `${apiUrl}/api/v1/settings/business-location`,
  settingsLogo: `${apiUrl}/api/v1/settings/logo`,
  autoRepliesSettings: `${apiUrl}/api/v1/settings/auto-replies`,
  settingsInventoryIntegration: `${apiUrl}/api/v1/settings/inventory-integration`,
  settingsInventoryIntegrationTest: `${apiUrl}/api/v1/settings/inventory-integration/test`,
  connectInstagram: `${apiUrl}/api/v1/settings/instagram`,
  disconnectInstagram: `${apiUrl}/api/v1/settings/instagram`,
  channels: `${apiUrl}/api/v1/channels`,
  connectChannel: (platform: string) => `${apiUrl}/api/v1/channels/${platform}`,
  connectInstagramBeta: `${apiUrl}/api/v1/channels/instagram_beta/connect`,
  instagramBetaEvents: `${apiUrl}/api/v1/channels/instagram_beta/events`,
  disconnectChannel: (platform: string) => `${apiUrl}/api/v1/channels/${platform}`,
  onboarding: `${apiUrl}/api/v1/onboarding`,
  onboardingRefresh: `${apiUrl}/api/v1/onboarding/refresh`,
  loginCodes: `${apiUrl}/api/v1/login-codes`,
  whatsappToolsStatus: `${apiUrl}/api/v1/whatsapp-tools/status`,
  whatsappToolsSend: `${apiUrl}/api/v1/whatsapp-tools/send-message`,
  smsToolsStatus: `${apiUrl}/api/v1/sms-tools/status`,
  smsToolsSend: `${apiUrl}/api/v1/sms-tools/send-message`,
  qaIssues: `${apiUrl}/api/v1/qa/issues`,
  qaAssignees: `${apiUrl}/api/v1/qa/assignees`,
  qaIssue: (id: string) => `${apiUrl}/api/v1/qa/issues/${encodeURIComponent(id)}`,
  messages: `${apiUrl}/api/v1/messages`,
  feeds: `${apiUrl}/api/v1/feeds`,
  feedsPost: `${apiUrl}/api/v1/feeds/post`,
  feedsPostLink: (platform: string, postId: string, inventoryItemId?: string) => {
    const base = `${apiUrl}/api/v1/feeds/posts/${encodeURIComponent(platform)}/${encodeURIComponent(postId)}/link`;
    if (!inventoryItemId) return base;
    const params = new URLSearchParams({ inventory_item_id: inventoryItemId });
    return `${base}?${params.toString()}`;
  },
  feedsPostDetail: (platform: string, postId: string, after?: string) => {
    const params = new URLSearchParams();
    if (after) params.set("after", after);
    const qs = params.toString();
    const base = `${apiUrl}/api/v1/feeds/posts/${encodeURIComponent(platform)}/${encodeURIComponent(postId)}`;
    return qs ? `${base}?${qs}` : base;
  },
  feedsPostInsights: (platform: string, postId: string) =>
    `${apiUrl}/api/v1/feeds/posts/${encodeURIComponent(platform)}/${encodeURIComponent(postId)}/insights`,
  feedsPlatform: (platform: string, after?: string) => {
    const params = new URLSearchParams({ platform });
    if (after) params.set("after", after);
    return `${apiUrl}/api/v1/feeds?${params.toString()}`;
  },
  botSandbox: `${apiUrl}/api/v1/messages/bot-sandbox`,
  botSandboxMessage: `${apiUrl}/api/v1/messages/bot-sandbox/message`,
  botSandboxReset: `${apiUrl}/api/v1/messages/bot-sandbox/reset`,
  conversationStarters: `${apiUrl}/api/v1/conversation-starters`,
  autoReply: `${apiUrl}/api/v1/auto-reply`,
  mpesaConfig: `${apiUrl}/api/v1/mpesa/config`,
  mpesaBusinessConfig: `${apiUrl}/api/v1/mpesa/business-config`,
  mpesaBusinessConfigVerify: `${apiUrl}/api/v1/mpesa/business-config/verify`,
  kraBusinessConfig: `${apiUrl}/api/v1/kra/business-config`,
  mpesaTest: `${apiUrl}/api/v1/mpesa/test`,
  mpesaStkPush: `${apiUrl}/api/v1/mpesa/stk-push`,
  mpesaTransactions: `${apiUrl}/api/v1/mpesa/transactions`,
  products: `${apiUrl}/api/v1/products`,
  product: (id: string) => `${apiUrl}/api/v1/products/${id}`,
  inventory: `${apiUrl}/api/v1/inventory`,
  inventoryImport: `${apiUrl}/api/v1/inventory/import`,
  inventoryByCode: (code: string) =>
    `${apiUrl}/api/v1/inventory/by-code?code=${encodeURIComponent(code)}`,
  inventoryStockMovements: `${apiUrl}/api/v1/inventory/stock-movements`,
  inventoryItem: (id: string) => `${apiUrl}/api/v1/inventory/${id}`,
  inventoryMedia: (id: string) => `${apiUrl}/api/v1/inventory/${id}/media`,
  inventoryMediaPost: (id: string) =>
    `${apiUrl}/api/v1/inventory/${id}/media/post`,
  inventoryUploadTokens: `${apiUrl}/api/v1/inventory/upload-tokens`,
  inventoryUploadTokensRevoke: `${apiUrl}/api/v1/inventory/upload-tokens/revoke`,
  inventoryUploadByToken: (token: string) =>
    `${apiUrl}/api/v1/inventory/upload-by-token/${encodeURIComponent(token)}`,
  shop: (token: string) =>
    `${apiUrl}/api/v1/shop/${encodeURIComponent(token)}`,
  shopCheckout: (token: string) =>
    `${apiUrl}/api/v1/shop/${encodeURIComponent(token)}/checkout`,
  orders: `${apiUrl}/api/v1/orders`,
  deliveries: `${apiUrl}/api/v1/deliveries`,
  delivery: (id: string) => `${apiUrl}/api/v1/deliveries/${encodeURIComponent(id)}`,
  deliveryHail: `${apiUrl}/api/v1/deliveries/hail`,
  deliveryRetryRiderSearch: (id: string) =>
    `${apiUrl}/api/v1/deliveries/${encodeURIComponent(id)}/retry-rider-search`,
  order: (id: string) => `${apiUrl}/api/v1/orders/${id}`,
  orderTestDelivery: `${apiUrl}/api/v1/orders/test-delivery`,
  orderHailRider: `${apiUrl}/api/v1/deliveries/hail`,
  orderRetryRiderSearch: (id: string) =>
    `${apiUrl}/api/v1/deliveries/${encodeURIComponent(id)}/retry-rider-search`,
  orderTransition: (id: string) => `${apiUrl}/api/v1/orders/${id}/transition`,
  orderMpesaStkPush: (id: string) =>
    `${apiUrl}/api/v1/orders/${id}/mpesa-stk-push`,
  orderMpesaCheck: (id: string) =>
    `${apiUrl}/api/v1/orders/${id}/mpesa-check`,
  mpesaTransactionCheck: (id: string) =>
    `${apiUrl}/api/v1/mpesa/transactions/${encodeURIComponent(id)}/check`,
  mpesaTransactionRetryStk: (id: string) =>
    `${apiUrl}/api/v1/mpesa/transactions/${encodeURIComponent(id)}/retry-stk`,
  orderSendReceiptEmail: (id: string) =>
    `${apiUrl}/api/v1/orders/${id}/send-receipt-email`,
  orderSendReceiptWhatsApp: (id: string) =>
    `${apiUrl}/api/v1/orders/${id}/send-receipt-whatsapp`,
  orderMpesaTransaction: (orderId: string, transactionId: string) =>
    `${apiUrl}/api/v1/orders/${orderId}/mpesa-transactions/${transactionId}`,
  orderMetaOptions: `${apiUrl}/api/v1/orders/meta/options`,
  orderTrack: (token: string) =>
    `${apiUrl}/api/v1/orders/track/${encodeURIComponent(token)}`,
  orderTrackConfirm: (token: string) =>
    `${apiUrl}/api/v1/orders/track/${encodeURIComponent(token)}/confirm-receipt`,
  orderTrackDispute: (token: string) =>
    `${apiUrl}/api/v1/orders/track/${encodeURIComponent(token)}/dispute-receipt`,
  orderTrackDeliveryDetails: (token: string) =>
    `${apiUrl}/api/v1/orders/track/${encodeURIComponent(token)}/delivery-details`,
  orderConfirmHandoff: (id: string) =>
    `${apiUrl}/api/v1/orders/${id}/confirm-handoff`,
  orderAssignRider: (id: string) =>
    `${apiUrl}/api/v1/orders/${id}/assign-rider`,
  customers: `${apiUrl}/api/v1/customers`,
  customersOwing: `${apiUrl}/api/v1/customers?owing=1`,
  customersImport: `${apiUrl}/api/v1/customers/import`,
  customer: (id: string) => `${apiUrl}/api/v1/customers/${encodeURIComponent(id)}`,
  customerUpdate: (id: string) =>
    `${apiUrl}/api/v1/customers/${encodeURIComponent(id)}/update`,
  customerCollect: (id: string) =>
    `${apiUrl}/api/v1/customers/${encodeURIComponent(id)}/collect`,
  customerCollection: (id: string, transactionId: string) =>
    `${apiUrl}/api/v1/customers/${encodeURIComponent(id)}/collections/${encodeURIComponent(transactionId)}`,
  customerSendWhatsAppReminder: (id: string) =>
    `${apiUrl}/api/v1/customers/${encodeURIComponent(id)}/send-whatsapp-reminder`,
  customerVerifyWhatsApp: `${apiUrl}/api/v1/customers/verify-whatsapp`,
  suppliers: `${apiUrl}/api/v1/suppliers`,
  suppliersImport: `${apiUrl}/api/v1/suppliers/import`,
  supplier: (id: string) => `${apiUrl}/api/v1/suppliers/${encodeURIComponent(id)}`,
  supplierUpdate: (id: string) =>
    `${apiUrl}/api/v1/suppliers/${encodeURIComponent(id)}/update`,
  riders: `${apiUrl}/api/v1/riders`,
  riderSuspend: (id: string) => `${apiUrl}/api/v1/riders/${id}/suspend`,
  riderSetEmail: (id: string) => `${apiUrl}/api/v1/riders/${id}/email`,
  riderUpdate: (id: string) => `${apiUrl}/api/v1/riders/${id}/update`,
  staff: `${apiUrl}/api/v1/staff`,
  staffLookup: (email: string) =>
    `${apiUrl}/api/v1/staff/lookup?email=${encodeURIComponent(email)}`,
  staffMember: (id: string) => `${apiUrl}/api/v1/staff/${id}`,
  staffPassword: (id: string) => `${apiUrl}/api/v1/staff/${id}/password`,
  staffPasswordResetLink: (id: string) =>
    `${apiUrl}/api/v1/staff/${id}/password/reset-link`,
  riderJoin: (token: string) =>
    `${apiUrl}/api/v1/riders/join/${encodeURIComponent(token)}`,
  riderMe: `${apiUrl}/api/v1/rider/me`,
  riderAuthRequestCode: `${apiUrl}/api/v1/rider/auth/request-code`,
  riderAuthVerifyCode: `${apiUrl}/api/v1/rider/auth/verify-code`,
  riderAuthLogout: `${apiUrl}/api/v1/rider/auth/logout`,
  riderPresence: `${apiUrl}/api/v1/rider/presence`,
  riderHeartbeat: `${apiUrl}/api/v1/rider/heartbeat`,
  riderOffers: `${apiUrl}/api/v1/rider/offers`,
  riderOfferAccept: (offerId: string) =>
    `${apiUrl}/api/v1/rider/offers/${encodeURIComponent(offerId)}/accept`,
  riderOfferDecline: (offerId: string) =>
    `${apiUrl}/api/v1/rider/offers/${encodeURIComponent(offerId)}/decline`,
  riderDeliveries: `${apiUrl}/api/v1/rider/deliveries`,
  riderDelivery: (deliveryId: string) =>
    `${apiUrl}/api/v1/rider/deliveries/${encodeURIComponent(deliveryId)}`,
  riderDeliveryTrip: (deliveryId: string) =>
    `${apiUrl}/api/v1/rider/deliveries/${encodeURIComponent(deliveryId)}/trip`,
  riderDeliveryDispatch: (deliveryId: string) =>
    `${apiUrl}/api/v1/rider/deliveries/${encodeURIComponent(deliveryId)}/dispatch`,
  riderDeliveryConfirm: (deliveryId: string) =>
    `${apiUrl}/api/v1/rider/deliveries/${encodeURIComponent(deliveryId)}/confirm`,
  riderEarnings: (period: string) =>
    `${apiUrl}/api/v1/rider/earnings?period=${encodeURIComponent(period)}`,
  orderResendCompletionPrompt: (id: string) =>
    `${apiUrl}/api/v1/orders/${id}/resend-completion-prompt`,
  orderPay: (token: string) =>
    `${apiUrl}/api/v1/pay/${encodeURIComponent(token)}`,
  orderPaySubmit: (token: string) =>
    `${apiUrl}/api/v1/pay/${encodeURIComponent(token)}/submit`,
  payBill: (token: string) =>
    `${apiUrl}/api/v1/pay-bill/${encodeURIComponent(token)}`,
  payBillSubmit: (token: string) =>
    `${apiUrl}/api/v1/pay-bill/${encodeURIComponent(token)}/submit`,
  payBillCollection: (token: string, transactionId: string) =>
    `${apiUrl}/api/v1/pay-bill/${encodeURIComponent(token)}/collections/${encodeURIComponent(transactionId)}`,
  adminLogin: `${apiUrl}/api/v1/auth/admin/login`,
  adminStats: `${apiUrl}/api/v1/admin/stats`,
  adminSuperAdmins: `${apiUrl}/api/v1/admin/super-admins`,
  adminMerchants: `${apiUrl}/api/v1/admin/merchants`,
  adminOrders: `${apiUrl}/api/v1/admin/orders`,
  adminWebhookEvents: `${apiUrl}/api/v1/admin/webhook-events`,
  adminWebhookEvent: (id: string) => `${apiUrl}/api/v1/admin/webhook-events/${id}`,
  adminOrder: (id: string) => `${apiUrl}/api/v1/admin/orders/${id}`,
  adminOrderTransition: (id: string) => `${apiUrl}/api/v1/admin/orders/${id}/transition`,
  adminMerchant: (id: string) => `${apiUrl}/api/v1/admin/merchants/${id}`,
  adminMerchantProfile: (id: string) =>
    `${apiUrl}/api/v1/admin/merchants/${id}/profile`,
  adminMerchantCoords: (id: string) =>
    `${apiUrl}/api/v1/admin/merchants/${id}/coords`,
  adminMerchantUsers: (merchantId: string) =>
    `${apiUrl}/api/v1/admin/merchants/${merchantId}/users`,
  adminMerchantUserLookup: (merchantId: string, email: string) =>
    `${apiUrl}/api/v1/admin/merchants/${merchantId}/users/lookup?email=${encodeURIComponent(email)}`,
  adminMerchantUserSections: (merchantId: string) =>
    `${apiUrl}/api/v1/admin/merchants/${merchantId}/users/sections`,
  adminMerchantChannelDetach: (merchantId: string, platform: string) =>
    `${apiUrl}/api/v1/admin/merchants/${merchantId}/channels/${encodeURIComponent(platform)}`,
  adminMerchantUserPassword: (merchantId: string, userId: string) =>
    `${apiUrl}/api/v1/admin/merchants/${merchantId}/users/${userId}/password`,
  adminMerchantUserPasswordResetLink: (merchantId: string, userId: string) =>
    `${apiUrl}/api/v1/admin/merchants/${merchantId}/users/${userId}/password/reset-link`,
  forgotPassword: `${apiUrl}/api/v1/auth/forgot-password`,
  passwordResetInfo: (token: string) =>
    `${apiUrl}/api/v1/auth/password-reset?token=${encodeURIComponent(token)}`,
  passwordReset: `${apiUrl}/api/v1/auth/password-reset`,
  changePassword: `${apiUrl}/api/v1/auth/change-password`,
  adminTestEmail: `${apiUrl}/api/v1/admin/test-email`,
  adminSimulatePayment: `${apiUrl}/api/v1/admin/simulate-payment`,
  adminMerchantPayout: `${apiUrl}/api/v1/admin/merchant-payout`,
  adminMpesaTransactions: `${apiUrl}/api/v1/admin/mpesa-transactions`,
  adminMpesaRelease: (id: string) =>
    `${apiUrl}/api/v1/admin/mpesa-transactions/${encodeURIComponent(id)}/release`,
  adminMpesaUnlock: (id: string) =>
    `${apiUrl}/api/v1/admin/mpesa-transactions/${encodeURIComponent(id)}/unlock`,
  adminMpesaConfirm: (id: string) =>
    `${apiUrl}/api/v1/admin/mpesa-transactions/${encodeURIComponent(id)}/confirm`,
  adminMpesaQuerySafaricom: (id: string) =>
    `${apiUrl}/api/v1/admin/mpesa-transactions/${encodeURIComponent(id)}/query-safaricom`,
  adminMpesaBalance: `${apiUrl}/api/v1/admin/mpesa-balance`,
  adminMpesaActivity: `${apiUrl}/api/v1/admin/mpesa-activity`,
  adminMpesaVerify: `${apiUrl}/api/v1/admin/mpesa-verify`,
  adminCatalogProducts: `${apiUrl}/api/v1/admin/catalog/products`,
  adminCatalogProduct: (id: string) => `${apiUrl}/api/v1/admin/catalog/products/${id}`,
  adminCatalogPrimaryImage: (id: string) =>
    `${apiUrl}/api/v1/admin/catalog/products/${id}/primary-image`,
  adminCatalogPrimaryImageAuto: (id: string) =>
    `${apiUrl}/api/v1/admin/catalog/products/${id}/primary-image/auto`,
  adminCatalogGenerateImage: (id: string) =>
    `${apiUrl}/api/v1/admin/catalog/products/${id}/generate-image`,
  adminCatalogBulkStatus: `${apiUrl}/api/v1/admin/catalog/products/bulk-status`,
  adminCatalogMealAddons: (mealId: string) =>
    `${apiUrl}/api/v1/admin/catalog/products/${encodeURIComponent(mealId)}/addons`,
  adminCatalogMealAddonItem: (mealId: string, addonId: string) =>
    `${apiUrl}/api/v1/admin/catalog/products/${encodeURIComponent(mealId)}/addons/${encodeURIComponent(addonId)}`,
  adminBotSandbox: (merchantId: string) =>
    `${apiUrl}/api/v1/admin/bot-sandbox?merchant_id=${encodeURIComponent(merchantId)}`,
  adminBotSandboxMessage: (merchantId: string) =>
    `${apiUrl}/api/v1/admin/bot-sandbox/message?merchant_id=${encodeURIComponent(merchantId)}`,
  adminBotSandboxReset: (merchantId: string) =>
    `${apiUrl}/api/v1/admin/bot-sandbox/reset?merchant_id=${encodeURIComponent(merchantId)}`,
  adminBotSandboxScript: (merchantId: string) =>
    `${apiUrl}/api/v1/admin/bot-sandbox/script?merchant_id=${encodeURIComponent(merchantId)}`,
  adminBotTrainingChat: (merchantId: string) =>
    `${apiUrl}/api/v1/admin/bot-sandbox/training-chat?merchant_id=${encodeURIComponent(merchantId)}`,
  adminBotTrainingChatReset: (merchantId: string) =>
    `${apiUrl}/api/v1/admin/bot-sandbox/training-chat/reset?merchant_id=${encodeURIComponent(merchantId)}`,
  adminMpesaConfig: `${apiUrl}/api/v1/mpesa/config`,
  adminMpesaTest: `${apiUrl}/api/v1/mpesa/test`,
  adminTigoConfig: `${apiUrl}/api/v1/tigo/config`,
  adminTigoTestToken: `${apiUrl}/api/v1/tigo/test/token`,
  adminTigoTestSystemStatus: `${apiUrl}/api/v1/tigo/test/system-status`,
  adminTigoTestValidateAccount: `${apiUrl}/api/v1/tigo/test/validate-account`,
  adminTigoTestPaymentAuth: `${apiUrl}/api/v1/tigo/test/payment-auth`,
  adminTigoTestDisburse: `${apiUrl}/api/v1/tigo/test/disburse`,
  adminWhatsappStatus: `${apiUrl}/api/v1/admin/whatsapp/status`,
  adminWhatsappSend: `${apiUrl}/api/v1/admin/whatsapp/send-message`,
  adminWhatsappLogout: `${apiUrl}/api/v1/admin/whatsapp/logout`,
  adminWhatsappRestart: `${apiUrl}/api/v1/admin/whatsapp/restart`,
  googleMapsConfig: `${apiUrl}/api/v1/google-maps/config`,
  googleMapsDeliveryRate: `${apiUrl}/api/v1/google-maps/config/delivery-rate`,
  googleMapsPublicConfig: `${apiUrl}/api/v1/google-maps/public-config`,
  googleMapsTest: `${apiUrl}/api/v1/google-maps/test`,
  aiAgentConfig: `${apiUrl}/api/v1/ai-agent/config`,
  aiAgentTest: `${apiUrl}/api/v1/ai-agent/test`,
  /** @deprecated Use googleMapsConfig */
  mapboxConfig: `${apiUrl}/api/v1/mapbox/config`,
  /** @deprecated Use googleMapsPublicConfig */
  mapboxPublicConfig: `${apiUrl}/api/v1/mapbox/public-config`,
  messagingSettings: `${apiUrl}/api/v1/messaging-settings`,
  ticket: (id: string) => `${apiUrl}/api/v1/tickets/${id}`,
  ticketResolve: (id: string) => `${apiUrl}/api/v1/tickets/${id}/resolve`,
  ticketAnalytics: (days = 30) =>
    `${apiUrl}/api/v1/tickets/analytics?days=${days}`,
  conversationTicketStatus: (id: string) =>
    `${apiUrl}/api/v1/messages/${id}/ticket-status`,
  platformRuntimeMode: `${apiUrl}/api/v1/platform/runtime-mode`,
  navCounts: `${apiUrl}/api/v1/nav-counts`,
  notifications: `${apiUrl}/api/v1/notifications`,
  notificationsRead: `${apiUrl}/api/v1/notifications/read`,
  storeStatus: `${apiUrl}/api/v1/store-status`,
  storeStatusPause: `${apiUrl}/api/v1/store-status/pause`,
  storeStatusResume: `${apiUrl}/api/v1/store-status/resume`,
  storeStatusBusy: `${apiUrl}/api/v1/store-status/busy`,
  storeStatusHeartbeat: `${apiUrl}/api/v1/store-status/heartbeat`,
  storeStatusPrepDefaults: `${apiUrl}/api/v1/store-status/prep-defaults`,
  storeStatusPushSubscribe: `${apiUrl}/api/v1/store-status/push-subscribe`,
  storeStatusPushUnsubscribe: `${apiUrl}/api/v1/store-status/push-unsubscribe`,
  storeStatusOrderPrep: (orderId: string) =>
    `${apiUrl}/api/v1/store-status/orders/${encodeURIComponent(orderId)}/prep`,
  bookingSettings: `${apiUrl}/api/v1/booking/settings`,
  bookingProviders: `${apiUrl}/api/v1/booking/providers`,
  bookingProvider: (id: string) =>
    `${apiUrl}/api/v1/booking/providers/${encodeURIComponent(id)}`,
  bookingHours: `${apiUrl}/api/v1/booking/hours`,
  bookingAppointments: `${apiUrl}/api/v1/booking/appointments`,
  bookingAppointment: (id: string) =>
    `${apiUrl}/api/v1/booking/appointments/${encodeURIComponent(id)}`,
  bookingAppointmentReschedule: (id: string) =>
    `${apiUrl}/api/v1/booking/appointments/${encodeURIComponent(id)}/reschedule`,
  salesAutopilotScript: `${apiUrl}/api/v1/settings/sales-autopilot-script`,
  publicBook: (slug: string, preview?: boolean) => {
    const base = `${apiUrl}/api/v1/book/${encodeURIComponent(slug)}`;
    return preview ? `${base}?preview=1` : base;
  },
  publicBookSlots: (
    slug: string,
    params: { inventory_item_id: string; day: string; provider_id?: string; preview?: boolean },
  ) => {
    const q = new URLSearchParams({
      inventory_item_id: params.inventory_item_id,
      day: params.day,
    });
    if (params.provider_id) q.set("provider_id", params.provider_id);
    if (params.preview) q.set("preview", "1");
    return `${apiUrl}/api/v1/book/${encodeURIComponent(slug)}/slots?${q.toString()}`;
  },
  publicBookDeposit: (slug: string, preview?: boolean) => {
    const base = `${apiUrl}/api/v1/book/${encodeURIComponent(slug)}/deposit`;
    return preview ? `${base}?preview=1` : base;
  },
  publicBookDepositStatus: (slug: string, token: string, preview?: boolean) => {
    const base = `${apiUrl}/api/v1/book/${encodeURIComponent(slug)}/deposit/${encodeURIComponent(token)}`;
    return preview ? `${base}?preview=1` : base;
  },
} as const;

/**
 * Public origin for production media when this stack uses prod data locally.
 * Example: https://merchants.dukai.app — DB keeps relative /uploads/... paths.
 */
export const uploadsPublicBaseUrl = (
  process.env.NEXT_PUBLIC_UPLOADS_PUBLIC_BASE_URL ?? ""
).replace(/\/$/, "");

/**
 * Resolve a backend-stored path (e.g. "/uploads/products/3/abc.jpg") into a
 * fully-qualified URL the browser can load. External URLs (http/https) are
 * returned unchanged. /uploads/* uses the production media host when set.
 */
export function resolveAssetUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/uploads/") && uploadsPublicBaseUrl) {
    return `${uploadsPublicBaseUrl}${path}`;
  }
  if (path.startsWith("/")) return `${apiUrl}${path}`;
  return path;
}
