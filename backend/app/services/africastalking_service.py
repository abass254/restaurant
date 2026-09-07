"""Transactional SMS via Africa's Talking.

Used for merchant and rider phone OTPs. Failures are returned, never raised,
so a provider outage cannot crash login request handling.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import Settings, get_settings
from app.services.rider_service import normalize_phone

logger = logging.getLogger(__name__)

LIVE_API_URL = "https://api.africastalking.com/version1/messaging"
SANDBOX_API_URL = "https://api.sandbox.africastalking.com/version1/messaging"
ACCEPTED_STATUS_CODES = frozenset({100, 101, 102})


@dataclass(frozen=True)
class AfricasTalkingSendResult:
    ok: bool
    error: str | None = None
    message_id: str | None = None
    status: str | None = None


class AfricasTalkingSmsService:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    @property
    def configured(self) -> bool:
        return bool(
            (self.settings.africastalking_username or "").strip()
            and (self.settings.africastalking_api_key or "").strip()
        )

    @property
    def sandbox(self) -> bool:
        username = (self.settings.africastalking_username or "").strip().lower()
        return bool(self.settings.africastalking_sandbox) or username == "sandbox"

    @property
    def api_url(self) -> str:
        return SANDBOX_API_URL if self.sandbox else LIVE_API_URL

    def send_text(self, *, to: str, text: str) -> AfricasTalkingSendResult:
        phone = normalize_phone(to)
        body = (text or "").strip()
        if not phone:
            return AfricasTalkingSendResult(ok=False, error="A valid phone number is required.")
        if not body:
            return AfricasTalkingSendResult(ok=False, error="Message text is required.")
        if not self.configured:
            logger.info("Africa's Talking skipped: credentials are not set (to=%s)", phone)
            return AfricasTalkingSendResult(
                ok=False,
                error="SMS is not configured. Set AFRICASTALKING_USERNAME and AFRICASTALKING_API_KEY.",
            )

        payload: dict[str, str] = {
            "username": self.settings.africastalking_username.strip(),
            "to": phone,
            "message": body,
        }
        sender = (self.settings.africastalking_sender_id or "").strip()
        if sender:
            payload["from"] = sender

        try:
            with httpx.Client(timeout=self.settings.africastalking_timeout_seconds) as client:
                response = client.post(
                    self.api_url,
                    headers={
                        "apiKey": self.settings.africastalking_api_key.strip(),
                        "Accept": "application/json",
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    data=payload,
                )
        except httpx.HTTPError as exc:
            logger.warning("Africa's Talking request failed (to=%s): %s", phone, exc)
            return AfricasTalkingSendResult(ok=False, error="Could not reach Africa's Talking.")

        data = _json_body(response)
        recipient = _first_recipient(data)
        message_id = _message_id(recipient)
        status = _status(recipient)

        if not response.is_success:
            error = _error_from_response(response, data, recipient)
            logger.warning(
                "Africa's Talking rejected SMS (status=%s to=%s): %s",
                response.status_code,
                phone,
                error,
            )
            return AfricasTalkingSendResult(
                ok=False,
                error=error,
                message_id=message_id,
                status=status,
            )

        if not _recipient_accepted(recipient):
            error = _error_from_recipient(recipient) or "Africa's Talking did not accept the SMS."
            logger.warning("Africa's Talking SMS not accepted (to=%s): %s", phone, error)
            return AfricasTalkingSendResult(
                ok=False,
                error=error,
                message_id=message_id,
                status=status,
            )

        logger.info("Africa's Talking SMS sent to %s id=%s", phone, message_id)
        return AfricasTalkingSendResult(ok=True, message_id=message_id, status=status)


def _json_body(response: httpx.Response) -> dict | None:
    try:
        payload = response.json()
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


def _sms_data(data: dict | None) -> dict | None:
    if not data:
        return None
    inner = data.get("SMSMessageData")
    return inner if isinstance(inner, dict) else None


def _first_recipient(data: dict | None) -> dict | None:
    sms = _sms_data(data)
    if not sms:
        return None
    recipients = sms.get("Recipients")
    if isinstance(recipients, list) and recipients and isinstance(recipients[0], dict):
        return recipients[0]
    return None


def _message_id(recipient: dict | None) -> str | None:
    if not recipient:
        return None
    value = recipient.get("messageId")
    return str(value) if value is not None else None


def _status(recipient: dict | None) -> str | None:
    if not recipient:
        return None
    value = recipient.get("status")
    return str(value) if value is not None else None


def _recipient_accepted(recipient: dict | None) -> bool:
    if not recipient:
        return False
    raw = recipient.get("statusCode")
    try:
        code = int(raw)
    except (TypeError, ValueError):
        return False
    return code in ACCEPTED_STATUS_CODES


def _error_from_recipient(recipient: dict | None) -> str | None:
    if not recipient:
        return None
    for key in ("status", "message", "error"):
        value = recipient.get(key)
        if isinstance(value, str) and value.strip() and value.strip().lower() != "success":
            return value.strip()
    return None


def _error_from_payload(data: dict | None) -> str | None:
    sms = _sms_data(data)
    if sms:
        message = sms.get("Message")
        if isinstance(message, str) and message.strip():
            return message.strip()
    if data:
        for key in ("message", "error", "description"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return _error_from_recipient(_first_recipient(data))


def _error_from_response(
    response: httpx.Response,
    data: dict | None,
    recipient: dict | None,
) -> str:
    parsed = _error_from_payload(data) or _error_from_recipient(recipient)
    if parsed:
        return parsed
    text = (response.text or "").strip()
    if text:
        return text[:300]
    return f"Africa's Talking HTTP {response.status_code}."
