from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.models import Account, Order, User, UserMembership
from app.services.conversation_notify_service import ConversationNotifyService
from app.services.support_ticket_service import SupportTicketService
from app.services.email_service import EmailService
from app.services.email_templates import render_branded_email
from app.services.instagram_api import InstagramApiService
from app.services.order_dm_templates import format_order_ref
from app.services.order_tracking_service import OrderTrackingService
from app.support.order_status import (
    AWAITING_DELIVERY_CONFIRMATION,
    AWAITING_PAYMENT,
    AWAITING_PICKUP_CONFIRMATION,
    BEING_PREPARED,
    CANCELLED,
    DELIVERED,
    OUT_FOR_DELIVERY,
    PAYMENT_RECEIVED,
    PICKED_UP,
    PLACED,
    READY,
    STATUS_LABELS,
)

logger = logging.getLogger(__name__)

NOTIFY_STATUSES = frozenset(
    {
        PLACED,
        AWAITING_PAYMENT,
        PAYMENT_RECEIVED,
        BEING_PREPARED,
        READY,
        OUT_FOR_DELIVERY,
        AWAITING_DELIVERY_CONFIRMATION,
        AWAITING_PICKUP_CONFIRMATION,
        DELIVERED,
        PICKED_UP,
        CANCELLED,
    },
)

TRACKING_CARD_STATUSES = frozenset(
    {
        PLACED,
        AWAITING_PAYMENT,
        PAYMENT_RECEIVED,
        BEING_PREPARED,
        READY,
        OUT_FOR_DELIVERY,
    },
)


def should_send_tracking_card(status: str) -> bool:
    return status in TRACKING_CARD_STATUSES


def _payment_link_for_order(order: Order, settings: Settings) -> str | None:
    from app.services.order_payment_service import OrderPaymentService

    return OrderPaymentService.payment_url(order.id, settings)


def _latest_cancel_reason(order: Order) -> str | None:
    history = list(getattr(order, "status_history", None) or [])
    for entry in reversed(history):
        if str(getattr(entry, "to_status", "") or "") != CANCELLED:
            continue
        note = str(getattr(entry, "note", "") or "").strip()
        if note:
            return note
    return None


def _message_for_status(
    order: Order,
    status: str,
    *,
    receipt: str | None = None,
    settings: Settings | None = None,
) -> str | None:
    label = STATUS_LABELS.get(status, status.replace("_", " ").title())
    ref = format_order_ref(order.order_number)
    cfg = settings or get_settings()
    pay_link = _payment_link_for_order(order, cfg)

    if status == PLACED:
        total = int(round(float(order.total or 0)))
        return (
            f"Order {ref} has been placed.\n"
            f"Total: KES {total:,}.\n\n"
            "Here is your link to track your order."
        )
    if status == AWAITING_PAYMENT:
        if pay_link:
            return (
                f"Order {ref} is ready for payment.\n\n"
                "Tap Pay now below, enter your name and M-PESA number, "
                "then approve the prompt on your phone. "
                "We only start preparing after payment is confirmed."
            )
        return (
            f"Order {ref}: payment request sent to your phone.\n"
            "Please enter your M-PESA PIN to pay. We start processing only after payment is confirmed."
        )
    if status == PAYMENT_RECEIVED:
        receipt_line = f"\nM-PESA receipt: {receipt}." if receipt else ""
        return (
            f"Payment confirmed for order {ref}!{receipt_line}\n"
            "Thank you — we are now preparing your order and will update you at each step."
        )
    if status == BEING_PREPARED:
        return f"Order {ref} update: your order is now being prepared."
    if status == READY:
        if order.fulfillment_type == "pickup":
            return (
                f"Order {ref} is ready for pickup!\n"
                "Please collect it at your earliest convenience."
            )
        return f"Order {ref} is packed and ready — we will dispatch it shortly."
    if status == OUT_FOR_DELIVERY:
        rider_name = None
        assigned_id = getattr(order, "assigned_rider_id", None)
        if assigned_id:
            from app.services.rider_service import rider_first_name

            assigned = getattr(order, "assigned_rider", None)
            if assigned is not None:
                rider_name = rider_first_name(assigned.name)
        if rider_name:
            return f"Order {ref} is on the way! {rider_name} is heading to you now."
        return f"Order {ref} is on the way! Our rider is heading to you now."
    if status == AWAITING_DELIVERY_CONFIRMATION:
        return (
            f"Order {ref} is awaiting delivery confirmation.\n"
            "Please confirm you received your order, or let us know if something is wrong."
        )
    if status == AWAITING_PICKUP_CONFIRMATION:
        return (
            f"Order {ref} is awaiting pickup confirmation.\n"
            "Please confirm you picked up your order, or let us know if you still need help."
        )
    if status == DELIVERED:
        return (
            f"Order {ref} has been delivered. Thank you for shopping with us!\n"
            "We hope to serve you again soon."
        )
    if status == PICKED_UP:
        return (
            f"Order {ref} has been picked up. Thank you for shopping with us!\n"
            "We hope to serve you again soon."
        )
    if status == CANCELLED:
        reason = _latest_cancel_reason(order)
        if reason:
            return (
                f"Order {ref} has been cancelled.\n"
                f"Reason: {reason}\n"
                "Reply here if you need help."
            )
        return f"Order {ref} has been cancelled. Reply here if you need help."
    return f"Order {ref} update: {label}."


