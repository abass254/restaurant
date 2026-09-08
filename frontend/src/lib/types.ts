export type BusinessAccount = {
  id: string;
  business_name: string;
  business_location: string | null;
  business_category: string | null;
  logo_url?: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type InstagramAccount = {
  id: string;
  username: string | null;
  name: string | null;
  account_type: string | null;
  instagram_user_id: string | null;
  onboarding_complete: boolean;
  auto_replies_enabled?: boolean;
  onboarding_checks: Record<string, unknown> | null;
  granted_permissions: string | null;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string | null;
  username?: string | null;
  onboarded: boolean;
  user_role?: string | null;
  allowed_sections?: string[];
  is_activated?: boolean;
  require_change_password?: boolean;
  phone?: string | null;
  created_at?: string | null;
  instagram_account: InstagramAccount | null;
  account: BusinessAccount | null;
  active_account?: BusinessAccount | null;
  memberships?: {
    id: string;
    account_id: string;
    account: BusinessAccount;
    role: string;
    allowed_sections: string[];
    is_active: boolean;
  }[];
};

export type MerchantSectionOption = {
  key: string;
  label: string;
};

export type StaffUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  user_role: string | null;
  is_activated: boolean;
  require_change_password: boolean;
  allowed_sections: string[];
  created_at: string | null;
};

export type StaffListResponse = {
  data: StaffUser[];
  total: number;
  sections: MerchantSectionOption[];
};

export type UserInviteLookupResult = {
  found: boolean;
  user_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  already_member?: boolean;
  invite_blocked?: boolean;
  invite_blocked_reason?: string | null;
};

export type StaffActionResponse = {
  message: string;
  data: StaffUser;
  existing_user?: boolean;
};

export type StaffPasswordResponse = {
  message: string;
  user_id: string;
  require_change_password: boolean;
};

export type AdminUser = {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  phone: string | null;
  user_role: string | null;
  allowed_sections?: string[];
  is_activated: boolean;
  require_change_password: boolean;
  onboarded_at: string | null;
  created_at: string | null;
};

export type AdminMerchantSummary = {
  id: string;
  business_name: string;
  business_location: string;
  business_category: string;
  latitude: number | null;
  longitude: number | null;
  created_at: string | null;
  updated_at: string | null;
  users_count: number;
  instagram_connected: boolean;
  instagram_username: string | null;
};

export type AdminMpesaTransaction = {
  id: string;
  merchant_id: string | null;
  merchant_name: string | null;
  merchant_has_mpesa: boolean;
  merchant_payout_shortcode: string | null;
  merchant_payout_shortcode_type: string | null;
  merchant_transaction_account: string | null;
  phone_number: string;
  amount: number;
  account_reference: string;
  transaction_desc: string;
  status: string;
  has_received_money: boolean;
  result_code: number | null;
  result_desc: string | null;
  mpesa_receipt_number: string | null;
  checkout_request_id: string | null;
  merchant_request_id: string | null;
  order_id: string | null;
  booking_id: string | null;
  payout_status: string | null;
  payout_shortcode: string | null;
  payout_shortcode_type: string | null;
  payout_amount: number | null;
  payout_receipt_number: string | null;
  payout_result_desc: string | null;
  merchant_received_payout: boolean;
  can_send_to_merchant: boolean;
  can_unlock_payout?: boolean;
  can_confirm_collection?: boolean;
  can_query_safaricom?: boolean;
  is_admin_payout: boolean;
  is_client_collection: boolean;
  completed_at: string | null;
  payout_completed_at: string | null;
  created_at: string | null;
};

export type AdminMpesaTransactionsResponse = {
  data: AdminMpesaTransaction[];
  total: number;
};

export type AdminMpesaVerificationState =
  | "verified"
  | "amount_mismatch"
  | "status_mismatch"
  | "not_found"
  | "unresolved"
  | "pending";

export type AdminMpesaVerification = {
  state: AdminMpesaVerificationState;
  checked_at: string | null;
  safaricom_status: string | null;
  safaricom_amount: string | null;
  safaricom_receipt: string | null;
  safaricom_completed_at: string | null;
  debit_party: string | null;
  credit_party: string | null;
  charges: string | null;
  reason_type: string | null;
  result_desc: string | null;
};

export type AdminMpesaActivityEntry = {
  id: string;
  transaction_id: string;
  direction: "in" | "out";
  label: string;
  amount: number;
  at: string | null;
  counterparty: string | null;
  merchant_id: string | null;
  merchant_name: string | null;
  receipt_number: string | null;
  reference: string | null;
  order_id: string | null;
  can_verify: boolean;
  verification: AdminMpesaVerification | null;
};

export type AdminMpesaActivityResponse = {
  data: AdminMpesaActivityEntry[];
  money_in: number;
  money_out: number;
  net: number;
  shortcode: string | null;
  verified_count: number;
  mismatch_count: number;
  unverified_count: number;
  credentials_configured: boolean;
};

export type AdminMpesaVerifyResponse = {
  message: string;
  transaction_id: string;
  direction: "in" | "out";
  verification: AdminMpesaVerification;
};

/** One HTTP exchange with Tigo, as captured by the admin API console. */
export type TigoCall = {
  operation: string;
  ok: boolean;
  method: string;
  url: string;
  status_code: number | null;
  duration_ms: number;
  request_body: unknown;
  response_body: unknown;
  error: string | null;
  ran_at: string;
  reference_id?: string;
};

