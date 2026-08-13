"""Safaricom Daraja config built from environment variables.

Dev runtime uses sandbox credentials (`MPESA_SANDBOX_*`).
Production runtime uses hub credentials (`MPESA_*`).

Reference: https://developer.safaricom.co.ke/APIs/M-PesaExpressSimulate
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import Settings, get_settings

# Lipa na M-PESA Online sandbox (Safaricom Daraja docs)
SANDBOX_BASE_URL = "https://sandbox.safaricom.co.ke"
PRODUCTION_BASE_URL = "https://api.safaricom.co.ke"
SANDBOX_SHORTCODE = "174379"
SANDBOX_SHORTCODE_TYPE = "paybill"
SANDBOX_PASSKEY = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919"
SANDBOX_TEST_MSISDN = "254708374149"


@dataclass(frozen=True)
class DarajaEnvConfig:
    """Duck-types :class:`MpesaConfiguration` for STK / B2B calls from env."""

    id: str
    environment: str
    shortcode: str
    shortcode_type: str
    consumer_key: str
    consumer_secret: str
    passkey: str
    callback_url: str
    account_reference_prefix: str = "PAY"
    b2b_initiator_name: str | None = None
    b2b_security_credential: str | None = None
    b2b_auto_payout: bool = False
    is_active: bool = True

    def is_sandbox(self) -> bool:
        return self.environment.lower() != "production"

    def base_url(self) -> str:
        return SANDBOX_BASE_URL if self.is_sandbox() else PRODUCTION_BASE_URL

    def transaction_type(self) -> str:
        return (
            "CustomerBuyGoodsOnline"
            if self.shortcode_type.lower() in {"till", "buygoods", "buy_goods"}
            else "CustomerPayBillOnline"
        )


# Backwards-compatible alias used by older imports / samples.
DarajaSandboxConfig = DarajaEnvConfig


def _default_callback(settings: Settings) -> str:
    return f"{settings.app_url.rstrip('/')}/mpesa/callback"


def build_daraja_sandbox_config(settings: Settings | None = None) -> DarajaEnvConfig:
    cfg = settings or get_settings()
    return DarajaEnvConfig(
        id="daraja-sandbox",
        environment="sandbox",
        shortcode=SANDBOX_SHORTCODE,
        shortcode_type=SANDBOX_SHORTCODE_TYPE,
        consumer_key=(cfg.mpesa_sandbox_consumer_key or "").strip(),
        consumer_secret=(cfg.mpesa_sandbox_consumer_secret or "").strip(),
        passkey=(cfg.mpesa_sandbox_passkey or SANDBOX_PASSKEY).strip(),
        callback_url=_default_callback(cfg),
        account_reference_prefix=(cfg.mpesa_sandbox_account_reference_prefix or "PAY").strip()
        or "PAY",
        b2b_initiator_name=(cfg.mpesa_sandbox_b2b_initiator or "").strip() or None,
        b2b_security_credential=(cfg.mpesa_sandbox_b2b_security_credential or "").strip()
        or None,
        b2b_auto_payout=bool(cfg.mpesa_sandbox_b2b_auto_payout),
    )


def build_daraja_production_config(settings: Settings | None = None) -> DarajaEnvConfig:
    cfg = settings or get_settings()
    callback = (cfg.mpesa_callback_url or "").strip() or _default_callback(cfg)
    shortcode_type = (cfg.mpesa_shortcode_type or "paybill").strip().lower() or "paybill"
    return DarajaEnvConfig(
        id="daraja-production",
        environment="production",
        shortcode=(cfg.mpesa_shortcode or "").strip(),
        shortcode_type=shortcode_type,
        consumer_key=(cfg.mpesa_consumer_key or "").strip(),
        consumer_secret=(cfg.mpesa_consumer_secret or "").strip(),
        passkey=(cfg.mpesa_passkey or "").strip(),
        callback_url=callback,
        account_reference_prefix=(cfg.mpesa_account_reference_prefix or "PAY").strip() or "PAY",
        b2b_initiator_name=(cfg.mpesa_b2b_initiator or "").strip() or None,
        b2b_security_credential=(cfg.mpesa_b2b_security_credential or "").strip() or None,
        b2b_auto_payout=bool(cfg.mpesa_b2b_auto_payout),
    )


def daraja_env_configured(config: DarajaEnvConfig) -> bool:
    return bool(
        config.consumer_key
        and config.consumer_secret
        and config.passkey
        and config.shortcode
        and config.callback_url
    )
