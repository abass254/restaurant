from __future__ import annotations

import json
import logging
from typing import Any

from app.core.laravel_crypto import encrypt, maybe_decrypt
from app.models import InstagramAccount

logger = logging.getLogger(__name__)


class InstagramBetaChallengeRequired(Exception):
    """Raised when Instagram requires a 2FA / challenge verification code."""

    def __init__(
        self,
        message: str = "Two-factor authentication required",
        *,
        challenge_type: str = "unknown",
    ):
        self.challenge_type = challenge_type
        super().__init__(message)


class InstagramBetaLoginError(Exception):
    def __init__(self, message: str, *, error_type: str = "login_error"):
        self.error_type = error_type
        super().__init__(message)


class InstagramBetaService:
    """Session-based Instagram messaging via instagrapi (unofficial API)."""

    def login(
        self,
        username: str,
        password: str,
        *,
        verification_code: str | None = None,
    ) -> dict[str, Any]:
        from instagrapi.exceptions import BadPassword, ChallengeRequired, TwoFactorRequired
        from instagrapi import Client

        normalized = username.lstrip("@").strip()
        client = Client()
        try:
            if verification_code:
                client.login(normalized, password, verification_code=verification_code)
            else:
                client.login(normalized, password)
        except TwoFactorRequired as exc:
            raise InstagramBetaChallengeRequired(
                "Instagram sent a two-factor authentication code. Enter it below.",
                challenge_type="two_factor",
            ) from exc
        except ChallengeRequired as exc:
            raise InstagramBetaChallengeRequired(
                "Instagram sent a verification code to your email or phone. Enter it below.",
                challenge_type="verification_challenge",
            ) from exc
        except BadPassword as exc:
            raise InstagramBetaLoginError(
                "Invalid Instagram username or password.",
                error_type="bad_password",
            ) from exc
        except Exception as exc:
            raise InstagramBetaLoginError(
                f"Instagram login failed: {exc}",
                error_type="login_failed",
            ) from exc

        settings = client.get_settings()
        return {
            "session_json": json.dumps(settings),
            "instagram_user_id": str(client.user_id),
            "username": str(client.username or normalized),
            "name": str(getattr(client, "user_full_name", None) or normalized),
        }

    def encrypt_session(self, session_json: str) -> str:
        return encrypt(session_json)

    def _client_for_account(self, account: InstagramAccount):
        from instagrapi import Client

        raw = maybe_decrypt(account.access_token()) or account.access_token()
        if not raw or raw == "manual-placeholder-token":
            raise InstagramBetaLoginError("Instagram Beta session is missing. Reconnect the channel.")

        try:
            settings = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise InstagramBetaLoginError("Instagram Beta session is invalid. Reconnect the channel.") from exc

        client = Client()
        client.set_settings(settings)
        try:
            client.get_timeline_feed()
        except Exception as exc:
            raise InstagramBetaLoginError(
                "Instagram Beta session expired. Reconnect with your password.",
            ) from exc
        return client

    def health_check(self, account: InstagramAccount) -> bool:
        try:
            self._client_for_account(account)
            return True
        except Exception:
            return False

    def user_pk_from_username(self, account: InstagramAccount, username: str) -> str | None:
        normalized = username.lstrip("@").strip()
        if not normalized:
            return None
        client = self._client_for_account(account)
        try:
            user_id = client.user_id_from_username(normalized)
            return str(user_id) if user_id else None
        except Exception as exc:
            logger.warning("Instagram Beta user lookup failed username=%s error=%s", normalized, exc)
            return None

    def send_text_message(
        self,
        account: InstagramAccount,
        recipient_pk: str,
        text: str,
    ) -> str:
        client = self._client_for_account(account)
        try:
            message = client.direct_send(text, user_ids=[int(recipient_pk)])
        except Exception as exc:
            raise RuntimeError(f"Instagram Beta send failed: {exc}") from exc
        message_id = getattr(message, "id", None) or getattr(message, "pk", None)
        return str(message_id or f"beta_{recipient_pk}")

    def send_image_message(
        self,
        account: InstagramAccount,
        recipient_pk: str,
        image_url: str,
    ) -> str:
        import httpx

        client = self._client_for_account(account)
        try:
            with httpx.Client(timeout=60) as http:
                response = http.get(image_url)
                response.raise_for_status()
                image_bytes = response.content
            message = client.direct_send_photo(image_bytes, user_ids=[int(recipient_pk)])
        except Exception as exc:
            raise RuntimeError(f"Instagram Beta image send failed: {exc}") from exc
        message_id = getattr(message, "id", None) or getattr(message, "pk", None)
        return str(message_id or f"beta_img_{recipient_pk}")
