from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import InstagramAccount, InstagramConversation, InstagramMessage
from app.services.auto_reply_service import AutoReplyService
from app.services.conversation_resolver import (
    find_conversation_for_participant,
    find_duplicate_message,
)
from app.services.conversation_starter_service import ConversationStarterService
from app.services.agent_reply_policy import conversation_live_agent_handoff
from app.services.dm_chips_only import dm_chips_only_active, is_chip_sourced_inbound
from app.services.dm_ticket_service import DmTicketService
from app.services.dm_templates import DEFAULT_HOLD_REPLY, greeting_was_sent, is_menu_back_request, menu_choice_from_text
from app.services.platform_messaging_settings import auto_responses_paused
from app.services.participant_profile_service import schedule_participant_profile_enrichment
from app.services.platform_instagram import channel_auto_replies_active, find_channel_account_by_external_id
from app.services.typing_state import clear_typing, set_typing
from app.services.webhook_payload import InstagramWebhookPayload
from app.support.sales_session import read_session

logger = logging.getLogger(__name__)

# Legacy product-card postback prefix (sales autopilot removed).
SHOP_SELECT_PREFIX = "SHOP_SELECT:"


def message_body(message: dict) -> str | None:
    text = message.get("text")
    if text:
        return str(text)

    attachments = message.get("attachments")
    if not isinstance(attachments, list) or not attachments:
        return None

    parts: list[str] = []
    for attachment in attachments:
        if not isinstance(attachment, dict):
            continue
        kind = str(attachment.get("type") or "attachment")
        parts.append(f"[{kind}]")
    return " ".join(parts) if parts else "[attachment]"


