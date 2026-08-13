from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import ConversationStarter, InstagramAccount, InstagramConversation, InstagramMessage
from app.services.instagram_api import InstagramApiService
from app.services.dm_templates import DEFAULT_HOLD_REPLY
from app.services.messaging_service import InstagramOutboundService

logger = logging.getLogger(__name__)


class ConversationStarterService:
    MAX_STARTERS = 4
    # Meta caps the persistent menu at 5 top-level call_to_actions and quick
    # reply title at ~20 characters. We share the same starters across all
    # three surfaces (ice breakers, persistent menu, quick replies), so the
    # tightest cap wins per surface.
    MAX_PERSISTENT_MENU = 5
    MAX_QUICK_REPLIES = 13
    QUICK_REPLY_TITLE_MAX = 20

    def __init__(self, db: Session, settings: Settings, instagram_api: InstagramApiService):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api

    def seed_defaults(self, account: InstagramAccount) -> None:
        if account.conversation_starters:
            return

        now = datetime.now(timezone.utc)
        for index, starter in enumerate(self.settings.instagram_default_conversation_starters):
            self.db.add(
                ConversationStarter(
                    instagram_account_id=account.id,
                    question=starter["question"],
                    payload=starter["payload"],
                    reply_text=starter.get("reply_text"),
                    sort_order=index,
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                ),
            )
        self.db.commit()
        self.db.refresh(account)

    def active_starters(self, account: InstagramAccount) -> list[ConversationStarter]:
        return sorted(
            [item for item in account.conversation_starters if item.is_active],
            key=lambda item: item.sort_order,
        )

    def build_quick_replies(
        self,
        account: InstagramAccount,
    ) -> list[dict[str, str]]:
        starters = self.active_starters(account)[: self.MAX_QUICK_REPLIES]
        chips: list[dict[str, str]] = []
        for starter in starters:
            title = (starter.question or "").strip()
            if not title:
                continue
            if len(title) > self.QUICK_REPLY_TITLE_MAX:
                title = title[: self.QUICK_REPLY_TITLE_MAX - 1].rstrip() + "…"
            chips.append(
                {
                    "content_type": "text",
                    "title": title,
                    "payload": starter.payload,
                },
            )
        return chips

    def sync_to_instagram(self, account: InstagramAccount) -> None:
        user_id = str(account.instagram_user_id or "")
        token = account.access_token()
        if not user_id:
            raise RuntimeError("Instagram account is missing a user id.")

        starters = self.active_starters(account)
        ice_breaker_actions = [
            {"question": starter.question, "payload": starter.payload}
            for starter in starters[: self.MAX_STARTERS]
        ]
        persistent_menu_actions = [
            {
                "type": "postback",
                "title": (
                    starter.question
                    if len(starter.question) <= 30
                    else starter.question[:29].rstrip() + "…"
                ),
                "payload": starter.payload,
            }
            for starter in starters[: self.MAX_PERSISTENT_MENU]
        ]

        # Ice breakers show before the bot can greet; chips are sent on the
        # greeting quick-reply message instead.
        self.instagram_api.clear_ice_breakers(user_id, token)

        if persistent_menu_actions:
            self.instagram_api.set_persistent_menu(user_id, token, persistent_menu_actions)
        else:
            try:
                self.instagram_api.clear_persistent_menu(user_id, token)
            except Exception as exc:
                # A missing persistent menu DELETE is non-fatal: log and continue.
                logger.info(
                    "Persistent menu clear no-op account=%s err=%s",
                    account.username,
                    exc,
                )

        logger.info(
            "Conversation chips synced account=%s ice=%s menu=%s",
            account.username,
            len(ice_breaker_actions),
            len(persistent_menu_actions),
        )

    @staticmethod
    def make_payload(question: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "_", question.lower()).strip("_")
        return slug[:100] or "starter"

    def handle_postback(self, account: InstagramAccount, event: dict) -> None:
        payload = str((event.get("postback") or {}).get("payload") or "")
        sender_id = str((event.get("sender") or {}).get("id") or "")
        self._reply_to_payload(account, sender_id, payload)

    def handle_quick_reply(self, account: InstagramAccount, event: dict) -> bool:
        """Reply to a quick-reply tap. Returns True if it was handled."""
        message = event.get("message") or {}
        payload = str(((message.get("quick_reply") or {}).get("payload")) or "")
        if not payload:
            return False
        sender_id = str((event.get("sender") or {}).get("id") or "")
        return self._reply_to_payload(account, sender_id, payload)

    def _reply_to_payload(
        self,
        account: InstagramAccount,
        sender_id: str,
        payload: str,
    ) -> bool:
        if not payload or not sender_id:
            return False

        starter = next(
            (item for item in account.conversation_starters if item.payload == payload),
            None,
        )
        if not starter:
            return False

        conversation = self._conversation_for_participant(account, sender_id)
        outbound = InstagramOutboundService(self.settings, self.instagram_api, db=self.db)
        outbound_id = outbound.send_text(
            account,
            sender_id,
            DEFAULT_HOLD_REPLY,
        )

        now = datetime.now(timezone.utc)
        self.db.add(
            InstagramMessage(
                instagram_conversation_id=conversation.id,
                instagram_message_id=outbound_id,
                direction="outbound",
                sender_ig_id=account.instagram_user_id,
                sender_username=account.username,
                body=DEFAULT_HOLD_REPLY,
                sent_at=now,
                auto_replied=False,
                created_at=now,
                updated_at=now,
            ),
        )
        self.db.commit()
        return True

    def _conversation_for_participant(
        self,
        account: InstagramAccount,
        participant_id: str,
    ) -> InstagramConversation:
        conversation = next(
            (item for item in account.conversations if item.participant_ig_id == participant_id),
            None,
        )
        if conversation:
            return conversation

        now = datetime.now(timezone.utc)
        conversation = InstagramConversation(
            instagram_account_id=account.id,
            participant_ig_id=participant_id,
            instagram_conversation_id=f"webhook_{participant_id}",
            last_message_at=now,
            created_at=now,
            updated_at=now,
        )
        self.db.add(conversation)
        self.db.flush()
        return conversation
