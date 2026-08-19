from __future__ import annotations

import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import AutoReplyRule, InstagramAccount, InstagramConversation, InstagramMessage
from app.services.conversation_resolver import (
    find_conversation_for_participant,
    find_duplicate_message,
    merge_conversations,
    merge_duplicate_conversations,
)
from app.services.instagram_api import InstagramApiService
from app.services.bot_sandbox_context import should_fake_instagram_outbound
from app.services.dm_templates import menu_choice_from_text
from app.services.instagram_connection import graph_access_token
from app.services.instagram_outbound_transport import InstagramOutboundTransport
from app.services.typing_state import clear_agent_typing, clear_typing, set_typing
from app.support.sales_session import read_session
from app.support.meta_time import parse_meta_datetime

if TYPE_CHECKING:
    from app.services.auto_reply_service import AutoReplyService

logger = logging.getLogger(__name__)

_LEGACY_DM_LINES = (
    "Please reply with the number or name of the product from our catalogue (for example: 1 or the product name).",
    "Reply 0 or menu to return to the main menu.",
)


def _strip_legacy_catalog_lines(text: str) -> str:
    lines = [line.strip() for line in (text or "").splitlines()]
    filtered = [line for line in lines if line and line not in _LEGACY_DM_LINES]
    if not filtered:
        return "Tap an option below to continue."
    return "\n".join(filtered)


