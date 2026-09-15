"""Transactional WhatsApp sending via the platform openWA agent sidecar.

Interim transport for customer order alerts until Meta Cloud API is ready.
Failures are logged and returned, never raised, so a WhatsApp hiccup cannot
break checkout or status transitions.

The agent holds a single platform WhatsApp session (admin QR scan). Merchants
do not connect their own numbers.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.services.rider_service import normalize_phone

logger = logging.getLogger(__name__)

DEFAULT_AGENT_URL = "http://127.0.0.1:7010"


@dataclass(frozen=True)
class OpenWaSendResult:
    ok: bool
    error: str | None = None
    message_id: str | None = None


@dataclass(frozen=True)
class OpenWaStatus:
    reachable: bool
    ready: bool
    starting: bool
    state: str
    host_number: str | None
    connected_at: str | None
    has_qr: bool
    qr: str | None
    error: str | None
    session_id: str | None
    agent_error: str | None = None


class OpenWaAgentService:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    @property
    def configured(self) -> bool:
        return bool((self.settings.openwa_agent_token or "").strip())

    @property
    def order_notify_enabled(self) -> bool:
        return bool(self.settings.openwa_enabled) and self.configured

    def _headers(self) -> dict[str, str]:
        token = (self.settings.openwa_agent_token or "").strip()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _url(self, path: str) -> str:
        base = (self.settings.openwa_agent_url or DEFAULT_AGENT_URL).rstrip("/")
        return f"{base}{path}"

    def status(self) -> OpenWaStatus:
        if not self.configured:
            return OpenWaStatus(
                reachable=False,
                ready=False,
                starting=False,
                state="unconfigured",
                host_number=None,
                connected_at=None,
                has_qr=False,
                qr=None,
                error=None,
                session_id=None,
                agent_error="OPENWA_AGENT_TOKEN is not set.",
            )
        try:
            with httpx.Client(timeout=self.settings.openwa_timeout_seconds) as client:
                response = client.get(self._url("/status"), headers=self._headers())
        except httpx.HTTPError as exc:
            logger.warning("OpenWA agent unreachable: %s", exc)
            return OpenWaStatus(
                reachable=False,
                ready=False,
                starting=False,
                state="unreachable",
                host_number=None,
                connected_at=None,
                has_qr=False,
                qr=None,
                error=None,
                session_id=None,
                agent_error="Could not reach the WhatsApp agent.",
            )

        data = _json_body(response)
        if response.status_code == 401:
            return OpenWaStatus(
                reachable=True,
                ready=False,
                starting=False,
                state="unauthorized",
                host_number=None,
                connected_at=None,
                has_qr=False,
                qr=None,
                error=None,
                session_id=None,
                agent_error="WhatsApp agent rejected the token.",
            )
        if not response.is_success or not data:
            return OpenWaStatus(
                reachable=True,
                ready=False,
                starting=False,
                state="error",
                host_number=None,
                connected_at=None,
                has_qr=False,
                qr=None,
                error=None,
                session_id=None,
                agent_error=_error_from_response(response) or "Agent status failed.",
            )

        return OpenWaStatus(
            reachable=True,
            ready=bool(data.get("ready")),
            starting=bool(data.get("starting")),
            state=str(data.get("state") or "unknown"),
            host_number=_str_or_none(data.get("host_number")),
            connected_at=_str_or_none(data.get("connected_at")),
            has_qr=bool(data.get("has_qr") or data.get("qr")),
            qr=_str_or_none(data.get("qr")),
            error=_str_or_none(data.get("error")),
            session_id=_str_or_none(data.get("session_id")),
            agent_error=None,
        )

    def send_text(self, *, to: str, text: str) -> OpenWaSendResult:
        phone = normalize_phone(to)
        body = (text or "").strip()
        if not phone:
            return OpenWaSendResult(ok=False, error="A valid WhatsApp number is required.")
        if not body:
            return OpenWaSendResult(ok=False, error="Message text is required.")
        if not self.configured:
            logger.info("OpenWA skipped: OPENWA_AGENT_TOKEN is not set (to=%s)", phone)
            return OpenWaSendResult(
                ok=False,
                error="WhatsApp agent is not configured. Set OPENWA_AGENT_TOKEN.",
            )

        payload = {"to": phone, "text": body}
        try:
            with httpx.Client(timeout=self.settings.openwa_timeout_seconds) as client:
                response = client.post(
                    self._url("/send"),
                    headers=self._headers(),
                    json=payload,
                )
        except httpx.HTTPError as exc:
            logger.warning("OpenWA send request failed (to=%s): %s", phone, exc)
            return OpenWaSendResult(ok=False, error="Could not reach the WhatsApp agent.")

        data = _json_body(response)
        message_id = None
        if data:
            raw_id = data.get("message_id")
            if raw_id is not None:
                message_id = str(raw_id)

        if not response.is_success:
            error = _error_from_response(response)
            logger.warning(
                "OpenWA rejected message (status=%s to=%s): %s",
                response.status_code,
                phone,
                error,
            )
            return OpenWaSendResult(ok=False, error=error, message_id=message_id)

        if data is not None and data.get("ok") is False:
            error = _error_from_payload(data) or "WhatsApp agent did not accept the message."
            logger.warning("OpenWA ok=false (to=%s): %s", phone, error)
            return OpenWaSendResult(ok=False, error=error, message_id=message_id)

        logger.info("OpenWA message sent to %s id=%s", phone, message_id)
        return OpenWaSendResult(ok=True, message_id=message_id)

    def logout(self) -> tuple[bool, str]:
        return self._post_action("/logout", "Logged out.")

    def restart(self) -> tuple[bool, str]:
        return self._post_action("/restart", "Restarting session.")

    def _post_action(self, path: str, default_message: str) -> tuple[bool, str]:
        if not self.configured:
            return False, "WhatsApp agent is not configured. Set OPENWA_AGENT_TOKEN."
        try:
            with httpx.Client(timeout=self.settings.openwa_timeout_seconds) as client:
                response = client.post(self._url(path), headers=self._headers())
        except httpx.HTTPError as exc:
            logger.warning("OpenWA %s failed: %s", path, exc)
            return False, "Could not reach the WhatsApp agent."
        data = _json_body(response)
        if not response.is_success:
            return False, _error_from_response(response)
        if data is not None and data.get("ok") is False:
            return False, _error_from_payload(data) or default_message
        message = None
        if data:
            message = _str_or_none(data.get("message"))
        return True, message or default_message


def _json_body(response: httpx.Response) -> dict[str, Any] | None:
    try:
        payload = response.json()
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


def _str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _error_from_payload(data: dict[str, Any]) -> str | None:
    for key in ("error", "message", "msg"):
        value = data.get(key)
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
    return f"WhatsApp agent HTTP {response.status_code}."