# Statuses worth emailing the merchant about (avoid emailing on every step).
MERCHANT_EMAIL_STATUSES = frozenset({PLACED, PAYMENT_RECEIVED, CANCELLED})


class OrderNotificationService:
    def __init__(self, db: Session, settings: Settings | None = None):
        self.db = db
        self.settings = settings or get_settings()
        self.messenger = ConversationNotifyService(
            db,
            self.settings,
            InstagramApiService(self.settings),
        )
        self.email = EmailService(self.settings)

    def notify_status_change(
        self,
        order: Order,
        new_status: str,
        *,
        receipt: str | None = None,
        force: bool = False,
    ) -> bool:
        if new_status not in NOTIFY_STATUSES:
            return False
        if not order.source_conversation_id:
            return False
        if not force and order.last_customer_status_notified == new_status:
            return False

        body = _message_for_status(
            order,
            new_status,
            receipt=receipt,
            settings=self.settings,
        )
        if not body:
            return False

        sent = self.messenger.send_for_order(order.id, body)
        if sent:
            if new_status == AWAITING_PAYMENT:
                if _payment_link_for_order(order, self.settings):
                    self.messenger.send_payment_card_for_order(order.id)
            elif should_send_tracking_card(new_status) and OrderTrackingService.tracking_url(
                order.id,
                self.settings,
            ):
                self.messenger.send_tracking_card_for_order(order.id)
            order.last_customer_status_notified = new_status
            self.db.commit()

        # Best-effort merchant email alert (never blocks the customer DM path).
        if self.settings.mail_enabled and new_status in MERCHANT_EMAIL_STATUSES:
            try:
                self.notify_merchant_email(order, new_status, receipt=receipt)
            except Exception:
                logger.exception("Merchant email notification failed order_id=%s", order.id)

        try:
            from app.services.merchant_notification_service import MerchantNotificationService

            MerchantNotificationService(self.db).notify_order_status(
                order,
                new_status,
                receipt=receipt,
            )
        except Exception:
            logger.exception("Merchant dashboard notification failed order_id=%s", order.id)

        return sent

    def _merchant_email(self, order: Order) -> str | None:
        """Find the best email address for the order's merchant account."""
        account = order.account or (
            self.db.query(Account).filter(Account.id == order.account_id).first()
        )
        if not account:
            return None
        users = (
            self.db.query(User)
            .join(UserMembership, UserMembership.user_id == User.id)
            .filter(
                UserMembership.account_id == account.id,
                UserMembership.is_active.is_(True),
                User.email.isnot(None),
            )
            .all()
        )
        if not users:
            return None
        # Prefer the system admin, otherwise the first user with an email.
        for user in users:
            if (user.user_role or "") == "system_admin":
                return user.email
        return users[0].email

    def notify_merchant_email(
        self,
        order: Order,
        new_status: str,
        *,
        receipt: str | None = None,
    ) -> bool:
        to = self._merchant_email(order)
        if not to:
            logger.info("No merchant email on file for order_id=%s", order.id)
            return False

        label = STATUS_LABELS.get(new_status, new_status.replace("_", " ").title())
        ref = order.order_number
        total = int(round(float(order.total or 0)))
        currency = order.currency or "KES"
        customer = order.customer_name or order.customer_phone or "a customer"
        receipt_line = f"\nM-PESA receipt: {receipt}" if receipt else ""

        subject = f"Order {ref}: {label}"
        text = (
            f"Order {ref} is now '{label}'.\n\n"
            f"Customer: {customer}\n"
            f"Total: {currency} {total}{receipt_line}\n"
        )
        details = [
            ("Order", ref),
            ("Status", label),
            ("Customer", customer),
            ("Total", f"{currency} {total:,}"),
        ]
        if receipt:
            details.append(("M-PESA receipt", receipt))
        html = render_branded_email(
            title=subject,
            heading=f"Order {ref} is now {label.lower()}",
            intro="Here's the latest update on this order.",
            details=details,
            footer_note="You're receiving this because you're an admin on this DukAI shop.",
        )
        return self.email.send_email(
            to=to,
            subject=subject,
            text=text,
            html=html,
            category="order-notification",
        )

    def notify_merchant_delivery_dispute(self, order: Order) -> bool:
        to = self._merchant_email(order)
        sent = False
        if to:
            sent = self._send_merchant_delivery_dispute_email(order, to)
        try:
            from app.services.merchant_notification_service import MerchantNotificationService

            MerchantNotificationService(self.db).notify_delivery_dispute(order)
        except Exception:
            logger.exception("Merchant dashboard dispute notification failed order_id=%s", order.id)
        return sent

    def _send_merchant_delivery_dispute_email(self, order: Order, to: str) -> bool:
        ref = order.order_number
        customer = order.customer_name or order.customer_phone or "Customer"
        subject = f"Delivery issue reported — order {ref}"
        text = (
            f"{customer} reported a problem with order {ref}.\n\n"
            "The order is held open until you resolve the issue in the dashboard."
        )
        html = render_branded_email(
            title=subject,
            heading=f"Issue reported on order {ref}",
            intro="A customer said they did not receive their order as expected.",
            details=[
                ("Order", ref),
                ("Customer", customer),
                ("Status", STATUS_LABELS.get(order.status, order.status)),
            ],
            footer_note="Review the order in your DukAI dashboard and follow up in Instagram DMs.",
        )
        return self.email.send_email(
            to=to,
            subject=subject,
            text=text,
            html=html,
            category="order-dispute",
        )