export type TigoConfig = {
  environment: string;
  base_url: string;
  partner_base_url: string | null;
  client_id_masked: string | null;
  client_secret_masked: string | null;
  account_msisdn: string | null;
  account_pin_masked: string | null;
  master_merchant_id: string | null;
  biller_code: string | null;
  callback_url: string;
  redirect_url: string;
  currency: string;
  secure_configured: boolean;
  partner_configured: boolean;
  rollout_enabled: boolean;
  allowlisted_accounts: number;
};

export type TigoConfigResponse = {
  config: TigoConfig;
  runtime_mode: string;
  message: string | null;
};

export type TigoTestResponse = {
  ok: boolean;
  message: string;
  calls: TigoCall[];
};

export type AdminMerchantChannel = {
  platform: string;
  label: string;
  icon: string;
  username: string | null;
  display_name: string | null;
  updated_at: string | null;
};

export type AdminMerchantDetail = {
  id: string;
  business_name: string;
  business_location: string;
  business_category: string;
  created_at: string | null;
  updated_at: string | null;
  users: AdminUser[];
  instagram_connected: boolean;
  instagram_username: string | null;
  connected_channels: AdminMerchantChannel[];
};

export type AdminDetachMerchantChannelResponse = {
  message: string;
  platform: string;
};

export type AdminMerchantsResponse = {
  data: AdminMerchantSummary[];
  total: number;
};

export type AdminOrderSummary = {
  id: string;
  account_id: string;
  merchant_name: string | null;
  order_number: string;
  source: OrderSource;
  fulfillment_type: OrderFulfillmentType;
  status: OrderStatus;
  customer_name: string | null;
  customer_phone: string | null;
  total: number;
  currency: string;
  payment_method: OrderPaymentMethod | null;
  items_count: number;
  created_at: string | null;
  updated_at: string | null;
  placed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};

export type AdminOrdersResponse = {
  data: AdminOrderSummary[];
  total: number;
};

export type AdminWebhookEvent = {
  id: string;
  received_at: string;
  signature_valid: boolean;
  signature_secret: string | null;
  http_status: number;
  object: string | null;
  event_type: string | null;
  sender_id: string | null;
  recipient_id: string | null;
  preview: string | null;
  processing_result: string | null;
  payload?: unknown;
};

export type AdminWebhookEventsResponse = {
  data: AdminWebhookEvent[];
  total: number;
};

export type AdminOrderDetailResponse = {
  data: Order;
  merchant_name: string | null;
};

export type BotTrainingMessage = {
  role: "user" | "assistant";
  content: string;
  sent_at?: string;
};

export type BotTrainingChatResponse = {
  merchant_id: string;
  messages: BotTrainingMessage[];
  current_instructions: string;
  reply?: string;
  sales_autopilot_script: SalesAutopilotScript;
};

export type SalesAutopilotScript = {
  tone: string;
  opening_line: string;
  payment_rule_line: string;
  consent_prompt: string;
  response_guidelines: string;
};

export type AdminBotSandboxScriptResponse = {
  merchant_id: string;
  sales_autopilot_script: SalesAutopilotScript;
};

export type AdminMerchantDetailResponse = {
  data: AdminMerchantDetail;
};

export type AdminSuperAdminsResponse = {
  data: AdminUser[];
  total: number;
};

export type AdminCreateSuperAdminResponse = {
  message: string;
  data: AdminUser;
};

export type AdminCreateMerchantUserResponse = {
  message: string;
  data: AdminUser;
  existing_user?: boolean;
};

export type AdminMerchantSectionsResponse = {
  sections: { key: string; label: string }[];
};

export type AdminResetUserPasswordResponse = {
  message: string;
  user_id: string;
  require_change_password: boolean;
};

export type AdminSendPasswordResetLinkResponse = {
  message: string;
  user_id: string;
  email: string;
};

export type PasswordResetInfo = {
  email: string | null;
  name: string;
};

export type ForgotPasswordResponse = {
  message: string;
  reset_link?: string | null;
};

export type PasswordResetResponse = {
  message: string;
};

export type AdminStatsResponse = {
  merchants: number;
  users: number;
  super_admins: number;
  instagram_accounts: number;
  mpesa_daraja_configured: boolean;
  merchants_mpesa_configured: number;
  google_maps_configured: boolean;
  ai_agent_configured: boolean;
};

export type GoogleMapsConfig = {
  id: string;
  api_key_masked: string | null;
  default_center_lat: number | null;
  default_center_lng: number | null;
  default_zoom: number | null;
  default_country: string | null;
  delivery_fee_per_km: number | null;
  is_active: boolean;
  is_configured: boolean;
};

export type GoogleMapsConfigResponse = {
  config: GoogleMapsConfig | null;
};

export type AiAgentConfig = {
  id: string;
  api_key_masked: string | null;
  chat_model: string | null;
  is_active: boolean;
  is_configured: boolean;
};

export type AiAgentConfigResponse = {
  config: AiAgentConfig | null;
  env_configured: boolean;
  active: boolean;
  provider: string | null;
};

export type AiAgentTestResponse = {
  ok: boolean;
  message: string;
  model: string | null;
};

export type GoogleMapsPublicConfig = {
  api_key: string | null;
  map_id: string | null;
  default_center_lat: number | null;
  default_center_lng: number | null;
  default_zoom: number | null;
  default_country: string | null;
  delivery_fee_per_km: number | null;
};

export type GoogleMapsCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type GoogleMapsTestResponse = {
  ok: boolean;
  message: string;
  checks: GoogleMapsCheck[];
};

