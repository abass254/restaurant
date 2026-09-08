"""
Tigo Pesa / Mixx by Yas (Tanzania) client.

Tigo splits its integration across two gateways, so this module talks to both:

- **Tigo Secure** (JSON, ``TIGO_BASE_URL``) — access token, system status, MFS
  account validation, and payment authorization. Payment authorization is a
  browser redirect: it returns a ``redirectUrl`` the customer must be sent to,
  not a push to their handset.
- **Partner integration** (XML over HTTP, ``TIGO_PARTNER_BASE_URL``) — the A2W
  "MFI CashIn" disbursement, and the inbound bill pay Tigo POSTs to us.

There is no merchant-initiated STK push equivalent to Safaricom's, so
collection is either customer-initiated bill pay against our biller code or
the Tigo Secure redirect. Credentials are issued through Mixx corporate
onboarding; there is no public developer portal.

Every call returns a :class:`TigoCallResult` carrying the raw request and
response, so the admin console can show exactly what went over the wire.
"""

from __future__ import annotations

import logging
import time
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings

logger = logging.getLogger(__name__)

TIGO_COUNTRY_CODE = "255"
TIGO_COUNTRY = "TZA"
TIGO_LANGUAGE = "eng"

# Tigo/Yas MSISDN prefixes in Tanzania (Tigo plus the merged Zantel range).
TIGO_PREFIXES = ("65", "67", "71", "77")


class TigoConfigurationMissing(RuntimeError):
    """Raised when the TIGO_* env credentials are incomplete."""


class TigoApiError(RuntimeError):
    """Raised when Tigo returns an error response."""


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class TigoConfig:
    environment: str
    base_url: str
    partner_base_url: str
    client_id: str
    client_secret: str
    account_msisdn: str
    account_pin: str
    master_merchant_id: str
    biller_code: str
    callback_url: str
    redirect_url: str
    currency: str

    def is_sandbox(self) -> bool:
        return self.environment.lower() != "production"


def use_tigo_sandbox(db: Session) -> bool:
    """Whether Tigo calls should use the sandbox gateway.

    ``TIGO_MODE=production`` forces live even if the platform Mode toggle is
    still Dev. ``TIGO_MODE=sandbox`` forces sandbox. When unset, follows the
    platform runtime mode, matching how Daraja behaves.
    """
    from app.services.platform_runtime import is_dev_runtime

    mode = (get_settings().tigo_mode or "").strip().lower()
    if mode in {"production", "prod", "live"}:
        return False
    if mode in {"sandbox", "dev", "development"}:
        return True
    return is_dev_runtime(db)


def resolve_tigo_config(db: Session) -> TigoConfig:
    cfg = get_settings()
    sandbox = use_tigo_sandbox(db)
    app_url = cfg.app_url.rstrip("/")
    base = (cfg.tigo_sandbox_base_url if sandbox else cfg.tigo_base_url).strip()
    return TigoConfig(
        environment="sandbox" if sandbox else "production",
        base_url=base.rstrip("/"),
        partner_base_url=(cfg.tigo_partner_base_url or "").strip().rstrip("/"),
        client_id=(cfg.tigo_client_id or "").strip(),
        client_secret=(cfg.tigo_client_secret or "").strip(),
        account_msisdn=(cfg.tigo_account_msisdn or "").strip(),
        account_pin=(cfg.tigo_account_pin or "").strip(),
        master_merchant_id=(cfg.tigo_master_merchant_id or "").strip(),
        biller_code=(cfg.tigo_biller_code or "").strip(),
        callback_url=(cfg.tigo_callback_url or "").strip() or f"{app_url}/tigo/callback",
        redirect_url=(cfg.tigo_redirect_url or "").strip() or f"{app_url}/tigo/return",
        currency=(cfg.tigo_currency or "TZS").strip().upper(),
    )


def tigo_configured(config: TigoConfig) -> bool:
    """Enough credentials present to attempt a Tigo Secure call."""
    return bool(config.client_id and config.client_secret and config.base_url)


def tigo_enabled_for_account(account_id: str | None) -> bool:
    """Rollout gate. Merchant traffic reaches Tigo only when allowlisted."""
    cfg = get_settings()
    if not cfg.tigo_enabled:
        return False
    allowed = {
        item.strip()
        for item in (cfg.tigo_enabled_account_ids or "").split(",")
        if item.strip()
    }
    if not allowed:
        return False
    return bool(account_id) and account_id in allowed