class InstagramOutboundService:
    def __init__(
        self,
        settings: Settings,
        instagram_api: InstagramApiService,
        *,
        db: Session | None = None,
    ):
        self.settings = settings
        self.instagram_api = instagram_api
        self.db = db
        self._transport: InstagramOutboundTransport | None = None

    def _get_transport(self) -> InstagramOutboundTransport:
        if self._transport is None:
            self._transport = InstagramOutboundTransport(
                self.settings,
                self.instagram_api,
                db=self.db,
            )
        return self._transport

    def _conversation_for_id(self, conversation_id: str | None) -> InstagramConversation | None:
        if not conversation_id or self.db is None:
            return None
        return self.db.get(InstagramConversation, conversation_id)

    def send_typing_on(self, account: InstagramAccount, recipient_ig_scoped_id: str) -> None:
        if should_fake_instagram_outbound(account, fake_messaging_setting=self.settings.instagram_fake_messaging):
            logger.debug(
                "Instagram typing_on (fake mode) account=%s recipient=%s",
                account.username,
                recipient_ig_scoped_id,
            )
            return
        if account.platform != "instagram":
            return
        self.instagram_api.send_sender_action(
            recipient_ig_scoped_id,
            "typing_on",
            graph_access_token(self.db, self.settings, self.instagram_api, account),
        )

    def send_typing_off(self, account: InstagramAccount, recipient_ig_scoped_id: str) -> None:
        if should_fake_instagram_outbound(account, fake_messaging_setting=self.settings.instagram_fake_messaging):
            return
        if account.platform != "instagram":
            return
        try:
            self.instagram_api.send_sender_action(
                recipient_ig_scoped_id,
                "typing_off",
                graph_access_token(self.db, self.settings, self.instagram_api, account),
            )
        except Exception as exc:
            logger.warning(
                "Instagram typing_off failed account=%s recipient=%s error=%s",
                account.username,
                recipient_ig_scoped_id,
                exc,
            )

    def _end_outbound_typing(
        self,
        account: InstagramAccount,
        recipient_ig_scoped_id: str,
        *,
        conversation_id: str | None = None,
    ) -> None:
        self.send_typing_off(account, recipient_ig_scoped_id)
        if conversation_id:
            clear_agent_typing(conversation_id)

    def send_text(
        self,
        account: InstagramAccount,
        recipient_ig_scoped_id: str,
        text: str,
        quick_replies: list[dict[str, str]] | None = None,
        *,
        conversation_id: str | None = None,
    ) -> str:
        self._end_outbound_typing(
            account,
            recipient_ig_scoped_id,
            conversation_id=conversation_id,
        )
        text = _strip_legacy_catalog_lines(text)
        if should_fake_instagram_outbound(account, fake_messaging_setting=self.settings.instagram_fake_messaging):
            logger.info(
                "Instagram outbound (fake mode) account=%s recipient=%s chips=%s",
                account.username,
                recipient_ig_scoped_id,
                len(quick_replies or []),
            )
            return f"fake_{uuid.uuid4().hex}"

        if account.platform != "instagram":
            raise RuntimeError(
                f"Outbound auto-replies for platform '{account.platform}' are not implemented yet.",
            )

        conversation = self._conversation_for_id(conversation_id)
        result = self._get_transport().send_text(
            account,
            recipient_ig_scoped_id,
            text,
            conversation=conversation,
            quick_replies=quick_replies,
        )
        if result.delivery_status == "failed":
            raise RuntimeError(result.delivery_error or "Failed to send message")
        return result.message_id or f"out_{uuid.uuid4().hex}"

    def send_image(
        self,
        account: InstagramAccount,
        recipient_ig_scoped_id: str,
        image_url: str,
        *,
        conversation_id: str | None = None,
    ) -> str:
        self._end_outbound_typing(
            account,
            recipient_ig_scoped_id,
            conversation_id=conversation_id,
        )
        if should_fake_instagram_outbound(account, fake_messaging_setting=self.settings.instagram_fake_messaging):
            logger.info(
                "Instagram outbound image (fake mode) account=%s recipient=%s url=%s",
                account.username,
                recipient_ig_scoped_id,
                image_url[:120],
            )
            return f"fake_img_{uuid.uuid4().hex}"

        if account.platform != "instagram":
            raise RuntimeError(
                f"Outbound image messages for platform '{account.platform}' are not implemented yet.",
            )

        conversation = self._conversation_for_id(conversation_id)
        result = self._get_transport().send_image(
            account,
            recipient_ig_scoped_id,
            image_url,
            conversation=conversation,
        )
        if result.delivery_status == "failed":
            raise RuntimeError(result.delivery_error or "Failed to send image")
        return result.message_id or f"out_img_{uuid.uuid4().hex}"

    def send_generic_template(
        self,
        account: InstagramAccount,
        recipient_ig_scoped_id: str,
        elements: list[dict[str, Any]],
        *,
        conversation_id: str | None = None,
    ) -> str:
        self._end_outbound_typing(
            account,
            recipient_ig_scoped_id,
            conversation_id=conversation_id,
        )
        if should_fake_instagram_outbound(account, fake_messaging_setting=self.settings.instagram_fake_messaging):
            logger.info(
                "Instagram outbound carousel (fake mode) account=%s recipient=%s cards=%s",
                account.username,
                recipient_ig_scoped_id,
                len(elements),
            )
            return f"fake_carousel_{uuid.uuid4().hex}"

        if account.platform != "instagram":
            raise RuntimeError(
                f"Outbound carousel messages for platform '{account.platform}' are not implemented yet.",
            )

        conversation = self._conversation_for_id(conversation_id)
        result = self._get_transport().send_generic_template(
            account,
            recipient_ig_scoped_id,
            elements,
            conversation=conversation,
        )
        if result.delivery_status == "failed":
            raise RuntimeError(result.delivery_error or "Failed to send generic template")
        return result.message_id or f"out_carousel_{uuid.uuid4().hex}"