/** @deprecated Use GoogleMapsConfig */
export type MapboxConfig = {
  id: string;
  access_token_masked: string | null;
  map_style: string;
  default_center_lat: number | null;
  default_center_lng: number | null;
  default_zoom: number | null;
  default_country: string | null;
  is_active: boolean;
  is_configured: boolean;
};

export type MapboxConfigResponse = {
  config: MapboxConfig | null;
};

export type MessagingSettings = {
  id: string;
  wait_dm_time_seconds: number;
  pause_auto_responses: boolean;
  allow_orders_when_store_closed: boolean;
  dm_bot: string;
};

export type MessagingSettingsResponse = {
  settings: MessagingSettings;
};

export type MapboxPublicConfig = {
  access_token: string | null;
  map_style: string;
  default_center_lat: number | null;
  default_center_lng: number | null;
  default_zoom: number | null;
  default_country: string | null;
};

export type InventoryIntegrationConfig = {
  catalog_source: "platform" | "external" | "hybrid";
  external: {
    type: string;
    base_url: string;
    auth: {
      type: string;
      token?: string | null;
      username?: string | null;
      password?: string | null;
      header_name?: string | null;
      header_value?: string | null;
    };
    endpoints: {
      search?: string | null;
      list?: string | null;
      get?: string | null;
      create_order?: string | null;
    };
    field_map?: Record<string, string>;
    cache_ttl_seconds?: number;
    browse_only?: boolean;
  } | null;
};

export type SettingsResponse = {
  user: AuthUser;
  instagram_connect_url: string;
  can_manage_instagram: boolean;
  platform_instagram_connected: boolean;
  supported_platforms?: string[];
  connected_platforms?: string[];
  any_channel_connected?: boolean;
  inventory_integration?: InventoryIntegrationConfig | null;
};

export type ChannelPlatform =
  | "instagram"
  | "instagram_beta"
  | "facebook"
  | "whatsapp"
  | "tiktok";

export type Channel = {
  platform: ChannelPlatform;
  label: string;
  tagline: string;
  icon: string;
  color: string;
  supports_oauth: boolean;
  supports_messaging: boolean;
  supports_password_login?: boolean;
  status_text: string;
  connect_url: string | null;
  connected: boolean;
  account: InstagramAccount | null;
  linked_instagram_username?: string | null;
};

export type InstagramBetaEvent = {
  id: string;
  event_type: string;
  status: string;
  instagram_username: string | null;
  message: string | null;
  metadata: Record<string, unknown>;
  created_at: string | null;
};

export type ChannelsResponse = {
  can_manage: boolean;
  channels: Channel[];
  connected_count: number;
  connected_platforms: ChannelPlatform[];
  any_connected: boolean;
  instagram_beta_enabled?: boolean;
  instagram_outbound_transport?: string;
  instagram_beta_connected?: boolean;
  official_instagram_username?: string | null;
  instagram_beta_events?: InstagramBetaEvent[];
  instagram_beta_pending_challenge?: InstagramBetaEvent | null;
};

export type ConnectChannelResponse = {
  message: string;
  channel: Channel;
};

export type FeedPostLinkedInventory = {
  inventory_item_id: string;
  product_id: string;
  product_name: string;
  product_code: string | null;
  selling_price: number | null;
  image_url: string | null;
};

export type FeedPost = {
  id: string;
  platform: ChannelPlatform;
  caption: string | null;
  media_type: string;
  image_url: string | null;
  video_url?: string | null;
  permalink: string | null;
  timestamp: string | null;
  like_count: number | null;
  comments_count: number | null;
  linked_inventory: FeedPostLinkedInventory[];
};

export type PlatformFeed = {
  platform: ChannelPlatform;
  label: string;
  icon: string;
  color: string;
  connected: boolean;
  can_fetch: boolean;
  connect_url: string | null;
  status_text: string | null;
  account: InstagramAccount | null;
  posts: FeedPost[];
  next_cursor: string | null;
  error: string | null;
};

export type FeedsResponse = {
  feeds: PlatformFeed[];
  connected_count: number;
  connected_platforms: ChannelPlatform[];
  any_connected: boolean;
};

export type FeedPostResponse = {
  message: string;
  platform: "instagram";
  media_id: string | null;
  permalink: string | null;
  post: FeedPost;
};

export type FeedPostLinkResponse = {
  message: string;
  linked_inventory: FeedPostLinkedInventory[];
};

export type FeedPostInsightMetric = {
  name: string;
  label: string;
  value: number | null;
  display_value?: string | null;
  breakdown?: Array<{ label: string; value: number; display_value?: string | null }>;
};

export type FeedPostInsights = {
  metrics: FeedPostInsightMetric[];
  by_name: Record<string, number | null>;
};

export type FeedPostComment = {
  id: string;
  text: string | null;
  username: string | null;
  timestamp: string | null;
  replies: FeedPostComment[];
};

export type FeedPostDetailResponse = {
  post: FeedPost;
  comments: FeedPostComment[];
  next_comment_cursor: string | null;
  insights: FeedPostInsights | null;
  insights_error: string | null;
  media_error: string | null;
  comments_error: string | null;
  interactions_note: string | null;
};

export type FeedPostCommentsResponse = {
  comments: FeedPostComment[];
  next_comment_cursor: string | null;
  comments_error: string | null;
};

export type FeedPostInsightsResponse = {
  post: FeedPost;
  insights: FeedPostInsights | null;
  insights_error: string | null;
  media_error: string | null;
};

export type OnboardingCheck = {
  key: string;
  label: string;
  description: string;
  passed: boolean;
  help_url: string | null;
};

