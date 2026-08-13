from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount, InstagramConversation, InstagramMessage
from app.services.conversation_resolver import find_conversation_for_participant, find_duplicate_message
from app.services.dm_postback import ingest_postback_message, synthetic_body_from_postback_event
from app.services.dm_chips_only import (
    CHIPS_ONLY_REMINDER,
    dm_chips_only_active,
    dm_offer_quick_replies,
    order_confirm_quick_replies_with_menu_back,
    outbound_quick_replies,
    completion_confirm_quick_replies_with_menu_back,
    is_chip_sourced_inbound,
    parse_product_select_payload,
    parse_quantity_payload,
    quantity_quick_replies,
    quick_replies_for_conversation,
)
from app.services.dm_templates import (
    DEFAULT_HOLD_REPLY,
    format_dukai_resume_reply,
    format_live_agent_reply,
    format_menu_reminder,
    format_order_confirm_prompt,
    format_order_declined_message,
    format_quantity_prompt,
    format_quantity_retry_message,
    format_root_menu,
    greeting_quick_replies,
    greeting_was_sent,
    is_live_agent_request,
    is_menu_back_request,
    is_order_confirm_no,
    is_order_confirm_yes,
    is_completion_confirm_no,
    is_completion_confirm_yes,
    menu_back_quick_replies,
    menu_choice_from_text,
    order_confirm_quick_replies,
)
from app.services.dm_catalog_service import DmCatalogService
from app.services.dm_order_service import DmOrderService
from app.services.order_creation import StorePausedError, build_instagram_order
from app.services.inventory_stock_service import InsufficientStockError
from app.services.order_completion_service import OrderCompletionService
from app.services.platform_instagram import channel_auto_replies_active, supports_dm_bot
from app.services.order_notification_service import (
    OrderNotificationService,
    should_send_tracking_card,
)
from app.services.support_ticket_service import SupportTicketService
from app.services.agent_typing_signals import signal_agent_typing
from app.support.datetime_utils import utc_now
from app.support.order_status import AWAITING_PAYMENT, PLACED
from app.support.order_status import TERMINAL_STATUSES
from app.support.sales_session import (
    STEP_AWAITING_COMPLETION_CONFIRM,
    STEP_AWAITING_ORDER_CONFIRM,
    STEP_AWAITING_QUANTITY,
    STEP_HANDOFF,
    STEP_IDLE,
    STEP_TRACKING,
    clear_sales_session_keys,
    merge_sales_session,
    read_session,
    write_session,
)
from app.support.quantity_parse import clamp_quantity, parse_quantity

logger = logging.getLogger(__name__)


def _parse_timestamp(timestamp: object) -> datetime:
    if timestamp in (None, ""):
        return datetime.now(timezone.utc)
    value = int(timestamp)
    if value <= 0:
        return datetime.now(timezone.utc)
    if value < 1_000_000_000_000:
        return datetime.fromtimestamp(value, tz=timezone.utc)
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc)


