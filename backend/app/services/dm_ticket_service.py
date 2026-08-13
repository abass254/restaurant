from __future__ import annotations

import logging
import threading
import time
import uuid

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import (
    InstagramAccount,
    InstagramConversation,
    InstagramMessage,
)
from app.services.dm_templates import (
    DEFAULT_GREETING_CHIP_PROMPT,
    DEFAULT_GREETING_INTRO,
    DEFAULT_GREETING_REPLY,
    DEFAULT_GREETING_TRIGGER,
    DEFAULT_HOLD_REPLY,
    DEFAULT_AGENT_TICKET_CLOSED_MESSAGE,
    DEFAULT_TICKET_CLOSE_MESSAGE,
    greeting_quick_replies,
    greeting_was_sent,
    is_ticket_close_message,
    menu_choice_from_text,
    render_reply_text,
)
from app.services.agent_reply_policy import auto_replies_handle_inbound
from app.services.platform_instagram import channel_auto_replies_active, supports_dm_bot
from app.services.platform_messaging_settings import get_wait_dm_time_seconds
from app.services.support_ticket_service import SupportTicketService
from app.services.agent_typing_signals import signal_agent_typing
from app.support.datetime_utils import utc_now
from app.support.sales_session import STEP_IDLE, write_session

logger = logging.getLogger(__name__)

TICKET_CLOSE_MESSAGE = DEFAULT_TICKET_CLOSE_MESSAGE