export type OnboardingChecklist = {
  account: InstagramAccount;
  checks: OnboardingCheck[];
  help_links: Record<string, string>;
  permissions: {
    requested: string[];
    granted: string[];
    missing: string[];
  };
  onboarding_complete: boolean;
  message?: string;
};

export type InstagramMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  sent_at: string;
  sender_username: string | null;
  auto_replied: boolean;
};

export type TicketStatus = "open" | "closed";

export type TicketResolution = "solved" | "unsolved" | "auto_timeout";

export type SupportTicketEvent = {
  id: string;
  event_type: string;
  body?: string | null;
  actor_user_id?: string | null;
  created_at?: string | null;
};

export type SupportTicket = {
  id: string;
  ticket_number: number;
  display_number: string;
  status: string;
  resolution?: TicketResolution | null;
  close_reason?: string | null;
  opened_at?: string | null;
  closed_at?: string | null;
  first_customer_reply_at?: string | null;
  first_agent_reply_at?: string | null;
  resolved_at?: string | null;
  duration_seconds?: number | null;
  events?: SupportTicketEvent[] | null;
};

export type TicketAnalyticsSummary = {
  total_tickets: number;
  open_backlog: number;
  closed_tickets: number;
  solved_tickets: number;
  unsolved_tickets: number;
  auto_timeout_tickets: number;
  solve_rate_pct: number;
  auto_timeout_rate_pct: number;
  avg_duration_seconds: number | null;
  median_duration_seconds: number | null;
  avg_first_response_seconds: number | null;
  avg_first_customer_reply_seconds: number | null;
};

export type TicketAnalyticsDay = {
  date: string;
  label: string;
  opened: number;
  closed: number;
};

export type TicketAnalyticsBreakdown = {
  key: string;
  label: string;
  count: number;
};

export type TicketAnalyticsMenuSelection = {
  option: string;
  count: number;
};

export type TicketAnalyticsFunnelStep = {
  event_type: string;
  label: string;
  count: number;
};

export type TicketAnalyticsHourly = {
  hour: number;
  label: string;
  count: number;
};

export type TicketAnalyticsReport = {
  range_days: number;
  summary: TicketAnalyticsSummary;
  tickets_by_day: TicketAnalyticsDay[];
  resolution_breakdown: TicketAnalyticsBreakdown[];
  status_breakdown: TicketAnalyticsBreakdown[];
  menu_selections: TicketAnalyticsMenuSelection[];
  event_funnel: TicketAnalyticsFunnelStep[];
  hourly_volume: TicketAnalyticsHourly[];
};

export type TicketAnalyticsResponse = {
  data: TicketAnalyticsReport;
};

export type InstagramConversation = {
  id: string;
  platform?: ChannelPlatform;
  participant_username: string | null;
  participant_ig_id: string | null;
  participant_profile_pic_url?: string | null;
  last_message_at: string | null;
  last_read_at?: string | null;
  unread_count?: number;
  is_unread?: boolean;
  ticket_status?: TicketStatus;
  ticket_opened_at?: string | null;
  ticket_closed_at?: string | null;
  active_ticket?: SupportTicket | null;
  participant_is_typing?: boolean;
  agent_is_typing?: boolean;
  messages_count?: number;
  latest_message?: InstagramMessage | null;
  messages?: InstagramMessage[];
  live_agent_handoff?: boolean;
  agent_reply_allowed?: boolean;
};

export type InboxResponse = {
  conversations: InstagramConversation[];
  connected_platforms?: ChannelPlatform[];
  total_unread?: number;
  auto_replies_enabled?: boolean;
  sync_error: string | null;
  show_simulate_dm: boolean;
  instagram_beta_enabled?: boolean;
  instagram_outbound_transport?: string;
  instagram_beta_connected?: boolean;
};

export type SandboxChip = {
  label: string;
  send_text: string;
};

export type BotSandboxResponse = {
  client_sender_id: string;
  client_username: string;
  auto_replies_enabled: boolean;
  chips_only: boolean;
  free_messaging?: boolean;
  available_chips: SandboxChip[];
  conversation: InstagramConversation | null;
};

export type BotSandboxMessageResponse = {
  message: string;
  free_messaging?: boolean;
  available_chips: SandboxChip[];
  conversation: InstagramConversation;
};

export type NavCounts = {
  messages: number;
  tickets: number;
  orders: number;
};

export type NavCountsResponse = {
  data: NavCounts;
};

export type MerchantNotificationKind = "order" | "message" | "ticket" | "process";

export type MerchantNotification = {
  id: string;
  kind: MerchantNotificationKind;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string | null;
};

export type MerchantNotificationsResponse = {
  data: {
    notifications: MerchantNotification[];
  };
};

export type MerchantNotificationsReadResponse = {
  data: {
    marked: number;
  };
};

export type MpesaConfig = {
  id: string;
  environment: "sandbox" | "production";
  shortcode: string;
  shortcode_type: "paybill" | "till";
  consumer_key_masked: string | null;
  consumer_secret_masked: string | null;
  passkey_masked: string | null;
  callback_url: string | null;
  account_reference_prefix: string;
  b2b_initiator_name: string | null;
  b2b_security_credential_masked: string | null;
  b2b_auto_payout: boolean;
  b2b_result_url: string | null;
  is_active: boolean;
  last_tested_at: string | null;
  last_test_result: string | null;
  is_configured: boolean;
  source?: "env" | "db";
};