class DmMenuService:
    """Route post-greeting DMs through the 1/2/3 menu."""

    def __init__(
        self,
        db: Session,
        settings: Settings,
        instagram_api,
        *,
        dm_tickets=None,
    ):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api
        self.dm_tickets = dm_tickets
        self.support_tickets = SupportTicketService(db)
        self.catalog = DmCatalogService(db, settings, instagram_api)
        self.orders = DmOrderService(db, settings)

    def process_inbound(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        *,
        from_chip: bool = False,
        webhook_event: dict | None = None,
    ) -> bool:
        if not supports_dm_bot(account):
            return False
        if not message.is_inbound() or message.auto_replied:
            return False
        if not channel_auto_replies_active(self.db, account):
            return False
        if not conversation.is_ticket_open():
            return False
        if not self._greeting_was_sent(conversation):
            return False

        ticket = self.support_tickets.get_current_ticket(conversation)
        if ticket is not None and ticket.is_open():
            self.support_tickets.record_customer_reply(ticket)

        text = (message.body or "").strip()
        session = read_session(conversation.sales_session)
        if session.get("fresh_ticket_open"):
            merge_sales_session(conversation, fresh_ticket_open=None)
            session = read_session(conversation.sales_session)

        if session.get("step") == STEP_HANDOFF:
            self.db.commit()
            return True

        product_item_id = parse_product_select_payload(text)
        if product_item_id:
            text = product_item_id
        quantity_from_chip = parse_quantity_payload((message.body or "").strip())
        if quantity_from_chip is not None:
            text = str(quantity_from_chip)

        if dm_chips_only_active(self.settings, account, db=self.db) and not is_chip_sourced_inbound(
            body=message.body,
            event=webhook_event,
            from_chip=from_chip,
        ):
            self.send_chips_only_reminder(account, conversation, message)
            return True

        pending_item_id = session.get("catalog_pending_item_id")
        if pending_item_id and session.get("step") == STEP_AWAITING_QUANTITY:
            self._handle_quantity_response(
                account,
                conversation,
                message,
                text,
                str(pending_item_id),
            )
            return True

        if pending_item_id and session.get("step") == STEP_AWAITING_ORDER_CONFIRM:
            self._handle_order_confirm_response(
                account,
                conversation,
                message,
                text,
                str(pending_item_id),
            )
            return True

        if self._handle_completion_confirm_response(
            account,
            conversation,
            message,
            text,
            session,
        ):
            return True

        if is_menu_back_request(text):
            self._clear_catalog_context(conversation)
            merge_sales_session(conversation, step=STEP_IDLE, order_id=None, menu_sent=True)
            self._send_menu_reminder(account, conversation, message)
            return True

        active_order = self.orders.order_for_session(conversation.id, session)
        if active_order and active_order.status in TERMINAL_STATUSES:
            merge_sales_session(conversation, order_id=None, step=STEP_IDLE)
            session = read_session(conversation.sales_session)
            active_order = None

        choice = menu_choice_from_text(text)
        if choice == 3 or is_live_agent_request(text):
            self._handle_live_agent(account, conversation, message, ticket)
            logger.info(
                "DM live agent handoff conversation=%s participant=%s",
                conversation.id,
                conversation.participant_username or conversation.participant_ig_id,
            )
            return True

        if active_order and not session.get("catalog_choice"):
            if choice in (1, 2):
                message.auto_replied = True
                self.db.commit()
                return True

            if self.orders.is_track_request(text):
                self._send_order_status_reply(
                    account,
                    conversation,
                    message,
                    active_order,
                    include_timeline=True,
                )
                return True

            self._send_order_status_reply(
                account,
                conversation,
                message,
                active_order,
                include_timeline=self.orders.is_track_request(text),
                brief=not self.orders.is_track_request(text),
            )
            return True

        catalog_choice = session.get("catalog_choice")
        if catalog_choice in (1, 2) and active_order is None:
            self._send_catalog_follow_up(account, conversation, message)
            logger.info(
                "DM catalog follow-up conversation=%s participant=%s catalog_choice=%s",
                conversation.id,
                conversation.participant_username or conversation.participant_ig_id,
                catalog_choice,
            )
            return True

        if choice is not None:
            if ticket is not None:
                self.support_tickets.log_event(
                    ticket,
                    "menu_selected",
                    f"Customer chose option {choice}",
                )
            merge_sales_session(
                conversation,
                step=STEP_IDLE,
                menu_sent=True,
                catalog_choice=None,
                catalog_pending_item_id=None,
                catalog_pending_quantity=None,
            )

            if choice in (1, 2):
                merge_sales_session(
                    conversation,
                    catalog_choice=choice,
                    menu_sent=True,
                    catalog_pending_item_id=None,
                    catalog_pending_quantity=None,
                    step=STEP_IDLE,
                )
                signal_agent_typing(
                account,
                conversation,
                settings=self.settings,
                instagram_api=self.instagram_api,
                duration_seconds=2.5,
            )
                self.catalog.send_catalog(account, conversation, choice)
                message.auto_replied = True
                self.db.commit()
                logger.info(
                    "DM menu catalogue sent conversation=%s participant=%s choice=%s",
                    conversation.id,
                    conversation.participant_username or conversation.participant_ig_id,
                    choice,
                )
                return True

            signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
            self._send_hold_reply(account, conversation, message)
            logger.info(
                "DM menu hold reply conversation=%s participant=%s choice=%s",
                conversation.id,
                conversation.participant_username or conversation.participant_ig_id,
                choice,
            )
            return True

        if self.orders.is_track_request(text):
            latest = self.orders.latest_order_for_conversation(conversation.id)
            if latest is not None:
                merge_sales_session(
                    conversation,
                    order_id=latest.id,
                    step=STEP_TRACKING if latest.status not in TERMINAL_STATUSES else STEP_IDLE,
                )
                self._send_order_status_reply(
                    account,
                    conversation,
                    message,
                    latest,
                    include_timeline=True,
                )
                return True
            signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
            self._send_outbound(account, conversation, self.orders.format_no_order_reply())
            self._send_outbound(
                account,
                conversation,
                format_root_menu(),
                quick_replies=self._root_menu_chips(account),
            )
            message.auto_replied = True
            self.db.commit()
            return True

        self._send_menu_reminder(account, conversation, message)
        logger.info(
            "DM menu reminder sent conversation=%s participant=%s text=%s",
            conversation.id,
            conversation.participant_username or conversation.participant_ig_id,
            text[:80],
        )
        return True

    def handle_postback(
        self,
        account: InstagramAccount,
        event: dict,
    ) -> bool:
        synthetic = synthetic_body_from_postback_event(event)
        if synthetic is None:
            return False

        ingested = ingest_postback_message(self.db, account, event, synthetic)
        if ingested is None:
            return False

        conversation, message = ingested
        self._bootstrap_greeting_for_menu_choice(account, conversation, message)
        return self.process_inbound(account, conversation, message, from_chip=True)

    def _root_menu_chips(self, account: InstagramAccount) -> list[dict[str, str]] | None:
        if not dm_offer_quick_replies(self.settings, account, db=self.db):
            return None
        return greeting_quick_replies()

    def _outbound_chips(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
    ) -> list[dict[str, str]] | None:
        return outbound_quick_replies(
            self.settings,
            account,
            conversation,
            catalog=self.catalog,
            db=self.db,
        )

    def send_chips_only_reminder(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> None:
        merchant_id = str(account.account_id or "").strip()
        product_titles: list[tuple[str, str]] | None = None
        session = read_session(conversation.sales_session)
        if session.get("catalog_choice") in (1, 2) and merchant_id:
            items = self.catalog._load_items(merchant_id)  # noqa: SLF001
            product_titles = [
                (item.id, (item.product.name if item.product else "Product") or "Product")
                for item in items
                if item.product is not None
            ]

        signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
        self._send_outbound(
            account,
            conversation,
            CHIPS_ONLY_REMINDER,
            quick_replies=quick_replies_for_conversation(
                conversation,
                product_titles=product_titles,
            ),
        )
        message.auto_replied = True
        self.db.commit()

    def _conversation_for_participant(
        self,
        account: InstagramAccount,
        participant_id: str,
        timestamp: datetime,
    ) -> InstagramConversation:
        conversation = find_conversation_for_participant(account, participant_id)
        if conversation:
            conversation.last_message_at = timestamp
            conversation.updated_at = utc_now()
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

    def _upsert_inbound(
        self,
        conversation: InstagramConversation,
        mid: str,
        sender_id: str,
        body: str,
        timestamp: datetime,
    ) -> InstagramMessage:
        existing = find_duplicate_message(
            conversation,
            mid=mid,
            body=body,
            sent_at=timestamp,
            direction="inbound",
        )
        if existing is not None:
            return existing

        message = InstagramMessage(
            instagram_conversation_id=conversation.id,
            instagram_message_id=mid,
            direction="inbound",
            sender_ig_id=sender_id,
            body=body,
            sent_at=timestamp,
            auto_replied=False,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        self.db.add(message)
        self.db.flush()
        conversation.messages.append(message)
        self.db.commit()
        return message

    def _send_menu_reminder(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> None:
        reminder = format_menu_reminder(conversation, message)
        signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
        self._send_outbound(
            account,
            conversation,
            reminder,
            quick_replies=self._root_menu_chips(account),
        )
        message.auto_replied = True
        self.db.commit()

    def _send_hold_reply(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> None:
        signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
        self._send_outbound(account, conversation, DEFAULT_HOLD_REPLY)
        message.auto_replied = True
        self.db.commit()

    @staticmethod
    def _clear_catalog_context(conversation: InstagramConversation) -> None:
        clear_sales_session_keys(
            conversation,
            "catalog_choice",
            "catalog_pending_item_id",
            "catalog_pending_quantity",
            "step",
        )

    def _send_catalog_follow_up(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> None:
        text = (message.body or "").strip()
        product_item_id = parse_product_select_payload(text)
        if product_item_id:
            text = product_item_id
        quantity_from_chip = parse_quantity_payload(text)
        if quantity_from_chip is not None:
            text = str(quantity_from_chip)
        if is_live_agent_request(text) or menu_choice_from_text(text) == 3:
            ticket = self.support_tickets.get_current_ticket(conversation)
            self._handle_live_agent(account, conversation, message, ticket)
            return

        session = read_session(conversation.sales_session)

        if self.orders.order_for_session(conversation.id, session) is not None:
            message.auto_replied = True
            self.db.commit()
            return

        pending_item_id = session.get("catalog_pending_item_id")
        if pending_item_id and session.get("step") == STEP_AWAITING_QUANTITY:
            self._handle_quantity_response(
                account,
                conversation,
                message,
                text,
                str(pending_item_id),
            )
            return

        if pending_item_id and session.get("step") == STEP_AWAITING_ORDER_CONFIRM:
            self._handle_order_confirm_response(
                account,
                conversation,
                message,
                text,
                str(pending_item_id),
            )
            return

        item = self.catalog.item_by_id(text, str(account.account_id or "").strip())
        if item is None:
            item = self.catalog.match_product(account, text)
        if item is None:
            menu_repeat = menu_choice_from_text(text)
            session = read_session(conversation.sales_session)
            choice = int(session.get("catalog_choice") or menu_repeat or 1)
            signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
            self.catalog.send_catalog(account, conversation, choice)
            message.auto_replied = True
            self.db.commit()
            return

        product_name = (item.product.name if item.product else "this item").strip()
        price = int(round(float(item.selling_price or 0)))
        unit = (item.product.unit if item.product else None) or None
        merge_sales_session(
            conversation,
            catalog_pending_item_id=item.id,
            catalog_pending_quantity=None,
            step=STEP_AWAITING_QUANTITY,
        )

        signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
        qty_replies = quantity_quick_replies() if dm_offer_quick_replies(self.settings, account, db=self.db) else None
        self._send_outbound(
            account,
            conversation,
            format_quantity_prompt(product_name, price, unit=unit),
            quick_replies=qty_replies,
        )
        message.auto_replied = True
        self.db.commit()
        logger.info(
            "DM catalog product selected conversation=%s item=%s product=%s",
            conversation.id,
            item.id,
            product_name,
        )

    def _handle_quantity_response(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        text: str,
        pending_item_id: str,
    ) -> None:
        merchant_id = str(account.account_id or "").strip()
        item = self.catalog.item_by_id(pending_item_id, merchant_id)
        if item is None or not item.is_active:
            self._return_to_catalog(
                account,
                conversation,
                message,
                "We are sorry — that item is no longer available. Please choose another product.",
            )
            return

        quantity = parse_quantity(text)
        if quantity is None:
            signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
            retry_replies = quantity_quick_replies() if dm_offer_quick_replies(self.settings, account, db=self.db) else None
            self._send_outbound(
                account,
                conversation,
                format_quantity_retry_message(),
                quick_replies=retry_replies,
            )
            message.auto_replied = True
            self.db.commit()
            return

        max_available = item.stock_quantity if item.stock_quantity is not None else None
        if max_available is not None and quantity > max_available:
            signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
            retry_replies = quantity_quick_replies() if dm_offer_quick_replies(self.settings, account, db=self.db) else None
            self._send_outbound(
                account,
                conversation,
                format_quantity_retry_message(max_available=max_available),
                quick_replies=retry_replies,
            )
            message.auto_replied = True
            self.db.commit()
            return

        quantity = clamp_quantity(quantity, max_quantity=max_available)
        product_name = (item.product.name if item.product else "this item").strip()
        price = int(round(float(item.selling_price or 0)))
        merge_sales_session(
            conversation,
            catalog_pending_quantity=quantity,
            step=STEP_AWAITING_ORDER_CONFIRM,
        )

        signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
        confirm_chips = (
            order_confirm_quick_replies_with_menu_back()
            if dm_offer_quick_replies(self.settings, account, db=self.db)
            else order_confirm_quick_replies()
        )
        self._send_outbound(
            account,
            conversation,
            format_order_confirm_prompt(product_name, price, quantity),
            quick_replies=confirm_chips,
        )
        message.auto_replied = True
        self.db.commit()
        logger.info(
            "DM catalog quantity set conversation=%s item=%s quantity=%s",
            conversation.id,
            pending_item_id,
            quantity,
        )

    def _handle_completion_confirm_response(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        text: str,
        session: dict,
    ) -> bool:
        completion_order = self.orders.order_awaiting_completion_confirm(
            conversation.id,
            session,
        )
        if completion_order is None:
            return False

        from app.support.order_status import CONFIRMATION_STATUSES

        raw = (text or "").strip().lower()
        explicit = raw in {"delivery_yes", "delivery_no", "yes, received", "no, issue"}
        in_confirm_flow = (
            session.get("step") == STEP_AWAITING_COMPLETION_CONFIRM
            or str(completion_order.status) in CONFIRMATION_STATUSES
        )
        if not in_confirm_flow and not explicit:
            return False
        if not (is_completion_confirm_yes(text) or is_completion_confirm_no(text)):
            if not in_confirm_flow:
                return False

        completion = OrderCompletionService(self.db)
        try:
            if is_completion_confirm_yes(text):
                completion.customer_confirm_receipt(completion_order)
                self.db.refresh(completion_order)
                if completion_order.status in TERMINAL_STATUSES:
                    merge_sales_session(conversation, step=STEP_IDLE, order_id=None)
                    reply = (
                        f"Thank you for confirming order {completion_order.order_number}. "
                        "Your order is now complete."
                    )
                else:
                    reply = (
                        f"Thanks for confirming order {completion_order.order_number}. "
                        "We are waiting for the shop to confirm — we will message you once it is fully closed."
                    )
            elif is_completion_confirm_no(text):
                completion.customer_dispute_receipt(
                    completion_order,
                    conversation=conversation,
                )
                reply = (
                    "We are sorry to hear that. Our team has been notified and will follow up with you shortly."
                )
            else:
                confirm_chips = (
                    completion_confirm_quick_replies_with_menu_back()
                    if dm_offer_quick_replies(self.settings, account, db=self.db)
                    else None
                )
                if confirm_chips is None:
                    from app.services.order_dm_templates import completion_confirm_quick_replies

                    confirm_chips = completion_confirm_quick_replies()

                signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
                self._send_outbound(
                    account,
                    conversation,
                    "Please reply **Yes** if you received your order, or **No** if something is wrong.",
                    quick_replies=confirm_chips,
                )
                message.auto_replied = True
                self.db.commit()
                return True
        except Exception as exc:
            logger.warning(
                "Completion confirm failed conversation=%s order=%s: %s",
                conversation.id,
                completion_order.id,
                exc,
            )
            reply = "We could not update your order right now. Please try again or contact the shop."

        signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
        self._send_outbound(account, conversation, reply)
        message.auto_replied = True
        self.db.commit()
        return True

    def _handle_order_confirm_response(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        text: str,
        pending_item_id: str,
    ) -> None:
        if is_order_confirm_no(text):
            self._return_to_catalog(
                account,
                conversation,
                message,
                format_order_declined_message(),
            )
            return

        if is_order_confirm_yes(text):
            self._place_catalog_order(account, conversation, message, pending_item_id)
            return

        signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
        confirm_chips = (
            order_confirm_quick_replies_with_menu_back()
            if dm_offer_quick_replies(self.settings, account, db=self.db)
            else order_confirm_quick_replies()
        )
        self._send_outbound(
            account,
            conversation,
            "Please tap **Yes** or **No** to proceed.",
            quick_replies=confirm_chips,
        )
        message.auto_replied = True
        self.db.commit()

    def _place_catalog_order(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        inventory_item_id: str,
    ) -> None:
        merchant_id = str(account.account_id or "").strip()
        item = self.catalog.item_by_id(inventory_item_id, merchant_id)
        if item is None or not item.is_active:
            self._return_to_catalog(
                account,
                conversation,
                message,
                "We are sorry — that item is no longer available. Please choose another product.",
            )
            return

        product_name = (item.product.name if item.product else "Product").strip()
        session = read_session(conversation.sales_session)
        max_available = item.stock_quantity if item.stock_quantity is not None else None
        quantity = clamp_quantity(
            int(session.get("catalog_pending_quantity") or 1),
            max_quantity=max_available,
        )
        try:
            order = build_instagram_order(
                self.db,
                account_id=merchant_id,
                conversation_id=conversation.id,
                line_items=[(item, quantity)],
                phone=None,
                note=f"Catalog selection via Instagram DM (qty {quantity})",
                customer_name=conversation.participant_username,
                source=account.platform or "instagram",
            )
            total = int(round(float(order.total or 0)))

            self.db.commit()
            self.db.refresh(order)

            self._clear_catalog_context(conversation)
            merge_sales_session(
                conversation,
                order_id=order.id,
                step=STEP_TRACKING,
                menu_sent=True,
            )
            message.auto_replied = True
            self.db.commit()

            notifier = OrderNotificationService(self.db, self.settings)
            try:
                notifier.notify_merchant_email(order, PLACED)
            except Exception:
                logger.exception(
                    "DM catalog merchant email failed conversation=%s order=%s",
                    conversation.id,
                    order.order_number,
                )
            self.orders.notify_customer_status(order, PLACED, force=True)

            ticket = self.support_tickets.get_current_ticket(conversation)
            if ticket is not None:
                self.support_tickets.log_event(
                    ticket,
                    "order_placed",
                    f"Order {order.order_number} placed for {quantity}× {product_name}",
                )

            logger.info(
                "DM catalog order placed conversation=%s order=%s item=%s",
                conversation.id,
                order.order_number,
                inventory_item_id,
            )
        except InsufficientStockError as exc:
            logger.info(
                "DM catalog order blocked by stock conversation=%s item=%s",
                conversation.id,
                inventory_item_id,
            )
            self._return_to_catalog(
                account,
                conversation,
                message,
                (
                    f"Sorry — we only have {exc.available} of {exc.product_name} left in stock. "
                    "Please choose a smaller quantity or another product."
                ),
            )
        except StorePausedError:
            self._return_to_root_menu(
                account,
                conversation,
                message,
                "This shop is temporarily not accepting orders. Please try again shortly.",
            )
        except Exception:
            logger.exception(
                "DM catalog order failed conversation=%s item=%s",
                conversation.id,
                inventory_item_id,
            )
            self._return_to_root_menu(
                account,
                conversation,
                message,
                "We could not place your order at this time. Please try again or contact us directly.",
            )

    def _send_order_status_reply(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        order,
        *,
        include_timeline: bool = True,
        brief: bool = False,
    ) -> None:
        body = (
            self.orders.format_brief_open_order_reply(order)
            if brief
            else self.orders.format_status_reply(order, include_timeline=include_timeline)
        )
        signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
        menu_chips = menu_back_quick_replies() if dm_offer_quick_replies(self.settings, account, db=self.db) else None
        self._send_outbound(account, conversation, body, quick_replies=menu_chips)
        from app.services.conversation_notify_service import ConversationNotifyService

        notify = ConversationNotifyService(
            self.db,
            self.settings,
            self.instagram_api,
        )
        if order.status == AWAITING_PAYMENT:
            notify.send_payment_card_for_order(order.id)
        elif should_send_tracking_card(order.status):
            notify.send_tracking_card_for_order(order.id)
        message.auto_replied = True
        self.db.commit()
        logger.info(
            "DM order status reply conversation=%s order=%s status=%s",
            conversation.id,
            order.order_number,
            order.status,
        )

    def _handle_live_agent(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        ticket,
    ) -> None:
        if ticket is not None:
            self.support_tickets.log_event(
                ticket,
                "live_agent_requested",
                "Customer requested a live agent",
            )
        self._clear_catalog_context(conversation)
        merge_sales_session(conversation, step=STEP_HANDOFF, menu_sent=True)
        from app.services.agent_reply_policy import disable_auto_replies_for_live_agent

        disable_auto_replies_for_live_agent(account)
        signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
        self._send_outbound(account, conversation, format_live_agent_reply())
        message.auto_replied = True
        self.db.commit()
        try:
            from app.services.merchant_notification_service import MerchantNotificationService

            MerchantNotificationService(self.db).notify_live_agent_handoff(
                account,
                conversation,
                message_id=message.id,
            )
        except Exception:
            logger.exception(
                "Live agent handoff notification failed conversation=%s",
                conversation.id,
            )

    def resume_autopilot_after_handoff(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        *,
        notify_customer: bool = True,
    ) -> bool:
        """Exit live-agent mode; optionally welcome the customer back to DukAI."""
        from app.services.agent_reply_policy import (
            auto_replies_handle_inbound,
            conversation_live_agent_handoff,
        )

        if not conversation_live_agent_handoff(conversation):
            return False

        self._clear_catalog_context(conversation)
        merge_sales_session(conversation, step=STEP_IDLE, menu_sent=True)

        ticket = self.support_tickets.get_current_ticket(conversation)
        if ticket is not None:
            self.support_tickets.log_event(
                ticket,
                "autopilot_resumed",
                "Customer returned to DukAI auto-replies",
            )

        should_notify = notify_customer and auto_replies_handle_inbound(self.db, account)
        if should_notify and conversation.participant_ig_id:
            signal_agent_typing(
            account,
            conversation,
            settings=self.settings,
            instagram_api=self.instagram_api,
            duration_seconds=2.0,
        )
            chips = self._root_menu_chips(account)
            self._send_outbound(
                account,
                conversation,
                format_dukai_resume_reply(conversation),
                quick_replies=chips,
            )
            logger.info(
                "DM autopilot resumed conversation=%s participant=%s",
                conversation.id,
                conversation.participant_username or conversation.participant_ig_id,
            )

        self.db.commit()
        return True

    def resume_all_handoff_conversations(self, account: InstagramAccount) -> int:
        conversations = (
            self.db.query(InstagramConversation)
            .filter(InstagramConversation.instagram_account_id == account.id)
            .all()
        )
        resumed = 0
        for conversation in conversations:
            if self.resume_autopilot_after_handoff(account, conversation):
                resumed += 1
        return resumed

    def _return_to_catalog(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        lead_text: str,
    ) -> None:
        session = read_session(conversation.sales_session)
        choice = session.get("catalog_choice")
        clear_sales_session_keys(
            conversation,
            "catalog_pending_item_id",
            "catalog_pending_quantity",
            "step",
        )
        merge_sales_session(conversation, step=STEP_IDLE, menu_sent=True)

        signal_agent_typing(
                account,
                conversation,
                settings=self.settings,
                instagram_api=self.instagram_api,
                duration_seconds=2.5,
            )
        self._send_outbound(account, conversation, lead_text)
        if choice in (1, 2):
            self.catalog.send_catalog(account, conversation, int(choice))
        else:
            self._send_outbound(
                account,
                conversation,
                format_root_menu(),
                quick_replies=self._root_menu_chips(account),
            )
        message.auto_replied = True
        self.db.commit()

    def _return_to_root_menu(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
        lead_text: str,
    ) -> None:
        self._clear_catalog_context(conversation)
        merge_sales_session(conversation, step=STEP_IDLE, menu_sent=True)

        signal_agent_typing(
                account,
                conversation,
                settings=self.settings,
                instagram_api=self.instagram_api,
                duration_seconds=2.5,
            )
        self._send_outbound(account, conversation, lead_text)
        self._send_outbound(
            account,
            conversation,
            format_root_menu(),
            quick_replies=self._root_menu_chips(account),
        )
        message.auto_replied = True
        self.db.commit()

    def _send_outbound(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        text: str,
        *,
        quick_replies: list[dict[str, str]] | None = None,
    ) -> None:
        from app.services.messaging_service import InstagramOutboundService

        recipient_id = str(conversation.participant_ig_id or "")
        if not recipient_id:
            return

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

    def _bootstrap_greeting_for_menu_choice(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> None:
        """Open the DM ticket and send the greeting when a menu chip arrives first."""
        if self.dm_tickets is None:
            return
        if conversation.is_ticket_open() and self._greeting_was_sent(conversation):
            return
        if menu_choice_from_text((message.body or "").strip()) not in (1, 2, 3):
            return
        if self.dm_tickets.process_inbound(account, conversation, message):
            message.auto_replied = False
            self.db.commit()

    @staticmethod
    def _greeting_was_sent(conversation: InstagramConversation) -> bool:
        return greeting_was_sent(conversation)
