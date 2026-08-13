"""In-app notifications for merchant dashboard users."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import (
    InstagramAccount,
    InstagramConversation,
    InstagramMessage,
    MerchantNotification,
    Order,
    SupportTicket,
)
from app.services.agent_reply_policy import merchant_unread_count
from app.services.order_dm_templates import format_order_ref
from app.support.order_status import STATUS_LABELS

logger = logging.getLogger(__name__)

NOTIFICATION_KINDS = frozenset({"order", "message", "ticket", "process"})

DASHBOARD_ORDER_STATUSES = frozenset(
    {
        "placed",
        "awaiting_payment",
        "payment_received",
        "being_prepared",
        "ready",
        "out_for_delivery",
        "awaiting_delivery_confirmation",
        "awaiting_pickup_confirmation",
        "cancelled",
    },
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _message_timestamp(message: InstagramMessage) -> datetime:
    return message.sent_at or message.created_at or _utc_now()


def _inbound_unread_count(conversation: InstagramConversation, account_ig_id: str) -> int:
    last_read = conversation.last_read_at
    count = 0
    for message in conversation.messages:
        if message.direction != "inbound":
            continue
        if account_ig_id and str(message.sender_ig_id or "") == account_ig_id:
            continue
        sent_at = _message_timestamp(message)
        if last_read is None or sent_at > last_read:
            count += 1
    return count


class MerchantNotificationService:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        *,
        account_id: str,
        kind: str,
        title: str,
        body: str | None = None,
        entity_type: str | None = None,
        entity_id: str | None = None,
        dedupe_key: str | None = None,
    ) -> MerchantNotification | None:
        if kind not in NOTIFICATION_KINDS:
            logger.warning("Unknown merchant notification kind=%s", kind)
            return None

        if dedupe_key:
            existing = (
                self.db.query(MerchantNotification)
                .filter(
                    MerchantNotification.account_id == str(account_id),
                    MerchantNotification.dedupe_key == dedupe_key,
                )
                .first()
            )
            if existing:
                return existing

        row = MerchantNotification(
            account_id=str(account_id),
            kind=kind,
            title=title[:255],
            body=(body[:500] if body else None),
            entity_type=entity_type,
            entity_id=entity_id,
            dedupe_key=dedupe_key,
            created_at=_utc_now(),
        )
        self.db.add(row)
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
            logger.exception(
                "Failed to create merchant notification account_id=%s kind=%s",
                account_id,
                kind,
            )
            return None
        return row

    def list_unread(
        self,
        account_id: str,
        *,
        since: datetime | None = None,
        limit: int = 20,
    ) -> list[MerchantNotification]:
        query = self.db.query(MerchantNotification).filter(
            MerchantNotification.account_id == str(account_id),
            MerchantNotification.read_at.is_(None),
        )
        if since is not None:
            query = query.filter(MerchantNotification.created_at > since)
        return (
            query.order_by(MerchantNotification.created_at.asc())
            .limit(max(1, min(limit, 50)))
            .all()
        )

    def mark_read(self, account_id: str, notification_ids: list[str]) -> int:
        if not notification_ids:
            return 0
        now = _utc_now()
        updated = (
            self.db.query(MerchantNotification)
            .filter(
                MerchantNotification.account_id == str(account_id),
                MerchantNotification.id.in_(notification_ids),
                MerchantNotification.read_at.is_(None),
            )
            .update({"read_at": now}, synchronize_session=False)
        )
        self.db.commit()
        return int(updated or 0)

    def mark_all_read(self, account_id: str) -> int:
        now = _utc_now()
        updated = (
            self.db.query(MerchantNotification)
            .filter(
                MerchantNotification.account_id == str(account_id),
                MerchantNotification.read_at.is_(None),
            )
            .update({"read_at": now}, synchronize_session=False)
        )
        self.db.commit()
        return int(updated or 0)

    def notify_order_status(
        self,
        order: Order,
        status: str,
        *,
        receipt: str | None = None,
    ) -> MerchantNotification | None:
        if status not in DASHBOARD_ORDER_STATUSES:
            return None

        ref = format_order_ref(order.order_number)
        label = STATUS_LABELS.get(status, status.replace("_", " ").title())
        customer = order.customer_name or order.customer_phone or "a customer"

        if status == "placed":
            title = f"New order {ref}"
            body = f"{customer} placed an order."
            kind = "order"
        elif status == "payment_received":
            receipt_bit = f" (receipt {receipt})" if receipt else ""
            title = f"Payment received — {ref}"
            body = f"M-PESA payment confirmed{receipt_bit}."
            kind = "order"
        elif status == "cancelled":
            title = f"Order {ref} cancelled"
            body = None
            kind = "order"
        elif status in {"awaiting_delivery_confirmation", "awaiting_pickup_confirmation"}:
            title = f"{ref} needs confirmation"
            body = f"Order is {label.lower()}."
            kind = "process"
        elif status in {"ready", "out_for_delivery", "being_prepared", "awaiting_payment"}:
            title = f"{ref}: {label}"
            body = None
            kind = "process"
        else:
            title = f"{ref}: {label}"
            body = None
            kind = "order"

        return self.create(
            account_id=str(order.account_id),
            kind=kind,
            title=title,
            body=body,
            entity_type="order",
            entity_id=order.id,
            dedupe_key=f"order:{order.id}:{status}",
        )

    def notify_delivery_dispute(self, order: Order) -> MerchantNotification | None:
        ref = format_order_ref(order.order_number)
        customer = order.customer_name or order.customer_phone or "Customer"
        return self.create(
            account_id=str(order.account_id),
            kind="process",
            title=f"Delivery issue — {ref}",
            body=f"{customer} reported a problem with their order.",
            entity_type="order",
            entity_id=order.id,
            dedupe_key=f"order:{order.id}:dispute",
        )

    def maybe_notify_inbound_message(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> MerchantNotification | None:
        if not account.account_id or not message.is_inbound():
            return None

        account_ig_id = str(account.instagram_user_id or "")
        unread = _inbound_unread_count(conversation, account_ig_id)
        if merchant_unread_count(conversation, unread, account, self.db) <= 0:
            return None

        handle = conversation.participant_username or conversation.participant_ig_id or "Customer"
        preview = (message.body or "New message").strip()
        if len(preview) > 120:
            preview = f"{preview[:117]}..."

        return self.create(
            account_id=str(account.account_id),
            kind="message",
            title=f"Message from @{handle}" if "@" not in handle else f"Message from {handle}",
            body=preview,
            entity_type="conversation",
            entity_id=conversation.id,
            dedupe_key=f"message:{message.id}",
        )

    def notify_ticket_opened(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        ticket: SupportTicket,
    ) -> MerchantNotification | None:
        if not account.account_id:
            return None

        handle = conversation.participant_username or conversation.participant_ig_id or "Customer"
        ticket_ref = f"T-{ticket.ticket_number:04d}"
        return self.create(
            account_id=str(account.account_id),
            kind="ticket",
            title=f"Support ticket {ticket_ref}",
            body=f"New conversation with {handle}.",
            entity_type="ticket",
            entity_id=ticket.id,
            dedupe_key=f"ticket:{ticket.id}:opened",
        )

    def notify_live_agent_handoff(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        *,
        message_id: str | None = None,
    ) -> MerchantNotification | None:
        if not account.account_id:
            return None

        handle = conversation.participant_username or conversation.participant_ig_id or "Customer"
        dedupe = f"handoff:{conversation.id}:{message_id}" if message_id else f"handoff:{conversation.id}"
        return self.create(
            account_id=str(account.account_id),
            kind="process",
            title="Live agent requested",
            body=f"{handle} asked to speak with your team.",
            entity_type="conversation",
            entity_id=conversation.id,
            dedupe_key=dedupe,
        )