# --------------------------------------------------------------------------
# MSISDN helpers
# --------------------------------------------------------------------------


def normalize_msisdn(raw: str) -> str:
    """Convert 07XXXXXXXX / +2557XXXXXXXX / 7XXXXXXXX to 2557XXXXXXXX."""
    digits = "".join(ch for ch in raw if ch.isdigit())
    if digits.startswith("255"):
        return digits
    if digits.startswith("0") and len(digits) == 10:
        return "255" + digits[1:]
    if len(digits) == 9:
        return "255" + digits
    return digits


def is_tanzania_msisdn(raw: str) -> bool:
    msisdn = normalize_msisdn(raw)
    return msisdn.startswith("255") and len(msisdn) == 12


def is_tigo_msisdn(raw: str) -> bool:
    """True when the number normalizes to a Tigo/Yas Tanzanian MSISDN."""
    msisdn = normalize_msisdn(raw)
    return is_tanzania_msisdn(msisdn) and msisdn[3:5] in TIGO_PREFIXES


# --------------------------------------------------------------------------
# Call envelope
# --------------------------------------------------------------------------


@dataclass
class TigoCallResult:
    """One HTTP exchange with Tigo, captured for display in the admin console."""

    operation: str
    ok: bool
    method: str
    url: str
    status_code: int | None = None
    duration_ms: int = 0
    request_body: Any = None
    response_body: Any = None
    error: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "operation": self.operation,
            "ok": self.ok,
            "method": self.method,
            "url": self.url,
            "status_code": self.status_code,
            "duration_ms": self.duration_ms,
            "request_body": self.request_body,
            "response_body": self.response_body,
            "error": self.error,
            "ran_at": datetime.now(timezone.utc).isoformat(),
            **self.extra,
        }


def mask_secret(value: str | None, keep: int = 4) -> str:
    if not value:
        return ""
    if keep <= 0 or len(value) <= keep:
        return "*" * len(value)
    return ("*" * (len(value) - keep)) + value[-keep:]


def _reference(prefix: str) -> str:
    """Tigo caps REFERENCEID at 20 characters."""
    return f"{prefix}{uuid.uuid4().hex[:14]}".upper()[:20]


def _parse_body(response: httpx.Response) -> Any:
    text = response.text or ""
    content_type = response.headers.get("content-type", "")
    if "json" in content_type:
        try:
            return response.json()
        except ValueError:
            return text
    if "xml" in content_type or text.lstrip().startswith("<"):
        parsed = _parse_xml(text)
        if parsed is not None:
            return parsed
    return text


def _parse_xml(text: str) -> dict[str, str] | None:
    """Flatten a Tigo <COMMAND> response into a dict, or None if unparseable."""
    snippet = text.strip()
    # Tigo's samples wrap COMMAND in a stray </xml>; take the COMMAND element.
    start = snippet.find("<COMMAND")
    end = snippet.rfind("</COMMAND>")
    if start != -1 and end != -1:
        snippet = snippet[start : end + len("</COMMAND>")]
    try:
        root = ET.fromstring(snippet)
    except ET.ParseError:
        return None
    return {child.tag: (child.text or "").strip() for child in root}


def _require_secure_config(config: TigoConfig) -> None:
    if not tigo_configured(config):
        raise TigoConfigurationMissing(
            "Tigo is not configured. Set TIGO_CLIENT_ID and TIGO_CLIENT_SECRET "
            "in .env before running this test.",
        )


# --------------------------------------------------------------------------
# Tigo Secure (JSON)
# --------------------------------------------------------------------------


