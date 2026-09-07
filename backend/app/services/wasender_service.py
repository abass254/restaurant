"""Transactional WhatsApp sending via WasenderAPI (unofficial session gateway).

Interim transport for customer order alerts. Failures are logged and returned,
never raised, so a WhatsApp hiccup cannot break checkout or status transitions.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import Settings, get_settings
from app.services.rider_service import normalize_phone

logger = logging.getLogger(__name__)

DEFAULT_API_URL = "https://www.wasenderapi.com"


@dataclass(frozen=True)
class WasenderSendResult:
    ok: bool
    error: str | None = None
    message_id: str | None = None


class WasenderApiService:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    @property
    def configured(self) -> bool:
        return bool((self.settings.wasender_api_key or "").strip())

    @property
    def order_notify_enabled(self) -> bool:
        return bool(self.settings.wasender_enabled) and self.configured

    def send_text(self, *, to: str, text: str) -> WasenderSendResult:
        phone = normalize_phone(to)
        body = (text or "").strip()
        if not phone:
            return WasenderSendResult(ok=False, error="A valid WhatsApp number is required.")
        if not body:
            return WasenderSendResult(ok=False, error="Message text is required.")
        if not self.configured:
            logger.info("Wasender skipped: WASENDER_API_KEY is not set (to=%s)", phone)
            return WasenderSendResult(
                ok=False,
                error="Wasender is not configured. Set WASENDER_API_KEY.",
            )

        payload = {"to": phone, "text": body}
        url = f"{self.settings.wasender_api_url.rstrip('/')}/api/send-message"
        try:
            with httpx.Client(timeout=self.settings.wasender_timeout_seconds) as client:
                response = client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {self.settings.wasender_api_key.strip()}",
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                    json=payload,
                )
        except httpx.HTTPError as exc:
            logger.warning("Wasender request failed (to=%s): %s", phone, exc)
            return WasenderSendResult(ok=False, error="Could not reach WasenderAPI.")

        message_id = _message_id_from_response(response)
        if not response.is_success:
            error = _error_from_response(response)
            logger.warning(
                "Wasender rejected message (status=%s to=%s): %s",
                response.status_code,
                phone,
                error,
            )
            return WasenderSendResult(ok=False, error=error, message_id=message_id)

        data = _json_body(response)
        if data is not None and data.get("success") is False:
            error = _error_from_payload(data) or "Wasender did not accept the message."
            logger.warning("Wasender success=false (to=%s): %s", phone, error)
            return WasenderSendResult(ok=False, error=error, message_id=message_id)

        logger.info("Wasender message sent to %s id=%s", phone, message_id)
        return WasenderSendResult(ok=True, message_id=message_id)


def _json_body(response: httpx.Response) -> dict | None:
    try:
        payload = response.json()
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


def _message_id_from_response(response: httpx.Response) -> str | None:
    data = _json_body(response)
    if not data:
        return None
    inner = data.get("data")
    if isinstance(inner, dict):
        for key in ("msgId", "id", "messageId"):
            value = inner.get(key)
            if value is not None:
                return str(value)
    return None


def _error_from_payload(data: dict) -> str | None:
    for key in ("message", "error", "msg"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    inner = data.get("data")
    if isinstance(inner, dict):
        for key in ("message", "error"):
            value = inner.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _error_from_response(response: httpx.Response) -> str:
    data = _json_body(response)
    if data:
        parsed = _error_from_payload(data)
        if parsed:
            return parsed
    text = (response.text or "").strip()
    if text:
        return text[:300]
    return f"Wasender HTTP {response.status_code}."