export type MpesaConfigResponse = {
  config: MpesaConfig | null;
  runtime_mode?: string;
  message?: string | null;
};

export type MerchantMpesaConfig = {
  id: string;
  account_id: string;
  shortcode: string;
  shortcode_type: "paybill" | "till" | "pochi" | "phone";
  account_number: string | null;
  is_configured: boolean;
};

export type MerchantMpesaConfigResponse = {
  config: MerchantMpesaConfig | null;
  suggested_phone?: string | null;
  dev_sample_data?: boolean;
};

export type MerchantMpesaVerifyResponse = {
  organization_name: string | null;
  lookup_source: "mpesa" | "manual";
  shortcode: string;
  shortcode_type: MerchantMpesaConfig["shortcode_type"];
  account_number: string | null;
  destination_label: string;
  verification_token: string;
  prompt: string;
};

export type KraIntegrationType = "vscu" | "oscu" | "device";

export type MerchantKraConfig = {
  id: string;
  account_id: string;
  enabled: boolean;
  kra_pin: string | null;
  integration_type: KraIntegrationType;
  control_unit_serial: string | null;
  branch_id: string | null;
  vat_registered: boolean;
  middleware_provider: string | null;
  is_configured: boolean;
};

export type MerchantKraConfigResponse = {
  config: MerchantKraConfig | null;
  message?: string;
};

export type MpesaTransaction = {
  id: string;
  phone_number: string;
  amount: number;
  account_reference: string;
  transaction_desc: string;
  status: "pending" | "success" | "failed" | "cancelled";
  result_code: number | null;
  result_desc: string | null;
  mpesa_receipt_number: string | null;
  merchant_request_id: string | null;
  checkout_request_id: string | null;
  completed_at: string | null;
  created_at: string | null;
  transaction_account?: string | null;
  payout_destination_shortcode?: string | null;
  payout_destination_type?: "paybill" | "till" | string | null;
  payout_status?: string | null;
  payout_shortcode?: string | null;
  payout_shortcode_type?: string | null;
  payout_amount?: number | null;
  payout_receipt_number?: string | null;
  payout_result_desc?: string | null;
  payout_completed_at?: string | null;
  order_id?: string | null;
};

export type MpesaTransactionsResponse = {
  transactions: MpesaTransaction[];
  dev_sample_data?: boolean;
};

export type MpesaStkPushResponse = {
  message: string;
  transaction: MpesaTransaction;
  outcome?: "paid" | "failed" | "pending" | "resent";
};

export type ProductType = "product" | "service";

export type ProductImage = {
  url: string;
  original_name: string;
  content_type?: string;
  size: number;
  uploaded_at: string;
  uploaded_by: string | null;
  source?: "ai_generated" | string;
  prompt?: string;
  generation?: {
    model?: string;
    size?: string;
    quality?: string;
    revised_prompt?: string | null;
  };
};

export type ProductImageGenerateResponse = {
  message: string;
  added: ProductImage;
  data: InventoryItem;
};

export type CatalogProduct = {
  id: string;
  product_code: string | null;
  sku: string | null;
  name: string;
  slug: string;
  product_type: ProductType;
  category: string | null;
  brand: string | null;
  unit: string | null;
  description: string | null;
  image_url: string | null;
  primary_image_locked?: boolean;
  attributes: Record<string, unknown> | null;
  created_by_account_id: string | null;
  created_by_user_id: string | null;
  shops_carrying_count?: number;
  created_at: string | null;
  updated_at: string | null;
};

