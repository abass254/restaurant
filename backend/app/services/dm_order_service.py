from __future__ import annotations

import re
from datetime import datetime

from sqlalchemy.orm import Session, joinedload

from app.models import Order
from app.services.order_notification_service import (
    OrderNotificationService,
    _message_for_status,
)
from app.support.order_status import (
    AWAITING_PAYMENT,
    CONFIRMATION_STATUSES,
    PAYMENT_RECEIVED,
    STATUS_LABELS,
    TERMINAL_STATUSES,
)
from app.services.order_completion_service import OrderCompletionService

TRACK_ORDER_RE = re.compile(
    r"\b(track|status|where is my order|order ref|my order|order update)\b",
    re.IGNORECASE,
)


class DmOrderService:
    """Order-aware DM copy driven by live order state and platform events."""

    def __init__(self, db: Session, settings=None):
        self.db = db
        self.settings = settings

    @staticmethod
    def is_track_request(text: str | None) -> bool:
        return bool(TRACK_ORDER_RE.search((text or "").strip()))

    def order_for_session(self, conversation_id: str, session: dict) -> Order | None:
        order_id = str(session.get("order_id") or "").strip()
        if order_id:
            order = self._load_order(order_id)
            if order and order.source_conversation_id == conversation_id:
                return order

        return self.active_order_for_conversation(
            conversation_id,
            opened_after=self._conversation_ticket_opened_at(conversation_id),
        )

    def active_order_for_conversation(
        self,
        conversation_id: str,
        *,
        opened_after: datetime | None = None,
    ) -> Order | None:
        query = (
            self.db.query(Order)
            .options(joinedload(Order.items), joinedload(Order.status_history))
            .filter(
                Order.source_conversation_id == conversation_id,
                Order.status.notin_(tuple(TERMINAL_STATUSES)),
            )
        )
        if opened_after is not None:
            query = query.filter(
                Order.created_at.is_not(None),
                Order.created_at >= opened_after,
            )
        return query.order_by(Order.created_at.desc()).first()

    def latest_order_for_conversation(self, conversation_id: str) -> Order | None:
        return (
            self.db.query(Order)
            .options(joinedload(Order.items), joinedload(Order.status_history))
            .filter(Order.source_conversation_id == conversation_id)
            .order_by(Order.created_at.desc())
            .first()
        )

    def order_awaiting_completion_confirm(
        self,
        conversation_id: str,
        session: dict | None = None,
    ) -> Order | None:
        order = self.order_for_session(conversation_id, session or {})
        if order is None:
            order = self.active_order_for_conversation(conversation_id)
        if order is None:
            return None

        status = str(order.status or "")
        if status in CONFIRMATION_STATUSES:
            return order

        completion = OrderCompletionService
        if status in completion.customer_eligible_statuses(order):
            return order
        return None

    def _load_order(self, order_id: str) -> Order | None:
        return (
            self.db.query(Order)
            .options(joinedload(Order.items), joinedload(Order.status_history))
            .filter(Order.id == order_id)
            .first()
        )

    def _conversation_ticket_opened_at(self, conversation_id: str) -> datetime | None:
        from app.models import InstagramConversation

        conversation = (
            self.db.query(InstagramConversation)
            .filter(InstagramConversation.id == conversation_id)
            .first()
        )
        if conversation is None:
            return None
        return getattr(conversation, "ticket_opened_at", None)

    def notify_customer_status(self, order: Order, status: str, *, force: bool = False) -> bool:
        from app.config import get_settings

        settings = self.settings or get_settings()
        return OrderNotificationService(self.db, settings).notify_status_change(
            order,
            status,
            force=force,
        )

    def format_status_reply(self, order: Order, *, include_timeline: bool = True) -> str:
        status_message = _message_for_status(order, order.status)
        lines = [status_message or self._fallback_status_line(order)]

        if include_timeline:
            timeline = self._format_timeline(order)
            if timeline:
                lines.extend(["", "Recent updates:", timeline])

        if order.status in TERMINAL_STATUSES:
            lines.extend(["", "Reply 0 for the main menu if you need anything else."])
        else:
            lines.extend(
                [
                    "",
                    "We will message you here whenever your order moves to the next step.",
                    "Reply 0 for the main menu.",
                ],
            )
        return "\n".join(lines)

    def format_brief_open_order_reply(self, order: Order) -> str:
        label = STATUS_LABELS.get(order.status, order.status.replace("_", " ").title())
        lines = [
            f"Your open order is **{order.order_number}** — currently **{label}**.",
            f"Total: KES {int(round(float(order.total or 0))):,}.",
        ]
        if order.status == AWAITING_PAYMENT:
            lines.append(
                "Payment is pending. Use the Pay now button in our payment message, "
                "or ask us to resend it."
            )
        elif order.status == PAYMENT_RECEIVED:
            lines.append("Payment is confirmed and we are preparing your order.")
        else:
            lines.append("Reply **status** for the full timeline, or 0 for the main menu.")
        return "\n".join(lines)

    def format_no_order_reply(self) -> str:
        return (
            "I could not find an active order on this chat.\n"
            "Place an order first, or share your order reference (for example: ORD-000123)."
        )

    @staticmethod
    def _fallback_status_line(order: Order) -> str:
        label = STATUS_LABELS.get(order.status, order.status.replace("_", " ").title())
        return (
            f"Order **{order.order_number}**\n"
            f"Status: {label}\n"
            f"Total: KES {int(round(float(order.total or 0))):,}"
        )

    @staticmethod
    def _format_timeline(order: Order) -> str:
        history = list(order.status_history or [])
        if not history:
            label = STATUS_LABELS.get(order.status, order.status)
            return f"• {label}"

        lines: list[str] = []
        for entry in history[-5:]:
            label = STATUS_LABELS.get(entry.to_status, entry.to_status.replace("_", " ").title())
            stamp = DmOrderService._format_time(entry.created_at)
            suffix = f" — {stamp}" if stamp else ""
            lines.append(f"• {label}{suffix}")
        return "\n".join(lines)

    @staticmethod
    def _format_time(value: datetime | None) -> str:
        if value is None:
            return ""
        try:
            return value.strftime("%-I:%M %p")
        except ValueError:
            return value.strftime("%I:%M %p").lstrip("0")
