"""Dual-confirmation flow before an order is marked delivered or picked up."""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy.orm import Session

from app.models import InstagramAccount, InstagramConversation, Order, OrderStatusHistory
from app.support.datetime_utils import utc_now
from app.support.order_status import (
    AWAITING_DELIVERY_CONFIRMATION,
    AWAITING_PICKUP_CONFIRMATION,
    CONFIRMATION_STATUSES,
    FULFILLMENT_DELIVERY,
    OUT_FOR_DELIVERY,
    READY,
    TERMINAL_STATUSES,
    awaiting_confirmation_status,
    completion_status,
)

logger = logging.getLogger(__name__)

COMPLETION_REMINDER_HOURS = 48
COMPLETION_AUTO_CLOSE_HOURS = 72


class OrderCompletionError(ValueError):
    """Business rule violation for completion confirmation."""


class OrderCompletionService:
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def merchant_eligible_statuses(order: Order) -> frozenset[str]:
        if order.fulfillment_type == FULFILLMENT_DELIVERY:
            return frozenset({OUT_FOR_DELIVERY, AWAITING_DELIVERY_CONFIRMATION})
        return frozenset({READY, AWAITING_PICKUP_CONFIRMATION})

    @staticmethod
    def customer_eligible_statuses(order: Order) -> frozenset[str]:
        if order.fulfillment_type == FULFILLMENT_DELIVERY:
            return frozenset({OUT_FOR_DELIVERY, AWAITING_DELIVERY_CONFIRMATION})
        return frozenset({READY, AWAITING_PICKUP_CONFIRMATION})

    @staticmethod
    def is_awaiting_confirmation(order: Order) -> bool:
        return str(order.status or "") in CONFIRMATION_STATUSES

    @staticmethod
    def needs_customer_confirmation(order: Order) -> bool:
        return bool(order.source_conversation_id) and not order.customer_delivery_confirmed_at

    @staticmethod
    def needs_merchant_confirmation(order: Order) -> bool:
        return not order.merchant_delivery_confirmed_at

    def merchant_confirm_handoff(
        self,
        order: Order,
        *,
        user_id: str | None = None,
    ) -> Order:
        if order.status in TERMINAL_STATUSES:
            raise OrderCompletionError("This order is already closed.")

        eligible = self.merchant_eligible_statuses(order)
        if order.status not in eligible:
            raise OrderCompletionError(
                "Order is not at a stage where the shop can confirm handoff.",
            )

        now = utc_now()
        if not order.merchant_delivery_confirmed_at:
            order.merchant_delivery_confirmed_at = now
            order.updated_at = now

        awaiting = awaiting_confirmation_status(order.fulfillment_type)
        if order.status != awaiting:
            self._transition(order, awaiting, changed_by_user_id=user_id, note="Shop confirmed handoff")

        self.db.flush()
        if self.try_finalize(order, user_id=user_id):
            self.db.commit()
            return order

        self._notify_completion_prompt(order)
        self.db.commit()
        return order

    def customer_confirm_receipt(self, order: Order) -> Order:
        if order.status in TERMINAL_STATUSES:
            raise OrderCompletionError("This order is already closed.")
        if order.delivery_disputed_at:
            raise OrderCompletionError(
                "This order has an open delivery dispute and cannot be confirmed.",
            )

        eligible = self.customer_eligible_statuses(order)
        if order.status not in eligible:
            raise OrderCompletionError(
                "Order is not waiting for customer confirmation.",
            )

        now = utc_now()
        if not order.customer_delivery_confirmed_at:
            order.customer_delivery_confirmed_at = now
            order.updated_at = now

        awaiting = awaiting_confirmation_status(order.fulfillment_type)
        if order.status != awaiting:
            self._transition(order, awaiting, note="Customer confirmed receipt")

        self.db.flush()
        if self.try_finalize(order):
            self.db.commit()
            return order

        self._notify_customer_waiting_for_shop(order)
        self.db.commit()
        return order

    def customer_dispute_receipt(
        self,
        order: Order,
        *,
        conversation: InstagramConversation | None = None,
    ) -> Order:
        if order.status in TERMINAL_STATUSES:
            raise OrderCompletionError("This order is already closed.")

        eligible = self.customer_eligible_statuses(order)
        if order.status not in eligible and order.status not in CONFIRMATION_STATUSES:
            raise OrderCompletionError(
                "Order is not waiting for customer confirmation.",
            )

        now = utc_now()
        order.delivery_disputed_at = now
        order.updated_at = now

        awaiting = awaiting_confirmation_status(order.fulfillment_type)
        if order.status != awaiting:
            self._transition(order, awaiting, note="Customer reported a delivery issue")

        self._open_dispute_ticket(order, conversation)
        self._notify_merchant_dispute(order)
        self.db.commit()
        return order

    def resend_completion_prompt(self, order: Order) -> bool:
        if not self.is_awaiting_confirmation(order):
            return False
        if not self.needs_customer_confirmation(order):
            return False
        self._notify_completion_prompt(order, force=True)
        order.completion_reminder_sent_at = None
        self.db.commit()
        return True

    def check_pending_finalization(self, order: Order, *, user_id: str | None = None) -> bool:
        """Auto-close when timeout elapsed or send reminder if still waiting."""
        if order.status in TERMINAL_STATUSES:
            return False
        if self.is_awaiting_confirmation(order):
            self.maybe_send_completion_reminder(order)
        if self._can_auto_close_without_customer(order) and order.merchant_delivery_confirmed_at:
            finalized = self.try_finalize(order, user_id=user_id)
            if finalized:
                self.db.commit()
            return finalized
        return False

    def maybe_send_completion_reminder(self, order: Order) -> bool:
        if not self.is_awaiting_confirmation(order):
            return False
        if order.completion_reminder_sent_at:
            return False
        if not self.needs_customer_confirmation(order):
            return False

        anchor = order.merchant_delivery_confirmed_at or order.updated_at
        if anchor is None:
            return False
        if utc_now() - anchor < timedelta(hours=COMPLETION_REMINDER_HOURS):
            return False

        from app.services.order_notification_service import OrderNotificationService

        ref = order.order_number
        body = (
            f"Reminder: please confirm you received order {ref}.\n"
            "Reply **Yes** if everything arrived, or **No** if something is wrong."
        )
        sent = OrderNotificationService(self.db).messenger.send_for_order(order.id, body)
        if sent:
            order.completion_reminder_sent_at = utc_now()
            order.updated_at = utc_now()
            self.db.commit()
        return sent

    def try_finalize(self, order: Order, *, user_id: str | None = None) -> bool:
        if order.status in TERMINAL_STATUSES:
            return False
        if not order.merchant_delivery_confirmed_at:
            return False
        if not self._customer_side_satisfied(order):
            return False

        terminal = completion_status(order.fulfillment_type)
        self._transition(
            order,
            terminal,
            changed_by_user_id=user_id,
            note="Both parties confirmed — order closed",
        )
        if not order.completed_at:
            order.completed_at = utc_now()
        order.updated_at = utc_now()

        from app.services.order_notification_service import notify_order_status_change

        notify_order_status_change(self.db, order.id, user_id=user_id)
        return True

    def _customer_side_satisfied(self, order: Order) -> bool:
        if order.customer_delivery_confirmed_at:
            return True
        if not order.source_conversation_id:
            return True
        return self._can_auto_close_without_customer(order)

    def _can_auto_close_without_customer(self, order: Order) -> bool:
        if order.customer_delivery_confirmed_at:
            return True
        if not order.merchant_delivery_confirmed_at:
            return False
        anchor = order.merchant_delivery_confirmed_at
        return utc_now() - anchor >= timedelta(hours=COMPLETION_AUTO_CLOSE_HOURS)

    def _transition(
        self,
        order: Order,
        target: str,
        *,
        changed_by_user_id: str | None = None,
        note: str | None = None,
    ) -> None:
        if order.status == target:
            return
        previous = order.status
        now = utc_now()
        order.status = target
        order.updated_at = now
        self.db.add(
            OrderStatusHistory(
                order_id=order.id,
                from_status=previous,
                to_status=target,
                changed_by_user_id=changed_by_user_id,
                note=note,
                created_at=now,
            ),
        )

    def _notify_completion_prompt(self, order: Order, *, force: bool = False) -> None:
        if not order.source_conversation_id:
            return
        if not self.needs_customer_confirmation(order):
            return

        from app.services.dm_chips_only import (
            completion_confirm_quick_replies_with_menu_back,
            dm_offer_quick_replies,
        )
        from app.services.order_dm_templates import (
            completion_confirm_quick_replies,
            format_completion_confirm_prompt,
        )
        from app.services.order_notification_service import OrderNotificationService
        from app.config import get_settings

        settings = get_settings()
        notify = OrderNotificationService(self.db, settings)
        body = format_completion_confirm_prompt(order)
        # Keep within last_customer_status_notified (VARCHAR 64); longest status is 28 chars.
        status_key = f"cmp:{order.status}"
        if force or order.last_customer_status_notified != status_key:
            conversation = (
                self.db.query(InstagramConversation)
                .filter(InstagramConversation.id == order.source_conversation_id)
                .first()
            )
            if conversation and conversation.account:
                account = conversation.account
                confirm_chips = (
                    completion_confirm_quick_replies_with_menu_back()
                    if dm_offer_quick_replies(settings, account, db=self.db)
                    else completion_confirm_quick_replies()
                )
                notify.messenger.send_to_conversation(
                    account,
                    conversation,
                    body,
                    quick_replies=confirm_chips,
                )
            else:
                notify.messenger.send_for_order(order.id, body)
            order.last_customer_status_notified = status_key

        from app.support.sales_session import STEP_AWAITING_COMPLETION_CONFIRM, merge_sales_session

        conversation = (
            self.db.query(InstagramConversation)
            .filter(InstagramConversation.id == order.source_conversation_id)
            .first()
        )
        if conversation:
            merge_sales_session(
                conversation,
                step=STEP_AWAITING_COMPLETION_CONFIRM,
                order_id=order.id,
            )

    def _notify_customer_waiting_for_shop(self, order: Order) -> None:
        if not order.source_conversation_id:
            return
        if order.merchant_delivery_confirmed_at:
            return

        from app.services.order_notification_service import OrderNotificationService

        ref = order.order_number
        body = (
            f"Thanks for confirming order {ref}.\n"
            "We are waiting for the shop to confirm handoff — we will message you once the order is fully closed."
        )
        OrderNotificationService(self.db).messenger.send_for_order(order.id, body)

    def _open_dispute_ticket(
        self,
        order: Order,
        conversation: InstagramConversation | None,
    ) -> None:
        if not order.source_conversation_id:
            return

        from app.services.support_ticket_service import SupportTicketService

        if conversation is None:
            conversation = (
                self.db.query(InstagramConversation)
                .filter(InstagramConversation.id == order.source_conversation_id)
                .first()
            )
        if conversation is None or not conversation.account:
            return

        account: InstagramAccount = conversation.account
        tickets = SupportTicketService(self.db)
        ticket = tickets.get_current_ticket(conversation)
        if ticket is None or not ticket.is_open():
            if not conversation.is_ticket_open():
                conversation.ticket_status = "open"
                conversation.ticket_opened_at = utc_now()
                conversation.ticket_closed_at = None
                conversation.updated_at = utc_now()
            ticket = tickets.open_ticket(account, conversation)

        ref = order.order_number or "order"
        tickets.log_event(
            ticket,
            "delivery_disputed",
            f"Customer reported an issue with order {ref}",
            metadata={"order_id": order.id, "order_number": order.order_number},
        )

    def _notify_merchant_dispute(self, order: Order) -> None:
        from app.services.order_notification_service import OrderNotificationService

        try:
            OrderNotificationService(self.db).notify_merchant_delivery_dispute(order)
        except Exception:
            logger.exception("Merchant dispute notification failed order_id=%s", order.id)
