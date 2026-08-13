from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount, WebhookEvent
from app.services.instagram_api import InstagramApiService
from app.services.instagram_permissions import InstagramPermissions

logger = logging.getLogger(__name__)

_webhook_subscription_cache: dict[int, bool] = {}


class InstagramConnectionService:
    def __init__(self, db: Session, settings: Settings, instagram_api: InstagramApiService):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api

    def subscribe_webhooks(self, account: InstagramAccount, force: bool = False) -> dict:
        user_id = str(account.instagram_user_id or "")
        if not user_id:
            raise RuntimeError("Instagram account has no user id yet.")

        if not force and _webhook_subscription_cache.get(account.id):
            return {"success": True, "cached": True}

        result = self.instagram_api.subscribe_to_webhooks(
            user_id,
            account.access_token(),
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
