from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import AutoReplyRule, InstagramAccount, InstagramConversation, InstagramMessage
from app.services.dm_templates import DEFAULT_GREETING_REPLY, DEFAULT_GREETING_TRIGGER, render_reply_text
from app.services.platform_messaging_settings import auto_responses_paused
from app.services.instagram_api import InstagramApiService
logger = logging.getLogger(__name__)


# Re-export for callers that still import from auto_reply_service.
__all__ = [
    "AutoReplyService",
    "DEFAULT_GREETING_REPLY",
    "DEFAULT_GREETING_TRIGGER",
    "render_reply_text",
]


class AutoReplyService:
    def __init__(self, db: Session, settings: Settings, instagram_api: InstagramApiService):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api

    def process_inbound_message(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> None:
        if not message.is_inbound() or message.auto_replied or not (message.body or "").strip():
            return

        # Instagram DMs are handled by DmTicketService + DmMenuService only.
        if (account.platform or "instagram") == "instagram":
            return

        if not getattr(account, "auto_replies_enabled", True):
            return

        if auto_responses_paused(self.db):
            return

        recipient_id = conversation.participant_ig_id
        if not recipient_id:
            return

        rules = sorted(
            [rule for rule in account.auto_reply_rules if rule.is_active],
            key=lambda rule: rule.priority,
            reverse=True,
        )
        rule = next((item for item in rules if item.matches(message.body or "")), None)

        is_first_inbound = self._is_first_inbound(conversation, message)
        quick_replies = self._chips_for(account) if is_first_inbound else None

        if rule:
            reply_text = render_reply_text(rule.reply_text, conversation, message)
            rule_id_for_log = rule.id
        elif is_first_inbound and quick_replies:
            reply_text = render_reply_text(
                self.settings.instagram_welcome_quick_reply_text,
                conversation,
                message,
            )
            rule_id_for_log = None
        else:
            return

        try:
            from app.services.messaging_service import InstagramOutboundService

            outbound = InstagramOutboundService(self.settings, self.instagram_api, db=self.db)
            outbound_id = outbound.send_text(
                account,
                recipient_id,
                reply_text,
                quick_replies=quick_replies or None,
            )

            reply = InstagramMessage(
                instagram_conversation_id=conversation.id,
                instagram_message_id=outbound_id,
                direction="outbound",
                sender_ig_id=account.instagram_user_id,
                sender_username=account.username,
                body=reply_text,
                sent_at=datetime.now(timezone.utc),
                auto_replied=False,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            self.db.add(reply)
            message.auto_replied = True
            self.db.commit()
        except Exception as exc:
            logger.warning(
                "Auto-reply failed message_id=%s rule_id=%s error=%s",
                message.id,
                rule_id_for_log,
                exc,
            )

    def _is_first_inbound(
        self,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> bool:
        """True when `message` is the only inbound on the conversation so far."""
        inbound_count = 0
        for existing in conversation.messages:
            if existing.direction != "inbound":
                continue
            if existing.id == message.id:
                continue
            inbound_count += 1
            if inbound_count >= 1:
                return False
        return True

    def _chips_for(self, account: InstagramAccount) -> list[dict[str, str]]:
        # Import here to avoid a circular import with ConversationStarterService.
        from app.services.conversation_starter_service import ConversationStarterService

        starters = ConversationStarterService(self.db, self.settings, self.instagram_api)
        return starters.build_quick_replies(account)

    def seed_default_greeting_rule(self, account: InstagramAccount) -> None:
        """Ensure a friendly greeting rule exists so 'Hello' DMs get a warm reply."""
        existing = next(
            (
                rule
                for rule in account.auto_reply_rules
                if (rule.trigger_phrase or "").strip().lower()
                in {"hi", "hello", "hey"}
            ),
            None,
        )
        if existing:
            return

        now = datetime.now(timezone.utc)
        self.db.add(
            AutoReplyRule(
                instagram_account_id=account.id,
                name="Friendly greeting",
                match_type="contains",
                trigger_phrase=DEFAULT_GREETING_TRIGGER,
                reply_text=DEFAULT_GREETING_REPLY,
                is_active=True,
                priority=10,
                created_at=now,
                updated_at=now,
            ),
        )
        self.db.commit()
        self.db.refresh(account)