class InstagramMessagingService:
    def __init__(
        self,
        db: Session,
        settings: Settings,
        instagram_api: InstagramApiService,
        auto_reply: AutoReplyService,
    ):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api
        self.auto_reply = auto_reply

    def sync(self, account: InstagramAccount) -> dict:
        token = graph_access_token(self.db, self.settings, self.instagram_api, account)
        my_ig_id = str(account.instagram_user_id or "")
        synced = 0
        conversations = self.instagram_api.get_conversations(token)
        api_conversation_count = len(conversations)

        for conversation_data in conversations:
            conversation = self._upsert_conversation(account, conversation_data)
            message_ids = self.instagram_api.get_conversation_messages(
                conversation.instagram_conversation_id,
                token,
            )

            for message_stub in message_ids[:20]:
                detail = self.instagram_api.get_message(message_stub["id"], token)
                from_id = str((detail.get("from") or {}).get("id") or "")
                is_inbound = bool(from_id and from_id != my_ig_id)
                message = self._upsert_message(conversation, detail, from_id, is_inbound)

                synced += 1

            latest_inbound = next(
                (msg for msg in conversation.messages if msg.direction == "inbound"),
                None,
            )
            if latest_inbound:
                conversation.participant_ig_id = latest_inbound.sender_ig_id
                conversation.participant_username = latest_inbound.sender_username
                self._merge_webhook_thread(account, conversation, str(latest_inbound.sender_ig_id or ""))

        merge_duplicate_conversations(self.db, account)
        account.messages_synced_at = datetime.now(timezone.utc)
        self.db.commit()

        return {
            "messages_synced": synced,
            "api_conversation_count": api_conversation_count,
        }

    def send_reply(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        text: str,
    ) -> InstagramMessage:
        recipient_id = conversation.participant_ig_id
        if not recipient_id:
            raise RuntimeError("Cannot send: unknown recipient for this conversation.")

        outbound = InstagramOutboundService(self.settings, self.instagram_api, db=self.db)
        response = outbound.send_text(account, recipient_id, text, conversation_id=conversation.id)
        message = InstagramMessage(
            instagram_conversation_id=conversation.id,
            instagram_message_id=response,
            direction="outbound",
            sender_ig_id=account.instagram_user_id,
            sender_username=account.username,
            body=text,
            sent_at=datetime.now(timezone.utc),
            auto_replied=False,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self.db.add(message)
        self.db.commit()
        self.db.refresh(message)
        return message

    def _upsert_conversation(
        self,
        account: InstagramAccount,
        conversation_data: dict,
    ) -> InstagramConversation:
        existing = next(
            (
                item
                for item in account.conversations
                if item.instagram_conversation_id == conversation_data["id"]
            ),
            None,
        )
        last_message_at = None
        if conversation_data.get("updated_time"):
            last_message_at = parse_meta_datetime(conversation_data["updated_time"])

        if existing:
            existing.last_message_at = last_message_at
            existing.updated_at = datetime.now(timezone.utc)
            return existing

        conversation = InstagramConversation(
            instagram_account_id=account.id,
            instagram_conversation_id=conversation_data["id"],
            last_message_at=last_message_at,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self.db.add(conversation)
        self.db.flush()
        account.conversations.append(conversation)
        return conversation

    def _merge_webhook_thread(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        customer_id: str,
    ) -> None:
        if not customer_id:
            return
        webhook_match = find_conversation_for_participant(account, customer_id)
        if webhook_match is None or webhook_match.id == conversation.id:
            return
        merge_conversations(self.db, conversation, webhook_match)

    def _upsert_message(
        self,
        conversation: InstagramConversation,
        detail: dict,
        from_id: str,
        is_inbound: bool,
    ) -> InstagramMessage:
        sent_at = None
        if detail.get("created_time"):
            sent_at = parse_meta_datetime(detail["created_time"])
        sent_at = sent_at or datetime.now(timezone.utc)
        direction = "inbound" if is_inbound else "outbound"
        body = detail.get("message") or ""

        mid = str(detail["id"])
        existing = find_duplicate_message(
            conversation,
            mid=mid,
            body=body,
            sent_at=sent_at,
            direction=direction,
        )

        # The instagram_message_id is globally unique, so the same id may
        # already be stored under a different (e.g. webhook-created) thread
        # that hasn't been merged yet. Reuse it instead of inserting a
        # duplicate, which would fail the unique constraint and poison the
        # session with a PendingRollbackError.
        if existing is None:
            existing = (
                self.db.query(InstagramMessage)
                .filter(InstagramMessage.instagram_message_id == mid)
                .first()
            )

        values = {
            "instagram_conversation_id": conversation.id,
            "direction": direction,
            "sender_ig_id": from_id or None,
            "sender_username": (detail.get("from") or {}).get("username"),
            "body": body,
            "sent_at": sent_at,
            "updated_at": datetime.now(timezone.utc),
        }

        if existing:
            existing.instagram_message_id = mid
            for key, value in values.items():
                setattr(existing, key, value)
            # Reassign through the relationship so a message moved from
            # another thread isn't reverted to its old conversation on flush.
            existing.conversation = conversation
            return existing

        message = InstagramMessage(
            instagram_message_id=mid,
            auto_replied=False,
            created_at=datetime.now(timezone.utc),
            **values,
        )
        self.db.add(message)
        self.db.flush()
        conversation.messages.append(message)
        return message


class SimulatedInboundMessageService:
    def __init__(self, db: Session, auto_reply: AutoReplyService, dm_tickets, dm_inbound):
        self.db = db
        self.auto_reply = auto_reply
        self.dm_tickets = dm_tickets
        self.dm_inbound = dm_inbound

    def ingest(
        self,
        account: InstagramAccount,
        sender_ig_id: str,
        text: str,
        message_id: str | None = None,
        *,
        simulate_typing: bool = True,
        from_chip: bool = False,
    ) -> InstagramMessage:
        message_id = message_id or f"sim_{uuid.uuid4().hex}"
        timestamp = datetime.now(timezone.utc)

        conversation = next(
            (
                item
                for item in account.conversations
                if item.participant_ig_id == sender_ig_id
            ),
            None,
        )
        if conversation is None:
            conversation = InstagramConversation(
                instagram_account_id=account.id,
                participant_ig_id=sender_ig_id,
                instagram_conversation_id=f"sim_{sender_ig_id}",
                last_message_at=timestamp,
                created_at=timestamp,
                updated_at=timestamp,
            )
            self.db.add(conversation)
            self.db.flush()
            account.conversations.append(conversation)
        else:
            conversation.last_message_at = timestamp
            conversation.updated_at = timestamp

        if simulate_typing:
            set_typing(conversation.id, duration_seconds=3.0)
            time.sleep(1.6)

        message = next(
            (item for item in conversation.messages if item.instagram_message_id == message_id),
            None,
        )
        if message is None:
            message = InstagramMessage(
                instagram_conversation_id=conversation.id,
                instagram_message_id=message_id,
                direction="inbound",
                sender_ig_id=sender_ig_id,
                body=text,
                sent_at=timestamp,
                auto_replied=False,
                created_at=timestamp,
                updated_at=timestamp,
            )
            self.db.add(message)
            self.db.flush()
        else:
            message.body = text
            message.sent_at = timestamp
            message.auto_replied = False

        clear_typing(conversation.id)

        was_closed_before_inbound = not conversation.is_ticket_open()
        ticket_open_handled = self.dm_tickets.process_inbound(account, conversation, message)
        if ticket_open_handled:
            session = read_session(conversation.sales_session)
            just_opened_ticket = bool(session.get("fresh_ticket_open"))
            if self.dm_inbound.is_available():
                message.auto_replied = False
                self.dm_inbound.process_inbound(
                    account,
                    conversation,
                    message,
                    from_chip=from_chip,
                )
                if not message.auto_replied:
                    message.auto_replied = True
            elif menu_choice_from_text(message.body) in (1, 2, 3):
                if not just_opened_ticket:
                    message.auto_replied = False
                    self.dm_inbound.process_inbound(
                        account,
                        conversation,
                        message,
                        from_chip=from_chip,
                    )
                    if not message.auto_replied:
                        message.auto_replied = True
            self.db.commit()
            self.db.refresh(message)
            return message

        if was_closed_before_inbound:
            self.db.commit()
            self.db.refresh(message)
            return message

        self.dm_inbound.process_inbound(
            account,
            conversation,
            message,
            from_chip=from_chip,
        )
        self.db.commit()
        self.db.refresh(message)
        return message