def generate_access_token(config: TigoConfig) -> tuple[TigoCallResult, str | None]:
    """POST /v1/oauth/generate/accesstoken

    Tigo invalidates the token once a transaction completes, so a fresh token
    is generated per payment authorization rather than cached.
    """
    _require_secure_config(config)
    url = f"{config.base_url}/v1/oauth/generate/accesstoken?grant_type=client_credentials"
    form = {"client_id": config.client_id, "client_secret": config.client_secret}
    shown = {
        "client_id": config.client_id,
        "client_secret": mask_secret(config.client_secret),
    }

    started = time.perf_counter()
    try:
        with httpx.Client(timeout=30) as client:
            response = client.post(
                url,
                data=form,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except httpx.HTTPError as exc:
        return (
            TigoCallResult(
                operation="access_token",
                ok=False,
                method="POST",
                url=url,
                duration_ms=int((time.perf_counter() - started) * 1000),
                request_body=shown,
                error=str(exc),
            ),
            None,
        )

    body = _parse_body(response)
    token = None
    if isinstance(body, dict):
        token = (body.get("accessToken") or "").strip() or None

    result = TigoCallResult(
        operation="access_token",
        ok=response.is_success and bool(token),
        method="POST",
        url=url,
        status_code=response.status_code,
        duration_ms=int((time.perf_counter() - started) * 1000),
        request_body=shown,
        response_body=_mask_token_in(body),
        error=None if token else "No accessToken in response.",
    )
    return result, token


def _mask_token_in(body: Any) -> Any:
    if isinstance(body, dict) and body.get("accessToken"):
        masked = dict(body)
        masked["accessToken"] = mask_secret(str(body["accessToken"]), 6)
        return masked
    return body


def _secure_call(
    config: TigoConfig,
    *,
    operation: str,
    method: str,
    path: str,
    token: str,
    json_body: dict[str, Any] | None = None,
    shown_body: dict[str, Any] | None = None,
) -> TigoCallResult:
    url = f"{config.base_url}{path}"
    headers = {"accessToken": token}
    if json_body is not None:
        headers["Content-Type"] = "application/json"

    started = time.perf_counter()
    try:
        with httpx.Client(timeout=30) as client:
            response = client.request(method, url, json=json_body, headers=headers)
    except httpx.HTTPError as exc:
        return TigoCallResult(
            operation=operation,
            ok=False,
            method=method,
            url=url,
            duration_ms=int((time.perf_counter() - started) * 1000),
            request_body=shown_body if shown_body is not None else json_body,
            error=str(exc),
        )

    return TigoCallResult(
        operation=operation,
        ok=response.is_success,
        method=method,
        url=url,
        status_code=response.status_code,
        duration_ms=int((time.perf_counter() - started) * 1000),
        request_body=shown_body if shown_body is not None else json_body,
        response_body=_parse_body(response),
        error=None if response.is_success else f"HTTP {response.status_code}",
    )


def system_status(config: TigoConfig, token: str) -> TigoCallResult:
    """GET /v1/tigo/systemstatus — heartbeat for the Tigo Secure service."""
    return _secure_call(
        config,
        operation="system_status",
        method="GET",
        path="/v1/tigo/systemstatus",
        token=token,
    )


def validate_mfs_account(
    config: TigoConfig,
    token: str,
    *,
    msisdn: str,
    first_name: str | None = None,
    last_name: str | None = None,
) -> TigoCallResult:
    """POST /v1/tigo/mfs/validateMFSAccount — does this number hold a wallet?

    The nearest Tigo equivalent of Safaricom's Hakikisha, and the call we would
    use to validate a merchant payout destination before disbursing.
    """
    subscriber: dict[str, Any] = {
        "account": normalize_msisdn(msisdn),
        "countryCallingCode": TIGO_COUNTRY_CODE,
        "countryCode": TIGO_COUNTRY,
    }
    if first_name:
        subscriber["firstName"] = first_name
    if last_name:
        subscriber["lastName"] = last_name

    return _secure_call(
        config,
        operation="validate_account",
        method="POST",
        path="/v1/tigo/mfs/validateMFSAccount",
        token=token,
        json_body={
            "transactionRefId": _reference("VAL"),
            "ReceivingSubscriber": subscriber,
        },
    )


def authorize_payment(
    config: TigoConfig,
    token: str,
    *,
    msisdn: str,
    amount: int,
    reference: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    email: str | None = None,
) -> TigoCallResult:
    """POST /v1/tigo/payment-auth/authorize — start a Tigo Secure payment.

    Returns a ``redirectUrl`` the customer's browser must be sent to. This is
    not a handset push, so it suits the public pay link rather than the POS.
    """
    if not config.account_msisdn or not config.account_pin:
        raise TigoConfigurationMissing(
            "Payment authorization needs the master merchant wallet. Set "
            "TIGO_ACCOUNT_MSISDN and TIGO_ACCOUNT_PIN in .env.",
        )

    subscriber: dict[str, Any] = {
        "account": normalize_msisdn(msisdn),
        "countryCode": TIGO_COUNTRY_CODE,
        "country": TIGO_COUNTRY.lower(),
    }
    if first_name:
        subscriber["firstName"] = first_name
    if last_name:
        subscriber["lastName"] = last_name
    if email:
        subscriber["emailId"] = email

    payload: dict[str, Any] = {
        "MasterMerchant": {
            "account": config.account_msisdn,
            "pin": config.account_pin,
            "id": config.master_merchant_id or config.biller_code,
        },
        "Subscriber": subscriber,
        "redirectUri": config.redirect_url,
        "callbackUri": config.callback_url,
        "language": TIGO_LANGUAGE,
        "originPayment": {
            "amount": str(int(amount)),
            "currencyCode": config.currency,
            "tax": "0",
            "fee": "0",
        },
        "LocalPayment": {
            "amount": str(int(amount)),
            "currencyCode": config.currency,
        },
        "transactionRefId": reference or _reference("PAY"),
    }

    shown = {**payload, "MasterMerchant": {**payload["MasterMerchant"], "pin": "****"}}

    return _secure_call(
        config,
        operation="payment_auth",
        method="POST",
        path="/v1/tigo/payment-auth/authorize",
        token=token,
        json_body=payload,
        shown_body=shown,
    )


# --------------------------------------------------------------------------
# Partner gateway (XML)
# --------------------------------------------------------------------------


def _command_xml(fields: dict[str, str]) -> str:
    parts = "".join(f"  <{key}>{value}</{key}>\n" for key, value in fields.items())
    return f'<?xml version="1.0"?>\n<COMMAND>\n{parts}</COMMAND>'


def disburse(
    config: TigoConfig,
    *,
    msisdn: str,
    amount: int,
    reference: str | None = None,
) -> TigoCallResult:
    """A2W "MFI CashIn" — pay from our disbursement wallet to a subscriber.

    XML over HTTP against the partner gateway, authenticated by our own wallet
    MSISDN and PIN rather than a bearer token.
    """
    if not config.partner_base_url:
        raise TigoConfigurationMissing(
            "Disbursement needs the partner gateway. Set TIGO_PARTNER_BASE_URL in .env.",
        )
    if not config.account_msisdn or not config.account_pin:
        raise TigoConfigurationMissing(
            "Disbursement needs the wallet credentials. Set TIGO_ACCOUNT_MSISDN "
            "and TIGO_ACCOUNT_PIN in .env.",
        )

    ref = (reference or _reference("CI"))[:20]
    fields = {
        "TYPE": "REQMFICI",
        "REFERENCEID": ref,
        "MSISDN": config.account_msisdn,
        "PIN": config.account_pin,
        "MSISDN1": normalize_msisdn(msisdn),
        "AMOUNT": str(int(amount)),
        "LANGUAGE1": "en",
    }
    body = _command_xml(fields)
    shown = _command_xml({**fields, "PIN": "****"})
    url = config.partner_base_url

    started = time.perf_counter()
    try:
        with httpx.Client(timeout=60) as client:
            response = client.post(
                url,
                content=body.encode("utf-8"),
                headers={"Content-Type": "text/xml", "Connection": "keep-alive"},
            )
    except httpx.HTTPError as exc:
        return TigoCallResult(
            operation="disburse",
            ok=False,
            method="POST",
            url=url,
            duration_ms=int((time.perf_counter() - started) * 1000),
            request_body=shown,
            error=str(exc),
            extra={"reference_id": ref},
        )

    parsed = _parse_body(response)
    txn_status = ""
    if isinstance(parsed, dict):
        txn_status = str(parsed.get("TXNSTATUS") or "").strip()
    succeeded = response.is_success and txn_status in {"200", "0"}

    return TigoCallResult(
        operation="disburse",
        ok=succeeded,
        method="POST",
        url=url,
        status_code=response.status_code,
        duration_ms=int((time.perf_counter() - started) * 1000),
        request_body=shown,
        response_body=parsed,
        error=None if succeeded else f"TXNSTATUS {txn_status or 'missing'}",
        extra={"reference_id": ref},
    )


# --------------------------------------------------------------------------
# Convenience for the admin console
# --------------------------------------------------------------------------


def run_with_token(
    config: TigoConfig,
    runner,
) -> list[TigoCallResult]:
    """Mint a token, then run ``runner(token)``, returning both exchanges.

    Every Tigo Secure call needs a fresh token, so the console always shows the
    token request alongside the call the admin actually asked for.
    """
    token_result, token = generate_access_token(config)
    if not token:
        return [token_result]
    return [token_result, runner(token)]
