from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount, WebhookEvent
from app.services.instagram_api import InstagramApiService
from app.services.instagram_permissions import InstagramPermissions

logger = logging.getLogger(__name__)

_webhook_subscription_cache: dict[int, bool] = {}
_TOKEN_REFRESH_LEAD = timedelta(days=7)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def graph_access_token(
    db: Session | None,
    settings: Settings,
    instagram_api: InstagramApiService,
    account: InstagramAccount,
) -> str:
    if db is None:
        return account.access_token()
    return InstagramConnectionService(db, settings, instagram_api).ensure_fresh_token(account)


class InstagramConnectionService:
    def __init__(self, db: Session, settings: Settings, instagram_api: InstagramApiService):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api

    def ensure_fresh_token(self, account: InstagramAccount) -> str:
        """Refresh the long-lived Graph token when it is missing expiry or within 7 days."""
        token = account.access_token()
        if not token or account.login_provider != "instagram":
            return token

        expires_at = account.token_expires_at
        if expires_at is not None:
            remaining = _as_utc(expires_at) - datetime.now(timezone.utc)
            if remaining > _TOKEN_REFRESH_LEAD:
                return token

        try:
            refreshed = self.instagram_api.refresh_long_lived_token(token)
        except Exception:
            logger.warning(
                "Instagram token refresh failed account=%s; using existing token",
                account.username,
                exc_info=True,
            )
            return token

        new_token = str(refreshed["access_token"])
        account.user_access_token = new_token
        account.token_expires_at = refreshed.get("expires_at")
        account.updated_at = datetime.now(timezone.utc)
        self.db.commit()
        logger.info("Instagram long-lived token refreshed account=%s", account.username)
        return new_token

    def subscribe_webhooks(self, account: InstagramAccount, force: bool = False) -> dict:
        user_id = str(account.instagram_user_id or "")
        if not user_id:
            raise RuntimeError("Instagram account has no user id yet.")

        if not force and _webhook_subscription_cache.get(account.id):
            return {"success": True, "cached": True}

        result = self.instagram_api.subscribe_to_webhooks(
            user_id,
            self.ensure_fresh_token(account),
            self.settings.instagram_webhook_subscribed_fields,
        )

        if result.get("success") is True:
            _webhook_subscription_cache[account.id] = True

        logger.info(
            "Instagram webhook subscription updated account=%s result=%s",
            account.username,
            result,
        )
        return result

    def permission_summary(self, account: InstagramAccount) -> dict:
        requested = list(self.settings.instagram_scopes)
        granted = InstagramPermissions.to_list(account.granted_permissions)
        return {
            "requested": requested,
            "granted": granted,
            "missing": [scope for scope in requested if scope not in granted],
        }

    def diagnostics(self, account: InstagramAccount) -> dict:
        subscribed_fields: list[str] = []
        try:
            user_id = str(account.instagram_user_id or "")
            response = self.instagram_api.get(
                f"{user_id}/subscribed_apps",
                {"access_token": account.access_token()},
            )
            for row in response.get("data") or []:
                for field in row.get("subscribed_fields") or []:
                    subscribed_fields.append(str(field))
        except Exception as exc:
            subscribed_fields = [f"error: {exc}"]

        api_conversation_count = 0
        try:
            api_conversation_count = len(
                self.instagram_api.get_conversations(account.access_token()),
            )
        except Exception:
            api_conversation_count = -1

        latest = (
            self.db.query(WebhookEvent)
            .order_by(WebhookEvent.received_at.desc())
            .first()
        )

        stored_message_count = 0
        for conversation in account.conversations:
            stored_message_count += len(conversation.messages)

        return {
            "permissions": self.permission_summary(account),
            "subscribed_fields": list(dict.fromkeys(subscribed_fields)),
            "api_conversation_count": api_conversation_count,
            "stored_conversation_count": len(account.conversations),
            "stored_message_count": stored_message_count,
            "last_webhook_at": latest.received_at.isoformat() if latest else None,
            "last_webhook_summary": (
                f"{latest.event_type or 'event'} · {latest.processing_result or ''}".strip()
                if latest
                else None
            ),
            "recent_log_lines": [],
        }
