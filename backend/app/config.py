from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.env_files import PROJECT_ROOT, dukai_env_files


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=dukai_env_files(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "DukAI"
    app_env: str = "local"
    app_debug: bool = True
    app_url: str = "http://127.0.0.1:7001"
    frontend_url: str = "http://127.0.0.1:7000"
    app_key: str = ""

    session_secret: str = "change-me-in-production"
    session_cookie_name: str = "dukai_session"
    session_max_age: int = 7200

  # Match Laravel: root .env uses DB_CONNECTION=sqlite by default
    db_connection: str = "sqlite"
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_database: str = ""
    db_username: str = "dukai"
    db_password: str = ""

    cors_allowed_origins: str = "http://127.0.0.1:7000,http://localhost:7000"
    # Comma-separated frontend origins allowed in OAuth return redirects (e.g.
    # https://dukai.app,https://uat.dukai.app). When empty, FRONTEND_URL and
    # CORS_ALLOWED_ORIGINS are used. Prod callback must list every env users
    # can start OAuth from.
    oauth_allowed_return_origins: str = ""

    meta_app_id: str = ""
    instagram_app_id: str = ""
    instagram_app_secret: str = ""
    meta_app_secret: str = ""
    # Must match Meta + the hub exactly. Do not use this app's /instagram/callback.
    instagram_redirect_uri: str = "https://dukai.app/instagram/callback"
    instagram_hub_url: str = "https://dukai.app"
    dukai_platform: str = "merchant"
    instagram_graph_version: str = "v21.0"
    meta_webhook_verify_token: str = ""
    meta_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_business_account_id: str = ""

    # Google Sign-In for merchant signup/login (optional — button hidden when empty).
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    google_oauth_redirect_uri: str = "http://127.0.0.1:7001/auth/google/callback"

    # Shared Instagram inbox for all merchants on this deployment (see platform_instagram.py).
    platform_instagram_account_id: str | None = None

    # Default true for local dev; set INSTAGRAM_FAKE_MESSAGING=false in .env for real sends.
    instagram_fake_messaging: bool = True
    instagram_show_simulate_dm: bool = True
    # Bot reply modeler (/bot page + /api/v1/messages/bot-sandbox*). Default on.
    bot_preview_enabled: bool = True
    # Deprecated: chip-only on live Instagram follows the shop auto-reply toggle.
    instagram_dm_chips_only: bool = False
    # When false, new DM tickets open silently (no greeting menu). Set
    # INSTAGRAM_DM_GREETING_ENABLED=false to skip the welcome message.
    instagram_dm_greeting_enabled: bool = True
    instagram_simulate_dm_sender_id: str = "999888777666"
    sales_autopilot_enabled: bool = True
    # Session-based Instagram Beta (instagrapi) — enable on UAT first; keep false on prod until ready.
    instagram_beta_enabled: bool = False
    # beta | official | auto — auto uses beta when merchant has instagram_beta connected.
    instagram_outbound_transport: str = "auto"

    # --- AI DM agent (replaces rule-based menu when enabled) ----------------
    dm_agent_enabled: bool = True
    dm_agent_provider: str = "auto"  # auto|gemini|groq|cloudflare|ollama|openai
    dm_agent_model: str = ""
    dm_agent_max_history: int = 20
    dm_agent_max_tool_rounds: int = 6
    dm_agent_timeout_seconds: float = 30.0
    # AI replies on Instagram post comments (uses same LLM provider as DM agent).
    comment_agent_enabled: bool = True
    gemini_chat_model: str = "gemini-2.5-flash"
    groq_api_key: str = ""
    groq_api_base: str = "https://api.groq.com/openai/v1"
    groq_chat_model: str = "llama-3.3-70b-versatile"
    ollama_api_base: str = "http://127.0.0.1:11434"
    ollama_chat_model: str = "llama3.1"
    openai_chat_model: str = "gpt-4o-mini"

    # Safaricom Daraja sandbox (platform Mode = Dev). Create a sandbox app at
    # developer.safaricom.co.ke and paste the consumer key/secret here.
    mpesa_sandbox_consumer_key: str = ""
    mpesa_sandbox_consumer_secret: str = ""
    mpesa_sandbox_passkey: str = ""
    mpesa_sandbox_account_reference_prefix: str = "PAY"
    mpesa_sandbox_b2b_initiator: str = ""
    mpesa_sandbox_b2b_security_credential: str = ""
    mpesa_sandbox_b2b_auto_payout: bool = False

    # Safaricom Daraja production hub (MPESA_MODE=production, or platform Mode = Production).
    # Set these in .env — they are no longer editable from the admin UI.
    mpesa_mode: str = ""  # production|sandbox — empty follows platform Mode toggle
    mpesa_consumer_key: str = ""
    mpesa_consumer_secret: str = ""
    mpesa_passkey: str = ""
    mpesa_shortcode: str = ""
    mpesa_shortcode_type: str = "paybill"
    mpesa_callback_url: str = ""  # empty → {APP_URL}/mpesa/callback
    mpesa_account_reference_prefix: str = "PAY"
    mpesa_b2b_initiator: str = ""
    mpesa_b2b_security_credential: str = ""
    mpesa_b2b_auto_payout: bool = False
    # Before merchant B2B, sweep Utility → Working via BusinessTransferFromUtilityToMMF.
    # Requires the B2B initiator to be allowed Intra Account transfers on the org portal.
    # Set MPESA_B2B_UTILITY_TO_WORKING=false to pay from Working without the sweep.
    # B2C phone payouts skip this sweep (they debit Utility). Same initiator needs the B2C role.
    mpesa_b2b_utility_to_working: bool = True
    # Production org rails (B2C/B2B/Pochi) typically reject under KES 10.
    mpesa_min_stk_amount: int = 1
    mpesa_min_b2c_amount: int = 10
    mpesa_min_b2b_amount: int = 10
    mpesa_min_sandbox_amount: int = 1
    mpesa_max_amount: int = 150000

    # --- AI image generation ------------------------------------------------
    # Master switch. When false, the generate endpoint returns a friendly 503
    # regardless of which provider keys are present.
    image_generation_enabled: bool = True

    # Provider selector. "auto" picks the best provider for which credentials
    # are available, preferring OpenAI > Cloudflare > Pollinations > Gemini
    # (Gemini image output needs billing). On quota errors we fall back to the
    # next configured provider automatically. Set an explicit value to pin one.
    image_generation_provider: str = "auto"  # auto|openai|gemini|cloudflare|pollinations

    image_generation_size: str = "1024x1024"
    image_generation_timeout_seconds: float = 60.0
    # gpt-image-1 understands this directly; other providers map it to their
    # own knobs (Cloudflare → steps; Gemini/Pollinations ignore it).
    image_generation_quality: str = "low"

    # --- OpenAI (paid, premium quality) ---
    openai_api_key: str = ""
    openai_api_base: str = "https://api.openai.com/v1"
    openai_image_model: str = "gpt-image-1"

    # --- Google Gemini (chat works on free tier; image output needs billing) ---
    gemini_api_key: str = ""
    gemini_api_base: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_image_model: str = "gemini-2.5-flash-image"

    # --- Cloudflare Workers AI (10k req/day free) ---
    cloudflare_account_id: str = ""
    cloudflare_api_token: str = ""
    cloudflare_image_model: str = "@cf/black-forest-labs/flux-1-schnell"
    # Function-calling model for DM/comment agents (OpenAI-compatible API).
    cloudflare_chat_model: str = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"

    # --- Pollinations. As of 2026 Pollinations retired anonymous image
    # generation: the old image.pollinations.ai/prompt endpoint is gone and
    # the unified gen.pollinations.ai API requires a (free) API key. Create one
    # at enter.pollinations.ai and set POLLINATIONS_TOKEN. `flux` is the
    # cheapest image model and the API default. (`turbo` no longer exists.)
    pollinations_base_url: str = "https://gen.pollinations.ai"
    pollinations_model: str = "flux"
    pollinations_token: str = ""

    # --- Google Maps (location pickers) -------------------------------------
    # Browser-restricted API key for Maps JavaScript + Places + Geocoding.
    # Super admins can override via the google_maps_configurations table.
    google_maps_api_key: str = ""
    # Cloud map ID for Advanced Markers (Map Management in Google Cloud Console).
    google_maps_map_id: str = ""

    # --- Email (Mailtrap Sending API) ---------------------------------------
    # Master switch. When false, emails are logged but never sent (handy for
    # local dev so you don't burn Mailtrap quota).
    mail_enabled: bool = False
    # Mailtrap "Sending" API token (Bearer). Get it from Mailtrap → Sending
    # Domains → API tokens. This is NOT the inbox/testing SMTP password.
    mailtrap_api_token: str = ""
    # Transactional Send API endpoint. Use the bulk endpoint
    # (https://bulk.api.mailtrap.io/api/send) for high-volume campaigns, or the
    # sandbox endpoint for the testing inbox.
    mailtrap_send_api_url: str = "https://send.api.mailtrap.io/api/send"
    # The "from" identity. Until you verify your own sending domain in Mailtrap,
    # use their demo domain (e.g. hello@demomailtrap.co), which can only deliver
    # to the email address that owns the Mailtrap account.
    mail_from_address: str = "hello@demomailtrap.co"
    mail_from_name: str = "DUKAI PLATFORM"
    mail_timeout_seconds: float = 20.0

    instagram_oauth_authorize_url: str = "https://www.instagram.com/oauth/authorize"
    instagram_oauth_token_url: str = "https://api.instagram.com/oauth/access_token"
    instagram_graph_base_url: str = "https://graph.instagram.com"
    instagram_scopes: list[str] = [
        "instagram_business_basic",
        "instagram_business_manage_messages",
        "instagram_business_manage_comments",
        "instagram_business_manage_insights",
        "instagram_business_content_publish",
    ]
    instagram_webhook_subscribed_fields: list[str] = ["messages", "messaging_postbacks", "comments"]
    instagram_help_links: dict[str, str] = {
        "create_meta_app": "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/create-a-meta-app-with-instagram",
        "business_login": "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/",
        "switch_professional": "https://www.facebook.com/business/help/898752960195806",
        "instagram_testers": "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/create-a-meta-app-with-instagram#step-4--add-an-instagram-test-account",
    }
    # Sent once, as the first auto-reply to a brand-new participant, when no
    # auto-reply rule matched their opening message. Carries the same chips
    # (active conversation starters) as quick replies so the customer can tap.
    # {username} is replaced with the customer's IG handle (or "there").
    instagram_welcome_quick_reply_text: str = (
        "Hi {username}! Thanks for the message. "
        "Tap one of the options below or just tell us what you need."
    )

    instagram_default_conversation_starters: list[dict[str, str]] = [
        {
            "question": "I'd like to place an order.",
            "payload": "starter_place_order",
            "reply_text": "",
        },
        {
            "question": "I'd like to enquire about your product",
            "payload": "starter_product_enquiry",
            "reply_text": "",
        },
        {
            "question": "I'd like to chat with a live agent.",
            "payload": "starter_live_agent",
            "reply_text": "",
        },
    ]

    @property
    def database_url(self) -> str:
        if self.db_connection.lower() == "sqlite":
            db_path = self.db_database or str(PROJECT_ROOT / "database" / "database.sqlite")
            if not Path(db_path).is_absolute():
                db_path = str(PROJECT_ROOT / db_path)
            return f"sqlite:///{db_path}"

        database = self.db_database or "dukai"
        return (
            f"mysql+pymysql://{self.db_username}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{database}?charset=utf8mb4"
        )

    @property
    def cors_origins(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_allowed_origins.split(",")
            if origin.strip()
        ]

    @property
    def oauth_return_origins(self) -> list[str]:
        if self.oauth_allowed_return_origins.strip():
            return [
                origin.strip().rstrip("/")
                for origin in self.oauth_allowed_return_origins.split(",")
                if origin.strip()
            ]

        origins = {self.frontend_url.rstrip("/")}
        origins.update(origin.rstrip("/") for origin in self.cors_origins)
        origins.update(
            {
                "https://dukai.app",
                "https://uat.dukai.app",
                "https://merchants.dukai.app",
                "http://127.0.0.1:7000",
                "http://localhost:7000",
            },
        )
        return sorted(origins)

    def validate_oauth_return_origin(self, origin: str) -> str:
        normalized = origin.rstrip("/")
        if normalized not in self.oauth_return_origins:
            allowed = ", ".join(self.oauth_return_origins)
            raise ValueError(
                f"OAuth return origin not allowed: {origin}. Allowed: {allowed}",
            )
        return normalized

    def instagram_hub_connect_url(self, state: str, *, origin: str | None = None) -> str:
        from app.core.instagram_hub import hub_connect_url

        return hub_connect_url(self, state, origin=origin)

    def instagram_callback_url_for_origin(self, origin: str) -> str:
        """Per-origin callback URL (legacy). OAuth uses effective_instagram_redirect_uri."""
        base = self.validate_oauth_return_origin(origin)
        return f"{base}{self.instagram_oauth_callback_path}"

    @property
    def instagram_oauth_callback_path(self) -> str:
        """Path segment registered with Meta (default /instagram/callback)."""
        uri = self.instagram_redirect_uri.strip()
        if uri:
            path = urlparse(uri).path.rstrip("/")
            if path:
                return path
        return "/instagram/callback"

    @staticmethod
    def _is_legacy_local_redirect_uri(uri: str) -> bool:
        """http://127.0.0.1:* or http://localhost:* OAuth placeholders (incl. Docker :7070)."""
        if not uri:
            return True
        parsed = urlparse(uri)
        if not parsed.path.rstrip("/").endswith("instagram/callback"):
            return False
        return parsed.hostname in ("127.0.0.1", "localhost")

    @property
    def _canonical_oauth_base_url(self) -> str:
        """HTTPS origin for the shared Meta OAuth callback."""
        uri = self.instagram_redirect_uri.strip()
        if uri.startswith("https://"):
            parsed = urlparse(uri)
            return f"{parsed.scheme}://{parsed.netloc}"
        # Local/docker http placeholders always promote to prod callback host.
        return "https://dukai.app"

    @property
    def effective_instagram_redirect_uri(self) -> str:
        """
        OAuth redirect must match Meta app settings exactly.

        - Explicit https URL (e.g. https://dukai.app/instagram/callback): use as-is.
        - Localhost placeholders (127.0.0.1:7000, :7070, etc.) map to the canonical
          HTTPS callback so Meta only needs one registered redirect URI.
        """
        uri = self.instagram_redirect_uri.strip()
        callback_path = self.instagram_oauth_callback_path
        canonical = f"{self._canonical_oauth_base_url}{callback_path}"

        if uri.startswith("https://"):
            return uri

        if self._is_legacy_local_redirect_uri(uri) or ":7001" in uri:
            return canonical

        if uri:
            return uri

        return canonical

    @property
    def instagram_oauth_start_url(self) -> str:
        """Same-origin OAuth entrypoint (relative path for multi-host deployments)."""
        return "/auth/instagram"


@lru_cache
def get_settings() -> Settings:
    return Settings()
