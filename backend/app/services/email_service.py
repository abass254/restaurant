"""Transactional email sending via the Mailtrap Sending API.

This is the single place the backend talks to Mailtrap. It uses the HTTP Send
API (``https://send.api.mailtrap.io/api/send``) with a Bearer token, so no SMTP
library or extra dependency is needed — just the ``httpx`` client we already
ship.

Sending is best-effort: failures are logged and surfaced via the return value,
never raised, so a mail hiccup can't break an order/checkout flow. When
``MAIL_ENABLED`` is false the message is logged instead of sent.

Mailtrap notes:
- The token here is a *Sending* API token, not the testing/inbox SMTP password.
- Until you verify your own domain, send from Mailtrap's demo domain
  (e.g. ``hello@demomailtrap.co``); it only delivers to the account owner's
  email address.
"""

from __future__ import annotations

import logging

import httpx

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


class EmailService:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    @property
    def configured(self) -> bool:
        """True when we have enough config to actually send."""
        return bool(
            self.settings.mail_enabled
            and self.settings.mailtrap_api_token
            and self.settings.mail_from_address
        )

    def send_email(
        self,
        *,
        to: str | list[str],
        subject: str,
        text: str,
        html: str | None = None,
        to_name: str | None = None,
        category: str | None = None,
        from_address: str | None = None,
        from_name: str | None = None,
    ) -> bool:
        """Send a single transactional email. Returns True if Mailtrap accepted it.

        ``from_address``/``from_name`` override the configured defaults — but the
        sender domain must still be verified in Mailtrap, otherwise the API
        rejects the message.
        """
        recipients = [to] if isinstance(to, str) else list(to)
        recipients = [addr.strip() for addr in recipients if addr and addr.strip()]
        if not recipients:
            logger.warning("Email skipped: no recipient (subject=%r)", subject)
            return False

        if not self.settings.mail_enabled:
            logger.info(
                "MAIL_ENABLED is false — not sending email to %s (subject=%r)",
                recipients,
                subject,
            )
            return False

        if not self.configured:
            logger.warning(
                "Email skipped: Mailtrap not configured "
                "(set MAILTRAP_API_TOKEN and MAIL_FROM_ADDRESS). subject=%r",
                subject,
            )
            return False

        payload: dict = {
            "from": {
                "email": from_address or self.settings.mail_from_address,
                "name": from_name or self.settings.mail_from_name or self.settings.app_name,
            },
            "to": [
                ({"email": addr, "name": to_name} if (to_name and i == 0) else {"email": addr})
                for i, addr in enumerate(recipients)
            ],
            "subject": subject,
            "text": text,
        }
        if html:
            payload["html"] = html
        if category:
            payload["category"] = category

        try:
            with httpx.Client(timeout=self.settings.mail_timeout_seconds) as client:
                response = client.post(
                    self.settings.mailtrap_send_api_url,
                    headers={
                        "Authorization": f"Bearer {self.settings.mailtrap_api_token}",
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "User-Agent": "TransChap-Mail/1.0",
                    },
                    json=payload,
                )
        except httpx.HTTPError as exc:
            logger.warning("Mailtrap request failed (subject=%r): %s", subject, exc)
            return False

        if not response.is_success:
            logger.warning(
                "Mailtrap rejected email (status=%s subject=%r): %s",
                response.status_code,
                subject,
                response.text,
            )
            return False

        logger.info("Email sent to %s (subject=%r)", recipients, subject)
        return True