class InstagramWebhookService:
    def __init__(
        self,
        db: Session,
        auto_reply: AutoReplyService,
        conversation_starters: ConversationStarterService,
        dm_tickets: DmTicketService,
        dm_bots,
        comment_agent=None,
    ):
        self.db = db
        self.auto_reply = auto_reply
        self.conversation_starters = conversation_starters
        self.dm_tickets = dm_tickets
        self.dm_bots = dm_bots
        self.comment_agent = comment_agent

    def handle(self, payload: dict) -> None:
        comment_items = InstagramWebhookPayload.comment_events(payload)
        for item in comment_items:
            self._handle_comment_event(item)

        normalized = InstagramWebhookPayload.messaging_events(payload)
        if not normalized:
            if not comment_items:
                logger.info(
                    "Instagram webhook: no message/postback to process (%s)",
                    InstagramWebhookPayload.describe_skipped(payload),
                )
            return

        for item in normalized:
            account = self._resolve_account(item.get("account_hint"), item["event"])
            if not account:
                logger.info(
                    "Instagram webhook: no matching merchant account hint=%s (ignored)",
                    item.get("account_hint"),
                )
                continue

            self._remember_webhook_ig_id(account, item.get("account_hint"))

            if item["event"].get("postback"):
                postback = item["event"].get("postback") or {}
                payload = str(postback.get("payload") or "")
                if payload.startswith(SHOP_SELECT_PREFIX):
                    self._handle_shop_select_postback(account, item["event"], payload.removeprefix(SHOP_SELECT_PREFIX))
                elif self.dm_bots.handle_postback(account, item["event"]):
                    pass
                else:
                    logger.info(
                        "Instagram webhook: postback not mapped to menu payload=%s",
                        payload[:80],
                    )
                continue

            sender_action = item["event"].get("sender_action")
            if sender_action in {"typing_on", "typing_off"}:
                self._handle_sender_action(account, item["event"], str(sender_action))
                continue

            self._handle_messaging_event(account, item["event"])

    def _handle_comment_event(self, item: dict) -> None:
        if self.comment_agent is None:
            return

        comment = item.get("comment") or {}
        comment_id = str(comment.get("comment_id") or "")
        post_id = str(comment.get("post_id") or "")
        text = str(comment.get("text") or "")
        if not comment_id or not post_id or not text.strip():
            return

        account_hint = item.get("account_hint")
        account = None
        if account_hint:
            account = find_channel_account_by_external_id(
                self.db,
                "instagram",
                str(account_hint),
            )
        if account is None:
            logger.info(
                "Instagram comment webhook: no matching merchant account hint=%s comment=%s (ignored)",
                account_hint,
                comment_id,
            )
            return

        try:
            self.comment_agent.process_inbound_comment(
                account,
                comment_id=comment_id,
                post_id=post_id,
                commenter_id=str(comment.get("commenter_id") or ""),
                commenter_username=comment.get("commenter_username"),
                text=text,
                parent_comment_id=comment.get("parent_comment_id"),
            )
        except Exception:
            logger.exception(
                "Instagram comment agent failed comment=%s post=%s",
                comment_id,
                post_id,
            )

    def _resolve_account(self, account_hint: str | None, event: dict) -> InstagramAccount | None:
        candidates = list(
            dict.fromkeys(
                value
                for value in [
                    account_hint,
                    str((event.get("recipient") or {}).get("id") or ""),
                    str((event.get("sender") or {}).get("id") or ""),
                ]
                if value
            ),
        )

        for candidate in candidates:
            account = find_channel_account_by_external_id(
                self.db,
                "instagram",
                candidate,
            )
            if account:
                return account

        return None

    def _remember_webhook_ig_id(self, account: InstagramAccount, entry_id: str | None) -> None:
        if not entry_id:
            return
        if entry_id == str(account.instagram_user_id or ""):
            return
        if str(account.instagram_webhook_ig_id or "") == entry_id:
            return
        account.instagram_webhook_ig_id = entry_id
        account.updated_at = datetime.now(timezone.utc)
        self.db.commit()

    def _handle_sender_action(
        self,
        account: InstagramAccount,
        event: dict,
        sender_action: str,
    ) -> None:
        sender_id = str((event.get("sender") or {}).get("id") or "")
        my_id = str(account.instagram_user_id or "")
        if not sender_id or sender_id == my_id:
            return

        timestamp = self._parse_timestamp(event.get("timestamp"))
        conversation = self._conversation_for_participant(account, sender_id, timestamp)
        if not conversation.participant_ig_id:
            conversation.participant_ig_id = sender_id
            self.db.commit()

        if sender_action == "typing_on":
            set_typing(conversation.id)
            logger.info(
                "Instagram webhook: customer typing conversation=%s participant=%s",
                conversation.id,
                conversation.participant_username or sender_id,
            )
            return

        clear_typing(conversation.id)
        logger.info(
            "Instagram webhook: customer stopped typing conversation=%s",
            conversation.id,
        )

    def _handle_messaging_event(self, account: InstagramAccount, event: dict) -> None:
        message = event.get("message")
        if not isinstance(message, dict) or message.get("is_deleted"):
            return

        mid = message.get("mid")
        body = message_body(message)
        quick_reply = message.get("quick_reply")
        if isinstance(quick_reply, dict):
            payload = str(quick_reply.get("payload") or "")
            choice = menu_choice_from_text(payload) or menu_choice_from_text(body)
            if choice is not None:
                body = str(choice)
            elif payload in {"order_yes", "order_no"}:
                body = payload
            elif is_menu_back_request(payload):
                body = payload.strip().lower()
            elif not body and payload:
                body = payload
        if not mid:
            logger.info("Instagram webhook: skipped message without mid")
            return
        if not body:
            logger.info(
                "Instagram webhook: skipped message without text or attachments mid=%s",
                mid,
            )
            return

        sender_id = str((event.get("sender") or {}).get("id") or "")
        recipient_id = str((event.get("recipient") or {}).get("id") or "")
        my_id = str(account.instagram_user_id or "")
        is_echo = bool(message.get("is_echo"))
        is_inbound = not is_echo and sender_id and sender_id != my_id

        if is_echo or (not is_inbound and sender_id == my_id):
            self._store_outbound_message(account, event, message, recipient_id, my_id)
            return

        if not is_inbound:
            return

        timestamp = self._parse_timestamp(event.get("timestamp"))
        conversation = self._conversation_for_participant(account, sender_id, timestamp)
        if not conversation.participant_ig_id:
            conversation.participant_ig_id = sender_id
        stored = self._upsert_inbound_message(conversation, mid, sender_id, body, timestamp)
        clear_typing(conversation.id)
        logger.info(
            "Instagram webhook: stored inbound message mid=%s account=%s preview=%s",
            mid,
            account.username,
            body[:80],
        )

        if account.platform == "instagram" and conversation.participant_ig_id:
            if not conversation.participant_profile_pic_url or not conversation.participant_username:
                schedule_participant_profile_enrichment(conversation.id, account.id)

        if not channel_auto_replies_active(self.db, account):
            self.db.commit()
            self._maybe_notify_merchant_message(account, conversation, stored)
            return

        was_closed_before_inbound = not conversation.is_ticket_open()
        ticket_open_handled = self.dm_tickets.process_inbound(account, conversation, stored)
        from_chip = is_chip_sourced_inbound(body=stored.body, event=event)
        if ticket_open_handled:
            session = read_session(conversation.sales_session)
            just_opened_ticket = bool(session.get("fresh_ticket_open"))
            if self.dm_bots.is_available():
                stored.auto_replied = False
                self.dm_bots.process_inbound(
                    account,
                    conversation,
                    stored,
                    from_chip=from_chip,
                    webhook_event=event,
                )
                if not stored.auto_replied:
                    stored.auto_replied = True
                    self.db.commit()
            elif menu_choice_from_text(stored.body) in (1, 2, 3):
                if not just_opened_ticket:
                    stored.auto_replied = False
                    self.db.commit()
                    self.dm_bots.process_inbound(
                        account,
                        conversation,
                        stored,
                        webhook_event=event,
                    )
                    if not stored.auto_replied:
                        stored.auto_replied = True
                        self.db.commit()
                else:
                    logger.info(
                        "DM reopen guard: skipped same-message menu routing conversation=%s participant=%s body=%s",
                        conversation.id,
                        conversation.participant_username or conversation.participant_ig_id,
                        (stored.body or "")[:80],
                    )
            self._maybe_notify_merchant_message(account, conversation, stored)
            return
        if was_closed_before_inbound:
            logger.info(
                "DM reopen guard: closed conversation skipped same-message menu routing conversation=%s participant=%s",
                conversation.id,
                conversation.participant_username or conversation.participant_ig_id,
            )
            return

        settings = self.auto_reply.settings
        if (
            not self.dm_bots.is_available()
            and dm_chips_only_active(settings, account, db=self.db)
            and not conversation_live_agent_handoff(conversation)
            and not is_chip_sourced_inbound(
                body=stored.body,
                event=event,
            )
        ):
            self.dm_bots.send_chips_only_reminder(account, conversation, stored)
            self._maybe_notify_merchant_message(account, conversation, stored)
            return

        self.dm_bots.process_inbound(
            account,
            conversation,
            stored,
            from_chip=from_chip,
            webhook_event=event,
        )
        self._maybe_notify_merchant_message(account, conversation, stored)

    def _maybe_notify_merchant_message(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> None:
        try:
            from app.services.merchant_notification_service import MerchantNotificationService

            MerchantNotificationService(self.db).maybe_notify_inbound_message(
                account,
                conversation,
                message,
            )
        except Exception:
            logger.exception(
                "Merchant message notification failed conversation=%s",
                conversation.id,
            )

    def _handle_shop_select_postback(
        self,
        account: InstagramAccount,
        event: dict,
        inventory_item_id: str,
    ) -> None:
        """Product card taps are not wired yet — reply with the hold message."""
        del inventory_item_id
        sender_id = str((event.get("sender") or {}).get("id") or "")
        if not sender_id:
            return

        if auto_responses_paused(self.db) or not getattr(account, "auto_replies_enabled", True):
            self.conversation_starters.handle_postback(account, event)
            return

        timestamp = self._parse_timestamp(event.get("timestamp"))
        conversation = self._conversation_for_participant(account, sender_id, timestamp)

        postback = event.get("postback") or {}
        mid = str(postback.get("mid") or f"pb_{uuid.uuid4().hex}")
        title = str(postback.get("title") or "Selected a product")
        stored = self._upsert_inbound_message(
            conversation, mid, sender_id, f"[tapped] {title}", timestamp
        )

        if not conversation.is_ticket_open() or not greeting_was_sent(conversation):
            if self.dm_tickets.process_inbound(account, conversation, stored):
                return

        from app.services.messaging_service import InstagramOutboundService

        outbound = InstagramOutboundService(
            self.auto_reply.settings,
            self.auto_reply.instagram_api,
            db=self.db,
        )
        outbound.send_text(account, sender_id, DEFAULT_HOLD_REPLY)
        stored.auto_replied = True
        self.db.commit()

    def _store_outbound_message(
        self,
        account: InstagramAccount,
        event: dict,
        message: dict,
        recipient_id: str,
        my_id: str,
    ) -> None:
        if not recipient_id or recipient_id == my_id:
            return

        mid = str(message["mid"])
        body = message_body(message) or ""
        timestamp = self._parse_timestamp(event.get("timestamp"))

        for conversation in account.conversations:
            if find_duplicate_message(
                conversation,
                mid=mid,
                body=body,
                sent_at=timestamp,
                direction="inbound",
                ignore_direction=True,
            ):
                return

        conversation = self._conversation_for_participant(account, recipient_id, timestamp)
        self._upsert_outbound_message(conversation, mid, my_id, body, timestamp)

    def _conversation_for_participant(
        self,
        account: InstagramAccount,
        participant_id: str,
        timestamp: datetime,
    ) -> InstagramConversation:
        conversation = find_conversation_for_participant(account, participant_id)
        if conversation:
            conversation.last_message_at = timestamp
            conversation.updated_at = datetime.now(timezone.utc)
            return conversation

        conversation = InstagramConversation(
            instagram_account_id=account.id,
            participant_ig_id=participant_id,
            instagram_conversation_id=f"webhook_{participant_id}",
            last_message_at=timestamp,
            created_at=timestamp,
            updated_at=timestamp,
        )
        self.db.add(conversation)
        self.db.flush()
        account.conversations.append(conversation)
        return conversation

    def _upsert_inbound_message(
        self,
        conversation: InstagramConversation,
        mid: str,
        sender_id: str,
        text: str,
        timestamp: datetime,
    ) -> InstagramMessage:
        message = find_duplicate_message(
            conversation,
            mid=mid,
            body=text,
            sent_at=timestamp,
            direction="inbound",
        )
        # instagram_message_id is globally unique; the same id may already be
        # stored under another (not-yet-merged) thread. Reuse it rather than
        # inserting a duplicate that would break the unique constraint.
        if message is None:
            message = (
                self.db.query(InstagramMessage)
                .filter(InstagramMessage.instagram_message_id == mid)
                .first()
            )
        if message:
            message.instagram_message_id = mid
            message.body = text
            message.sent_at = timestamp
            message.updated_at = datetime.now(timezone.utc)
            message.conversation = conversation
            return message

        message = InstagramMessage(
            instagram_conversation_id=conversation.id,
            instagram_message_id=mid,
            direction="inbound",
            sender_ig_id=sender_id,
            body=text,
            sent_at=timestamp,
            auto_replied=False,
            created_at=timestamp,
            updated_at=timestamp,
        )
        self.db.add(message)
        self.db.flush()
        conversation.messages.append(message)
        self.db.commit()
        self.db.refresh(message)
        return message

    def _upsert_outbound_message(
        self,
        conversation: InstagramConversation,
        mid: str,
        sender_id: str,
        text: str,
        timestamp: datetime,
    ) -> None:
        message = find_duplicate_message(
            conversation,
            mid=mid,
            body=text,
            sent_at=timestamp,
            direction="outbound",
        )
        if message is None:
            message = (
                self.db.query(InstagramMessage)
                .filter(InstagramMessage.instagram_message_id == mid)
                .first()
            )
        if message:
            message.instagram_message_id = mid
            message.body = text
            message.sent_at = timestamp
            message.updated_at = datetime.now(timezone.utc)
            message.conversation = conversation
        else:
            self.db.add(
                InstagramMessage(
                    instagram_conversation_id=conversation.id,
                    instagram_message_id=mid,
                    direction="outbound",
                    sender_ig_id=sender_id,
                    body=text,
                    sent_at=timestamp,
                    auto_replied=False,
                    created_at=timestamp,
                    updated_at=timestamp,
                ),
            )
        self.dm_tickets.maybe_close_for_outbound_body(conversation, text)
        self.db.commit()

    @staticmethod
    def _parse_timestamp(timestamp: object) -> datetime:
        if timestamp in (None, ""):
            return datetime.now(timezone.utc)
        value = int(timestamp)
        if value <= 0:
            return datetime.now(timezone.utc)
        if value < 1_000_000_000_000:
            return datetime.fromtimestamp(value, tz=timezone.utc)
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