class DmTicketService:
    """Open/close Instagram DM tickets with a greeting and inactivity timeout."""

    def __init__(self, db: Session, settings: Settings, instagram_api):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api
        self.support_tickets = SupportTicketService(db)

    def process_inbound(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> bool:
        """Handle ticket open/greet/timeout scheduling.

        Returns ``True`` when the ticket open/reopen flow ran (caller should
        route the inbound message to the bot engine). Returns ``False`` when
        only recording a reply on an already-open ticket.
        """
        if not supports_dm_bot(account):
            return False
        if not message.is_inbound() or message.auto_replied:
            return False
        if not channel_auto_replies_active(self.db, account):
            return False

        if conversation.awaiting_customer_since is not None:
            ticket = self.support_tickets.get_current_ticket(conversation)
            if ticket is not None:
                self.support_tickets.record_customer_reply(ticket)
            conversation.awaiting_customer_since = None
            conversation.response_timeout_token = None
            conversation.updated_at = utc_now()
            self.db.commit()
            logger.info(
                "DM ticket: customer replied during wait conversation=%s",
                conversation.id,
            )
            return False

        is_first_inbound = self._is_first_inbound(conversation, message)
        is_reopen = not conversation.is_ticket_open()
        never_greeted = not self._has_bot_outbound(conversation)
        if not is_first_inbound and not is_reopen and not never_greeted:
            ticket = self.support_tickets.get_current_ticket(conversation)
            if ticket is not None and ticket.is_open():
                self.support_tickets.record_customer_reply(ticket)
                self.db.commit()
            return False

        now = utc_now()
        timeout_token = uuid.uuid4().hex
        conversation.ticket_status = "open"
        conversation.ticket_opened_at = now
        conversation.ticket_closed_at = None
        conversation.awaiting_customer_since = now
        conversation.response_timeout_token = timeout_token
        conversation.updated_at = now

        ticket = self.support_tickets.open_ticket(account, conversation, now=now)

        write_session(conversation, clear=True)
        conversation.sales_session = {
            "step": STEP_IDLE,
            "menu_sent": True,
            "fresh_ticket_open": True,
        }

        greeting_sent = False
        from app.services.agent_reply_policy import should_send_template_greeting

        if should_send_template_greeting(self.db, self.settings):
            # Menu / autopilot bots greet with chips on a fresh/reopened ticket.
            offer_menu_chips = True
            try:
                greeting_sent = self._send_greeting(
                    account,
                    conversation,
                    message,
                    ticket,
                    offer_menu_chips=offer_menu_chips,
                )
                if greeting_sent:
                    message.auto_replied = True
            except Exception as exc:
                logger.warning(
                    "DM ticket greeting send failed conversation=%s participant=%s error=%s",
                    conversation.id,
                    conversation.participant_ig_id,
                    exc,
                )
                raise

        self.db.commit()

        wait_seconds = get_wait_dm_time_seconds(self.db)
        self._schedule_inactivity_close(conversation.id, timeout_token, wait_seconds)
        logger.info(
            "DM ticket opened conversation=%s participant=%s wait=%ss greeting=%s",
            conversation.id,
            conversation.participant_username or conversation.participant_ig_id,
            wait_seconds,
            greeting_sent,
        )
        if is_reopen or not auto_replies_handle_inbound(self.db, account):
            try:
                from app.services.merchant_notification_service import MerchantNotificationService

                MerchantNotificationService(self.db).notify_ticket_opened(
                    account,
                    conversation,
                    ticket,
                )
            except Exception:
                logger.exception(
                    "Ticket opened notification failed conversation=%s",
                    conversation.id,
                )
        return True

    def send_opening_greeting(
        self,
        account: InstagramAccount,
        participant_ig_id: str,
        *,
        participant_username: str | None = None,
    ) -> InstagramConversation:
        """Proactive greeting when a customer opens chat (bot sandbox preview)."""
        if not supports_dm_bot(account):
            raise RuntimeError("DM bot is not enabled for this account.")
        if not channel_auto_replies_active(self.db, account):
            raise RuntimeError("Auto-replies are paused for this account.")

        now = utc_now()
        conversation = next(
            (
                item
                for item in account.conversations
                if item.participant_ig_id == participant_ig_id
            ),
            None,
        )
        if conversation is None:
            conversation = InstagramConversation(
                instagram_account_id=account.id,
                participant_ig_id=participant_ig_id,
                participant_username=participant_username,
                instagram_conversation_id=f"sim_{participant_ig_id}",
                last_message_at=now,
                created_at=now,
                updated_at=now,
            )
            self.db.add(conversation)
            self.db.flush()
            account.conversations.append(conversation)
        elif participant_username and not (conversation.participant_username or "").strip():
            conversation.participant_username = participant_username

        if conversation.is_ticket_open() and greeting_was_sent(conversation):
            return conversation

        timeout_token = uuid.uuid4().hex
        conversation.ticket_status = "open"
        conversation.ticket_opened_at = now
        conversation.ticket_closed_at = None
        conversation.awaiting_customer_since = now
        conversation.response_timeout_token = timeout_token
        conversation.updated_at = now

        ticket = self.support_tickets.open_ticket(account, conversation, now=now)
        write_session(conversation, clear=True)
        conversation.sales_session = {
            "step": STEP_IDLE,
            "menu_sent": True,
            "fresh_ticket_open": True,
        }

        from app.services.agent_reply_policy import should_send_template_greeting

        if should_send_template_greeting(self.db, self.settings):
            self._send_greeting(
                account,
                conversation,
                None,
                ticket,
                offer_menu_chips=True,
            )

        self.db.commit()
        wait_seconds = get_wait_dm_time_seconds(self.db)
        self._schedule_inactivity_close(conversation.id, timeout_token, wait_seconds)
        return conversation

    def _send_greeting(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage | None,
        ticket,
        *,
        offer_menu_chips: bool,
    ) -> bool:
        intro = render_reply_text(DEFAULT_GREETING_INTRO, conversation, message)
        signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.5,
        )
        self._send_outbound(account, conversation, intro)
        if offer_menu_chips:
            chip_prompt = render_reply_text(DEFAULT_GREETING_CHIP_PROMPT, conversation, message)
            self._send_outbound(
                account,
                conversation,
                chip_prompt,
                quick_replies=greeting_quick_replies(),
            )
        self.support_tickets.log_greeting_sent(ticket)
        return True

    def send_hold_reply(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> bool:
        """Default bot reply until further flow instructions are configured."""
        if not supports_dm_bot(account):
            return False
        if not message.is_inbound() or message.auto_replied:
            return False
        if not channel_auto_replies_active(self.db, account):
            return False

        try:
            signal_agent_typing(
                account,
                conversation,
                settings=self.settings,
                instagram_api=self.instagram_api,
                duration_seconds=2.0,
            )
            sent = self._send_outbound(account, conversation, DEFAULT_HOLD_REPLY)
        except Exception as exc:
            logger.warning(
                "DM hold reply send failed conversation=%s participant=%s error=%s",
                conversation.id,
                conversation.participant_ig_id,
                exc,
            )
            return False

        if not sent:
            return False

        message.auto_replied = True
        self.db.commit()
        logger.info(
            "DM hold reply sent conversation=%s participant=%s",
            conversation.id,
            conversation.participant_username or conversation.participant_ig_id,
        )
        return True

    def close_if_still_waiting(self, conversation_id: str, timeout_token: str) -> None:
        conversation = (
            self.db.query(InstagramConversation)
            .filter(InstagramConversation.id == conversation_id)
            .first()
        )
        if conversation is None:
            return
        if not conversation.is_ticket_open():
            return
        if conversation.response_timeout_token != timeout_token:
            return
        if conversation.awaiting_customer_since is None:
            return

        account = conversation.account
        if account is None:
            account = (
                self.db.query(InstagramAccount)
                .filter(InstagramAccount.id == conversation.instagram_account_id)
                .first()
            )
        if account is None:
            return

        now = utc_now()
        sent = self._send_outbound(account, conversation, TICKET_CLOSE_MESSAGE)
        if not sent:
            logger.warning(
                "DM ticket inactivity close skipped: outbound not sent conversation=%s",
                conversation.id,
            )
            return

        self._apply_inactivity_close(conversation)
        self.db.commit()
        logger.info(
            "DM ticket closed due to inactivity conversation=%s participant=%s",
            conversation.id,
            conversation.participant_username or conversation.participant_ig_id,
        )

    def maybe_close_for_outbound_body(
        self,
        conversation: InstagramConversation,
        body: str | None,
    ) -> bool:
        """Close the ticket when the inactivity close message appears in the thread."""
        if not is_ticket_close_message(body):
            return False
        if not conversation.is_ticket_open():
            return False
        self._apply_inactivity_close(conversation)
        logger.info(
            "DM ticket closed after inactivity message conversation=%s participant=%s",
            conversation.id,
            conversation.participant_username or conversation.participant_ig_id,
        )
        return True

    def send_agent_closed_notice(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
    ) -> bool:
        """Notify customer in-DM when an agent closes a ticket."""
        return self._send_outbound(
            account,
            conversation,
            DEFAULT_AGENT_TICKET_CLOSED_MESSAGE,
        )

    def _apply_inactivity_close(self, conversation: InstagramConversation) -> None:
        now = utc_now()
        ticket = self.support_tickets.get_current_ticket(conversation)
        if ticket is not None and ticket.is_open():
            self.support_tickets.close_auto_timeout(ticket)
        conversation.ticket_status = "closed"
        conversation.ticket_closed_at = now
        conversation.awaiting_customer_since = None
        conversation.response_timeout_token = None
        # Closed tickets must restart order flow from scratch.
        write_session(conversation, clear=True)
        conversation.sales_session = {
            "step": STEP_IDLE,
            "menu_sent": True,
            "fresh_ticket_open": True,
        }
        conversation.updated_at = now

    def _send_outbound(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        text: str,
        *,
        quick_replies: list[dict[str, str]] | None = None,
    ) -> bool:
        from app.services.messaging_service import InstagramOutboundService

        recipient_id = str(conversation.participant_ig_id or "")
        if not recipient_id:
            logger.warning(
                "DM ticket outbound skipped: missing participant_ig_id conversation=%s",
                conversation.id,
            )
            return False

        outbound = InstagramOutboundService(self.settings, self.instagram_api, db=self.db)
        outbound_id = outbound.send_text(
            account,
            recipient_id,
            text,
            quick_replies=quick_replies,
            conversation_id=conversation.id,
        )
        now = utc_now()
        self.db.add(
            InstagramMessage(
                instagram_conversation_id=conversation.id,
                instagram_message_id=outbound_id,
                direction="outbound",
                sender_ig_id=account.instagram_user_id,
                sender_username=account.username,
                body=text,
                sent_at=now,
                auto_replied=False,
                created_at=now,
                updated_at=now,
            ),
        )
        return True

    def _schedule_inactivity_close(
        self,
        conversation_id: str,
        timeout_token: str,
        wait_seconds: int,
    ) -> None:
        thread = threading.Thread(
            target=_run_inactivity_close,
            args=(conversation_id, timeout_token, wait_seconds),
            daemon=True,
            name=f"dm-ticket-timeout-{conversation_id[:8]}",
        )
        thread.start()

    @staticmethod
    def _has_bot_outbound(conversation: InstagramConversation) -> bool:
        return any(message.direction == "outbound" for message in conversation.messages)

    @staticmethod
    def _is_first_inbound(
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> bool:
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


def _run_inactivity_close(conversation_id: str, timeout_token: str, wait_seconds: int) -> None:
    from app.config import get_settings
    from app.database import SessionLocal
    from app.services.instagram_api import InstagramApiService

    time.sleep(wait_seconds)
    settings = get_settings()
    db = SessionLocal()
    try:
        service = DmTicketService(db, settings, InstagramApiService(settings))
        service.close_if_still_waiting(conversation_id, timeout_token)
    except Exception:
        logger.exception(
            "DM ticket inactivity close failed conversation=%s",
            conversation_id,
        )
    finally:
        db.close()