export type CatalogProductsResponse = {
  data: CatalogProduct[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
};

export type InventoryRole = "for_sale" | "raw_material" | "both";

export type InventoryItem = {
  id: string;
  account_id: string;
  product_id: string;
  buying_price: number | null;
  selling_price: number | null;
  margin: number | null;
  stock_quantity: number | null;
  low_stock_threshold: number | null;
  inventory_role?: InventoryRole | string | null;
  is_active: boolean;
  is_low_stock: boolean;
  notes: string | null;
  media?: ProductImage[] | null;
  product?: CatalogProduct;
  created_at: string | null;
  updated_at: string | null;
};

export type InventoryResponse = {
  data: InventoryItem[];
};

export type InventoryImportRowResult = {
  row: number;
  name: string | null;
  sku: string | null;
  status: "created" | "updated" | "skipped" | "error";
  message: string | null;
};

export type InventoryImportResponse = {
  message: string;
  summary: {
    created: number;
    updated: number;
    skipped: number;
    errors: number;
  };
  detected_columns: Record<string, string>;
  rows: InventoryImportRowResult[];
};

export type InventoryItemMutationResponse = {
  message: string;
  data: InventoryItem;
};

export type StockMovementDirection = "in" | "out";
export type StockMovementReason =
  | "receive"
  | "adjustment"
  | "damage"
  | "other";

export type StockMovement = {
  id: string;
  account_id: string;
  inventory_item_id: string;
  direction: StockMovementDirection;
  quantity: number;
  quantity_before: number | null;
  quantity_after: number | null;
  reason: StockMovementReason | string;
  note: string | null;
  unit_cost?: number | null;
  created_by: string | null;
  created_at: string | null;
  inventory_item?: InventoryItem | null;
};

export type StockMovementsCreatePayload = {
  direction: StockMovementDirection;
  reason: StockMovementReason;
  note?: string | null;
  record_only?: boolean;
  lines: Array<{
    inventory_item_id: string;
    quantity: number;
    unit_cost?: number | null;
  }>;
};

export type StockMovementsResponse = {
  message: string;
  data: StockMovement[];
};

export type StockMovementsListResponse = {
  data: StockMovement[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
};

export type InventoryByCodeResponse = {
  data: InventoryItem;
};

export type InventoryItemDetailResponse = {
  data: InventoryItem;
};

export type ProductUploadTokenResponse = {
  token: string;
  upload_url: string;
  expires_at: string;
  expires_in: number;
  inventory_item_id: string;
  product: {
    id: string;
    name: string;
    image_url: string | null;
  };
};

export type ProductUploadTokenInfoResponse = {
  data: {
    product_id: string;
    inventory_item_id: string;
    name: string;
    brand: string | null;
    image_url: string | null;
  };
  expires_in: number;
};

export type ProductUploadByTokenResponse = {
  message: string;
  added: ProductImage[];
  count: number;
};

export type CatalogProductMutationResponse = {
  message: string;
  data: CatalogProduct;
};

export type ProductDetailResponse = {
  data: CatalogProduct;
};

export type ProductImageUploadResponse = {
  message: string;
  added: ProductImage[];
  data: InventoryItem;
};

export type InventoryMediaPostResponse = {
  message: string;
  platform: "instagram";
  media_id: string | null;
  permalink: string | null;
  post: FeedPost;
};

export type AdminStoreMediaItem = {
  url: string;
  original_name?: string | null;
  content_type?: string | null;
  size?: number | null;
  uploaded_at?: string | null;
  uploaded_by?: string | null;
  account_id: string;
  inventory_item_id: string;
  merchant_name?: string | null;
};

export type AdminCatalogProductDetail = {
  product: CatalogProduct;
  store_media: AdminStoreMediaItem[];
  shops_carrying_count: number;
};

export type AdminCatalogProductDetailResponse = {
  data: AdminCatalogProductDetail;
};

export type AdminCatalogProductsResponse = {
  data: CatalogProduct[];
  total: number;
};

export type OrderSource =
  | "walkin"
  | "phone_call"
  | "instagram"
  | "whatsapp"
  | "tiktok"
  | "facebook"
  | "rider_request";

export type OrderFulfillmentType = "pickup" | "delivery";

export type OrderPaymentMethod = "mpesa" | "cash" | "card" | "credit" | "other";

export type OrderStatus =
  | "placed"
  | "awaiting_payment"
  | "payment_received"
  | "being_prepared"
  | "ready"
  | "out_for_delivery"
  | "awaiting_delivery_confirmation"
  | "awaiting_pickup_confirmation"
  | "delivered"
  | "picked_up"
  | "cancelled"
  | "refunded";

export type OrderItem = {
  id: string;
  inventory_item_id: string | null;
  product_id: string | null;
  product_name: string;
  product_sku: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
  /** Current on-hand stock for the linked inventory item, when known. */
  stock_quantity?: number | null;
};

export type OrderStatusEvent = {
  id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_by_user_id: string | null;
  note: string | null;
  created_at: string | null;
};

export type OrderMpesaTransactionStatus =
  | "pending"
  | "success"
  | "failed"
  | "cancelled";

export type OrderMpesaTransaction = {
  id: string;
  phone_number: string;
  amount: number;
  status: OrderMpesaTransactionStatus | string;
  result_desc: string | null;
  mpesa_receipt_number: string | null;
  checkout_request_id: string | null;
  completed_at: string | null;
  created_at: string | null;
  account_reference?: string | null;
  payout_status?: string | null;
  payout_shortcode?: string | null;
  payout_shortcode_type?: string | null;
  payout_receipt_number?: string | null;
  payout_result_desc?: string | null;
  payout_completed_at?: string | null;
};

export type OrderMpesaSettlement = {
  transaction_account: string | null;
  payout_shortcode: string | null;
  payout_shortcode_type: string | null;
};

export type OrderMpesaPushStatus =
  | "sent"
  | "failed"
  | "not_configured"
  | "skipped";

export type OrderMpesaPushResult = {
  status: OrderMpesaPushStatus | string;
  message: string;
};

export type OrderWorkflowStep = {
  key: string;
  label: string;
  state: "done" | "current" | "upcoming" | "skipped";
};

export type OrderWorkflowAction = {
  kind:
    | "transition"
    | "confirm_mpesa_payment"
    | "mpesa_stk_push"
    | "confirm_handoff"
    | "resend_completion_prompt"
    | "cancel"
    | "refund"
    | "delete";
  label: string;
  to_status?: OrderStatus | null;
  variant?: "primary" | "secondary" | "danger";
  icon?: string | null;
  disabled?: boolean;
  disabled_reason?: string | null;
  requires_mpesa_receipt?: boolean;
};

/** Standalone or order-linked delivery trip (Tools → Delivery). */
export type DeliveryRecord = {
  id: string;
  delivery_number: string;
  order_id: string | null;
  status: string;
  pickup_address: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  delivery_address: string | null;
  delivery_notes: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_fee: number;
  currency: string;
  assigned_rider_id: string | null;
  assigned_rider_name?: string | null;
  rider_trip_phase?: RiderTripPhase | null;
  rider_search_expires_at?: string | null;
  created_at: string | null;
  updated_at: string | null;
  cancelled_at?: string | null;
  completed_at?: string | null;
};

export type DeliveriesListResponse = {
  data: DeliveryRecord[];
};

export type DeliveryHailResponse = {
  message: string;
  data: DeliveryRecord & {
    offers_created?: number;
    online_riders?: number;
    eligible_riders?: number;
  };
};

export type Order = {
  id: string;
  account_id: string;
  order_number: string;
  source: OrderSource;
  fulfillment_type: OrderFulfillmentType;
  status: OrderStatus;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  delivery_address: string | null;
  delivery_notes: string | null;
  pickup_address?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  subtotal: number;
  delivery_fee: number;
  discount: number;
  total: number;
  currency: string;
  payment_method: OrderPaymentMethod | null;
  mpesa_transaction_id: string | null;
  mpesa_transaction?: OrderMpesaTransaction | null;
  mpesa_transactions?: OrderMpesaTransaction[] | null;
  mpesa_settlement?: OrderMpesaSettlement | null;
  placed_by_user_id: string | null;
  placed_at: string | null;
  paid_at: string | null;
  prepared_at: string | null;
  ready_at: string | null;
  dispatched_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  merchant_delivery_confirmed_at: string | null;
  customer_delivery_confirmed_at: string | null;
  delivery_disputed_at: string | null;
  notes: string | null;
  prep_minutes?: number | null;
  created_at: string | null;
  updated_at: string | null;
  items?: OrderItem[];
  status_history?: OrderStatusEvent[];
  items_count?: number | null;
  allowed_next_statuses?: OrderStatus[] | null;
  workflow_actions?: OrderWorkflowAction[] | null;
  workflow_steps?: OrderWorkflowStep[] | null;
  tracking_url?: string | null;
  assigned_rider_id?: string | null;
  assigned_rider_name?: string | null;
  rider_assigned_at?: string | null;
  rider_dispatched_at?: string | null;
  rider_trip_phase?: string | null;
  rider_search_expires_at?: string | null;
};

export type OrdersListResponse = {
  data: Order[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
};

export type OrderDetailResponse = {
  data: Order;
};

export type OrderMutationResponse = {
  message: string;
  data: Order;
  mpesa_push?: OrderMpesaPushResult;
  outcome?: "paid" | "failed" | "pending" | "resent";
  recipient?: string;
};

export type OrderMetaOptionsResponse = {
  sources: OrderSource[];
  fulfillment_types: OrderFulfillmentType[];
  statuses: OrderStatus[];
  payment_methods: OrderPaymentMethod[];
};

export type OrderCreatePayload = {
  source: OrderSource;
  fulfillment_type: OrderFulfillmentType;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  delivery_address?: string | null;
  delivery_notes?: string | null;
  payment_method?: OrderPaymentMethod | null;
  delivery_fee?: number | null;
  discount?: number | null;
  currency?: string;
  notes?: string | null;
  items: {
    inventory_item_id?: string | null;
    product_name?: string | null;
    product_sku?: string | null;
    quantity: number;
    unit_price?: number | null;
    notes?: string | null;
  }[];
};

export type PublicOrderTrackingItem = {
  product_name: string;
  quantity: number;
  line_total: number;
};

export type PublicOrderMpesaPayment = {
  status: OrderMpesaTransactionStatus | string;
  message: string | null;
  can_retry: boolean;
};

export type PublicOrderPayment = {
  order_number: string;
  status: OrderStatus;
  merchant: { name: string };
  currency: string;
  total: number;
  items: PublicOrderTrackingItem[];
  suggested_name: string;
  saved_phone: string | null;
  has_saved_profile: boolean;
  is_paid: boolean;
  can_pay: boolean;
  tracking_url: string | null;
  platform: string;
  fulfillment_type: OrderFulfillmentType;
  delivery_details: PublicOrderDeliveryDetails;
  mpesa_payment: PublicOrderMpesaPayment | null;
  /** In platform dev mode, Daraja STK push is always KES 1 regardless of order total. */
  dev_mpesa_charge?: number | null;
};

export type PublicOrderPaymentResponse = {
  data: PublicOrderPayment;
};

export type PublicOrderPaymentSubmitResponse = {
  data: {
    order_number: string;
    message: string;
    mpesa_message: string;
    tracking_url: string | null;
    mpesa_payment: PublicOrderMpesaPayment | null;
  };
};

export type PublicOrderDeliveryDetails = {
  full_name: string | null;
  phone_number: string | null;
  delivery_location: string | null;
  delivery_instructions: string | null;
};

export type PublicOrderTracking = {
  order_number: string;
  status: OrderStatus;
  status_label: string;
  fulfillment_type: OrderFulfillmentType;
  merchant: { name: string };
  currency: string;
  subtotal: number;
  delivery_fee: number;
  discount: number;
  total: number;
  items: PublicOrderTrackingItem[];
  workflow_steps: OrderWorkflowStep[];
  needs_delivery_details: boolean;
  can_submit_delivery_details: boolean;
  delivery_details: PublicOrderDeliveryDetails;
  is_terminal: boolean;
  awaiting_confirmation: boolean;
  can_confirm_receipt: boolean;
  can_dispute_receipt: boolean;
  merchant_confirmed: boolean;
  customer_confirmed: boolean;
  delivery_disputed: boolean;
  placed_at: string | null;
  paid_at: string | null;
  prepared_at: string | null;
  ready_at: string | null;
  dispatched_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  updated_at: string | null;
};

export type PublicOrderTrackingResponse = {
  data: PublicOrderTracking;
};

export type PublicOrderDeliveryDetailsResponse = {
  message: string;
  data: PublicOrderTracking;
};

export type ShopCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  credit_limit: number;
  outstanding_balance: number;
  available_credit: number;
  created_at: string | null;
  updated_at: string | null;
};

export type ShopCustomersListResponse = {
  data: ShopCustomer[];
  total: number;
  owing_total?: number;
};

export type ShopCustomerMutationResponse = {
  message: string;
  data: ShopCustomer;
};

export type CreditCollection = {
  id: string;
  status: string;
  amount: number;
  collected?: boolean;
};

export type CreditCollectResponse = {
  message: string;
  data: ShopCustomer;
  collection: CreditCollection;
};

export type CreditCollectionStatusResponse = {
  message: string | null;
  data: ShopCustomer;
  collection: CreditCollection;
};

export type RiderStatus = "invited" | "active" | "suspended" | "removed";

export type RiderSummary = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  status: RiderStatus | string;
  vehicle_type: string | null;
  notes: string | null;
  invited_at: string | null;
  activated_at: string | null;
  active_deliveries_count: number;
  is_online?: boolean;
  last_seen_at?: string | null;
  last_lat?: number | null;
  last_lng?: number | null;
};

export type RidersListResponse = {
  data: RiderSummary[];
};

export type RiderInviteResult = {
  rider: RiderSummary;
  invite_url: string;
  expires_at: string;
  email_sent?: boolean;
};

export type RiderInviteResponse = {
  message: string;
  data: RiderInviteResult;
};

export type TestDeliveryDispatchResponse = {
  message: string;
  data: {
    order: {
      id: string;
      order_number: string;
      status: string;
      fulfillment_type: string;
      delivery_fee: number | string;
      total: number | string;
    };
    offers_created: number;
    online_riders: number;
    eligible_riders: number;
  };
};

export type RiderJoinInfo = {
  rider_name: string;
  merchant_name: string;
  phone: string;
  email?: string | null;
  already_active: boolean;
  needs_email?: boolean;
  deliveries_url: string;
};

export type RiderJoinInfoResponse = {
  data: RiderJoinInfo;
};

export type RiderAcceptResponse = {
  message: string;
  data: {
    rider_id: string;
    rider_name: string;
    merchant_name: string;
    deliveries_url: string;
  };
};

export type RiderTripPhase =
  | "en_route_to_store"
  | "at_store"
  | "picking_up"
  | "en_route_to_client"
  | "at_client"
  | "completed"
  | "cancelled"
  | string;

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

export type RiderMeResponse = {
  data: RiderMe;
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
  status: OrderStatus | string;
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

export type RiderDeliveriesResponse = {
  data: RiderDelivery[];
};

export type RiderDeliveryMutationResponse = {
  message: string;
  data: RiderDelivery;
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
  delivery_address: string | null;
  item_count: number;
  payout_estimate: number;
  currency: string;
  total: number;
};

export type RiderOffersResponse = {
  data: RiderOffer[];
};

export type RiderHeartbeatResponse = {
  data: {
    is_online: boolean;
    last_seen_at: string | null;
    offers: RiderOffer[];
    active_trip_id: string | null;
    active_trip_phase: RiderTripPhase | null;
    active_trip_route: string | null;
  };
};

export type RiderLoginCodeResponse = {
  data: {
    message: string;
    expires_in_seconds: number;
    login_code: string | null;
    phone_masked: string | null;
    email_masked?: string | null;
    channel?: "phone" | "email" | string;
    code_sent?: boolean;
  };
};

export type LoginCodeRecord = {
  id: string;
  audience: "merchant" | "rider" | string;
  recipient_name: string | null;
  recipient_masked: string | null;
  channel: string | null;
  delivery_status: string | null;
  lifecycle_status: "active" | "used" | "expired" | string;
  purpose: string | null;
  created_at: string | null;
  expires_at: string | null;
  consumed_at: string | null;
};

export type LoginCodesListResponse = {
  data: LoginCodeRecord[];
};

export type WhatsappToolsStatus = {
  enabled: boolean;
  configured: boolean;
  ready: boolean;
};

export type WhatsappTestSendResponse = {
  sent: boolean;
  message: string;
  message_id: string | null;
};

export type SmsToolsStatus = {
  configured: boolean;
  sandbox: boolean;
  sender_id_set: boolean;
  ready: boolean;
};

export type SmsTestSendResponse = {
  sent: boolean;
  message: string;
  message_id: string | null;
};

export type QaIssueRecord = {
  id: string;
  key: string;
  issue_number: number;
  summary: string;
  description: string | null;
  issue_type: string;
  priority: string;
  component: string;
  status: string;
  page_url: string | null;
  steps_to_reproduce: string | null;
  reporter_name: string | null;
  reporter_email: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  account_name: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type QaIssuesListResponse = {
  data: QaIssueRecord[];
};

export type QaAssigneeRecord = {
  id: string;
  name: string;
  email?: string | null;
};

export type QaAssigneesListResponse = {
  data: QaAssigneeRecord[];
};

export type RiderEarningsTrip = {
  id: string;
  order_number: string;
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

export type RiderEarningsResponse = {
  data: RiderEarnings;
};

export type StoreStatusValue = "open" | "busy" | "paused";

export type StoreStatus = {
  status: StoreStatusValue;
  accepting_orders: boolean;
  orders_paused: boolean;
  orders_paused_until: string | null;
  orders_paused_reason: string | null;
  busy_extra_prep_minutes: number;
  default_prep_minutes: number;
  effective_prep_minutes: number;
  station_heartbeat_required: boolean;
  station_last_heartbeat_at: string | null;
  station_heartbeat_stale: boolean;
  seconds_since_heartbeat: number | null;
  heartbeat_stale_after_seconds: number;
  business_name: string | null;
};

export type StoreStatusResponse = {
  message?: string;
  data: StoreStatus;
};
