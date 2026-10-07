from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

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
from app.services.openwa_service import OpenWaAgentService
from app.support.order_payments import order_uses_payment, payment_methods, payment_summary
from app.support.order_status import (
    AWAITING_DELIVERY_CONFIRMATION,
    AWAITING_PAYMENT,
    AWAITING_PICKUP_CONFIRMATION,
    BEING_PREPARED,
    CANCELLED,
    DELIVERED,
    OUT_FOR_DELIVERY,
    PAYMENT_CARD,
    PAYMENT_CASH,
    PAYMENT_CREDIT,
    PAYMENT_MPESA,
    PAYMENT_OTHER,
    PAYMENT_RECEIVED,
    PAYMENT_SPLIT,
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


NAIROBI = ZoneInfo("Africa/Nairobi")
UTC = ZoneInfo("UTC")

PAYMENT_METHOD_LABELS = {
    PAYMENT_MPESA: "M-PESA",
    PAYMENT_CASH: "Cash",
    PAYMENT_CARD: "Card",
    PAYMENT_CREDIT: "Credit",
    PAYMENT_OTHER: "Other",
}


def _format_money(amount: object, currency: str = "KES") -> str:
    return f"{currency} {float(amount or 0):,.2f}"


def _format_nairobi(value: datetime | None) -> str | None:
    if value is None:
        return None
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value
    return aware.astimezone(NAIROBI).strftime("%d %b %Y, %I:%M %p")


def _shop_name_for_order(order: Order, db: Session) -> str:
    account = order.account or db.query(Account).filter(Account.id == order.account_id).first()
    name = (account.business_name if account else None) or ""
    return name.strip() or "DukAI"


def _mpesa_receipt_for_order(order: Order) -> str | None:
    txn = getattr(order, "mpesa_transaction", None)
    code = str(getattr(txn, "mpesa_receipt_number", None) or "").strip()
    if code:
        return code
    for item in getattr(order, "mpesa_transactions", None) or []:
        code = str(getattr(item, "mpesa_receipt_number", None) or "").strip()
        if code:
            return code
    return None


def build_customer_receipt_whatsapp(
    order: Order,
    *,
    shop_name: str,
    receipt_pdf_url: str | None = None,
    credit_outstanding: float | None = None,
    pay_bill_url: str | None = None,
) -> str:
    """Plain-text till receipt for WhatsApp (openWA text-only)."""
    currency = order.currency or "KES"
    ref = order.order_number
    pay = order.payment_method or ""
    total = _format_money(order.total, currency)
    receipt = _mpesa_receipt_for_order(order)
    customer = (order.customer_name or "").strip()

    if pay == PAYMENT_CREDIT:
        headline = f"{total} on credit at {shop_name}."
        payment_line = "On credit."
    elif pay == PAYMENT_SPLIT:
        headline = f"{total} sale at {shop_name}."
        payment_line = f"Paid with {payment_summary(order, currency)}."
        if receipt:
            payment_line += f" M-PESA receipt {receipt}."
    elif pay == PAYMENT_MPESA:
        headline = f"{total} paid to {shop_name}."
        payment_line = (
            f"Paid via M-PESA. Receipt {receipt}."
            if receipt
            else "Paid via M-PESA."
        )
    else:
        headline = f"{total} paid to {shop_name}."
        payment_line = PAYMENT_METHOD_LABELS.get(
            pay,
            (pay or "Paid").replace("_", " ").title(),
        )
        if pay == PAYMENT_CASH:
            payment_line = "Paid in cash."

    lines: list[str] = [f"{ref} Confirmed.", headline]
    items = list(order.items or [])
    if len(items) == 1:
        name = (items[0].product_name or "Sale").strip() or "Sale"
        qty = int(items[0].quantity or 1)
        lines.append(f"{name}" if qty <= 1 else f"{qty} × {name}")
    elif items:
        for item in items:
            name = (item.product_name or "Item").strip() or "Item"
            qty = int(item.quantity or 1)
            amount = _format_money(item.line_total, currency)
            label = name if qty <= 1 else f"{qty} × {name}"
            lines.append(f"{label}: {amount}")
    if customer:
        lines.append(f"Customer {customer}.")
    lines.append(payment_line)
    if order_uses_payment(order, PAYMENT_CREDIT) and credit_outstanding is not None:
        lines.append(
            f"Your tab is now {_format_money(credit_outstanding, currency)}."
        )
    if pay_bill_url:
        lines.append(f"Pay your bill: {pay_bill_url}")
    if receipt_pdf_url:
        lines.append(f"Receipt PDF: {receipt_pdf_url}")
    lines.append("Thank you for shopping with us.")
    return "\n".join(line for line in lines if line)


def build_customer_receipt_email(
    order: Order,
    *,
    shop_name: str,
    settings: Settings | None = None,
) -> tuple[str, str, str]:
    """Return (subject, text, html) for a customer receipt email."""
    cfg = settings or get_settings()
    currency = order.currency or "KES"
    ref = order.order_number
    status = STATUS_LABELS.get(order.status, (order.status or "").replace("_", " ").title())
    pay_label = (
        payment_summary(order, currency)
        if order.payment_method == PAYMENT_SPLIT
        else PAYMENT_METHOD_LABELS.get(
            order.payment_method or "",
            (order.payment_method or "—").replace("_", " ").title(),
        )
    )
    when = _format_nairobi(order.paid_at or order.placed_at or order.created_at)
    receipt = _mpesa_receipt_for_order(order)
    customer = (order.customer_name or "").strip() or "Walk-in"
    total = _format_money(order.total, currency)
    tracking_url = OrderTrackingService.tracking_url(order.id, cfg)

    details: list[tuple[str, str]] = [
        ("Shop", shop_name),
        ("Order", ref),
        ("Status", status),
        ("Payment", pay_label),
    ]
    if when:
        details.append(("When", when))
    if receipt:
        details.append(("M-PESA receipt", receipt))
    details.append(("Customer", customer))
    if (order.customer_phone or "").strip():
        details.append(("Phone", order.customer_phone.strip()))

    line_items: list[tuple[str, str]] = []
    for item in order.items or []:
        name = (item.product_name or "Item").strip() or "Item"
        qty = int(item.quantity or 1)
        label = name if qty <= 1 else f"{qty} × {name}"
        line_items.append((label, _format_money(item.line_total, currency)))
    if not line_items:
        line_items.append(("Sale", total))
    if float(order.delivery_fee or 0):
        line_items.append(("Delivery", _format_money(order.delivery_fee, currency)))
    if float(order.discount or 0):
        line_items.append(("Discount", f"-{_format_money(order.discount, currency)}"))

    subject = f"Receipt from {shop_name} — {ref}"
    intro = (
        f"Thanks for shopping at {shop_name}. Here's your receipt for order {ref}."
    )
    text_lines = [
        intro,
        "",
        f"Shop: {shop_name}",
        f"Order: {ref}",
        f"Status: {status}",
        f"Payment: {pay_label}",
    ]
    if when:
        text_lines.append(f"When: {when}")
    if receipt:
        text_lines.append(f"M-PESA receipt: {receipt}")
    text_lines.append(f"Customer: {customer}")
    if (order.customer_phone or "").strip():
        text_lines.append(f"Phone: {order.customer_phone.strip()}")
    text_lines.append("")
    for label, amount in line_items:
        text_lines.append(f"{label}: {amount}")
    text_lines.extend(["", f"Total: {total}", "", "Asante — thank you for shopping with us."])
    if tracking_url:
        text_lines.extend(["", f"Track your order: {tracking_url}"])

    html = render_branded_email(
        title=subject,
        heading=f"Receipt · {ref}",
        intro=intro,
        details=details,
        line_items=line_items,
        total_label="Total",
        total_value=total,
        cta_label="Track order" if tracking_url else None,
        cta_url=tracking_url,
        footer_note=f"Sent by {shop_name} via DukAI.",
    )
    return subject, "\n".join(text_lines), html


# Statuses worth emailing the merchant about (avoid emailing on every step).
MERCHANT_EMAIL_STATUSES = frozenset({PLACED, PAYMENT_RECEIVED, CANCELLED})

# Customer WhatsApp via platform openWA — paid / completed, plus till cash/card placed.
CUSTOMER_WHATSAPP_STATUSES = frozenset({PAYMENT_RECEIVED, DELIVERED, PICKED_UP})
TILL_PAID_METHODS = frozenset({PAYMENT_CASH, PAYMENT_CARD})


def should_send_customer_whatsapp(order: Order, status: str) -> bool:
    if status in CUSTOMER_WHATSAPP_STATUSES:
        return True
    methods = payment_methods(order)
    return status == PLACED and bool(methods) and methods <= TILL_PAID_METHODS


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
        self.whatsapp = OpenWaAgentService(self.settings)

    def notify_customer_whatsapp(
        self,
        order: Order,
        new_status: str,
        *,
        receipt: str | None = None,
        force: bool = False,
    ) -> bool:
        """Best-effort WhatsApp to order.customer_phone. Never raises."""
        if not self.whatsapp.order_notify_enabled:
            return False
        if not should_send_customer_whatsapp(order, new_status):
            return False
        if not force and order.last_customer_whatsapp_notified == new_status:
            return False
        phone = (order.customer_phone or "").strip()
        if not phone:
            return False

        body = _message_for_status(
            order,
            new_status,
            receipt=receipt,
            settings=self.settings,
        )
        if not body:
            return False

        result = self.whatsapp.send_text(to=phone, text=body)
        if not result.ok:
            logger.info(
                "Customer WhatsApp not sent order_id=%s status=%s error=%s",
                order.id,
                new_status,
                result.error,
            )
            return False

        order.last_customer_whatsapp_notified = new_status
        self.db.commit()
        return True

    def notify_customer_receipt_email(
        self,
        order: Order,
        to_email: str,
    ) -> bool:
        """Send the customer a branded receipt. Never raises."""
        to = (to_email or "").strip()
        if not to:
            return False
        shop_name = _shop_name_for_order(order, self.db)
        subject, text, html = build_customer_receipt_email(
            order,
            shop_name=shop_name,
            settings=self.settings,
        )
        return self.email.send_email(
            to=to,
            to_name=(order.customer_name or "").strip() or None,
            subject=subject,
            text=text,
            html=html,
            category="customer-receipt",
        )

    def notify_customer_receipt_whatsapp(
        self,
        order: Order,
        phone: str,
        *,
        credit_outstanding: float | None = None,
        pay_bill_url: str | None = None,
        include_pdf: bool = True,
    ):
        """Send a till-style receipt via the platform openWA agent.

        Returns ``OpenWaSendResult``. Never raises.
        """
        from app.services.openwa_service import OpenWaSendResult
        from app.services.receipt_pdf_service import ensure_order_receipt_pdf_url

        to = (phone or "").strip()
        if not to:
            return OpenWaSendResult(ok=False, error="Enter the customer's WhatsApp number.")
        if not self.whatsapp.configured:
            return OpenWaSendResult(
                ok=False,
                error="WhatsApp agent is not configured. Set OPENWA_AGENT_TOKEN.",
            )
        shop_name = _shop_name_for_order(order, self.db)
        pdf_url = None
        if include_pdf:
            pdf_url = ensure_order_receipt_pdf_url(
                self.db,
                order,
                shop_name=shop_name,
                settings=self.settings,
            )

        resolved_pay_bill = pay_bill_url
        resolved_outstanding = credit_outstanding
        if order_uses_payment(order, PAYMENT_CREDIT):
            from app.services.credit_pay_service import CreditPayService
            from app.services.customer_service import CustomerService

            if resolved_pay_bill is None or resolved_outstanding is None:
                try:
                    customer = CustomerService(self.db).find_by_phone(
                        str(order.account_id),
                        order.customer_phone or "",
                    )
                except Exception:
                    customer = None
                if customer is not None:
                    if resolved_outstanding is None:
                        resolved_outstanding = float(customer.outstanding_balance or 0)
                    if resolved_pay_bill is None:
                        resolved_pay_bill = CreditPayService.pay_bill_url(
                            customer.id,
                            self.settings,
                        )

        body = build_customer_receipt_whatsapp(
            order,
            shop_name=shop_name,
            receipt_pdf_url=pdf_url,
            credit_outstanding=resolved_outstanding,
            pay_bill_url=resolved_pay_bill,
        )
        return self.whatsapp.send_text(to=to, text=body)

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

        try:
            self.notify_customer_whatsapp(
                order,
                new_status,
                receipt=receipt,
                force=force,
            )
        except Exception:
            logger.exception("Customer WhatsApp notification failed order_id=%s", order.id)

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