def notify_order_status_change(
    db: Session,
    order_id: str,
    *,
    receipt: str | None = None,
    force: bool = False,
    user_id: str | None = None,
) -> None:
    """Fire-and-forget helper for hooks (M-PESA callback, order transitions)."""
    from sqlalchemy.orm import selectinload

    order = (
        db.query(Order)
        .options(
            selectinload(Order.assigned_rider),
            selectinload(Order.status_history),
        )
        .filter(Order.id == order_id)
        .first()
    )
    if not order:
        return

    if order.status in {DELIVERED, PICKED_UP}:
        try:
            if SupportTicketService(db).try_resolve_for_order_completion(
                order,
                user_id=user_id,
            ):
                db.commit()
        except Exception:
            logger.exception(
                "Support ticket auto-resolve failed order_id=%s",
                order_id,
            )

    try:
        OrderNotificationService(db).notify_status_change(
            order,
            order.status,
            receipt=receipt,
            force=force,
        )
    except Exception:
        logger.exception("Order customer notification failed order_id=%s", order_id)

    # Dashboard alerts for orders without Instagram DM source (e.g. POS).
    if not order.source_conversation_id:
        try:
            from app.services.merchant_notification_service import MerchantNotificationService

            MerchantNotificationService(db).notify_order_status(
                order,
                order.status,
                receipt=receipt,
            )
        except Exception:
            logger.exception("Merchant dashboard notification failed order_id=%s", order_id)
