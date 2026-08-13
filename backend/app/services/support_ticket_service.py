from __future__ import annotations

from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import InstagramAccount, InstagramConversation, Order, SupportTicket, TicketEvent
from app.support.datetime_utils import utc_now
from app.support.order_status import DELIVERED, PICKED_UP
from app.support.sales_session import STEP_IDLE, write_session


class SupportTicketService:
    """Persist ticket history and event timeline for Instagram DM support."""

    def __init__(self, db: Session):
        self.db = db

    def open_ticket(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        *,
        now: datetime | None = None,
    ) -> SupportTicket:
        ts = now or utc_now()
        ticket_number = self._next_ticket_number(account.id)
        ticket = SupportTicket(
            instagram_account_id=account.id,
            instagram_conversation_id=conversation.id,
            ticket_number=ticket_number,
            status="waiting_customer",
            participant_username=conversation.participant_username,
            participant_ig_id=conversation.participant_ig_id,
            opened_at=ts,
            created_at=ts,
            updated_at=ts,
        )
        self.db.add(ticket)
        self.db.flush()
        conversation.current_support_ticket_id = ticket.id
        self.log_event(ticket, "ticket_opened", "Ticket opened", created_at=ts)
        return ticket

    def log_greeting_sent(self, ticket: SupportTicket) -> None:
        self.log_event(ticket, "greeting_sent", "Greeting menu sent to customer")

    def record_customer_reply(self, ticket: SupportTicket) -> None:
        now = utc_now()
        if ticket.first_customer_reply_at is None:
            ticket.first_customer_reply_at = now
        if ticket.status == "waiting_customer":
            ticket.status = "open"
        ticket.updated_at = now
        self.log_event(ticket, "customer_replied", "Customer sent a message")

    def record_agent_reply(self, ticket: SupportTicket, user_id: str | None = None) -> None:
        now = utc_now()
        if ticket.first_agent_reply_at is None:
            ticket.first_agent_reply_at = now
        if ticket.is_open():
            ticket.status = "open"
        ticket.updated_at = now
        self.log_event(
            ticket,
            "agent_replied",
            "Agent sent a reply",
            actor_user_id=user_id,
        )

    def close_auto_timeout(self, ticket: SupportTicket) -> None:
        now = utc_now()
        ticket.status = "closed_unresolved"
        ticket.resolution = "auto_timeout"
        ticket.closed_at = now
        ticket.updated_at = now
        self.log_event(
            ticket,
            "auto_closed",
            "Closed due to customer inactivity",
            created_at=now,
        )

    def resolve_ticket(
        self,
        ticket: SupportTicket,
        conversation: InstagramConversation,
        *,
        resolution: str,
        user_id: str | None = None,
        close_reason: str | None = None,
    ) -> None:
        if not ticket.is_open():
            raise ValueError("Ticket is already closed.")

        now = utc_now()
        if resolution == "solved":
            ticket.status = "resolved"
            ticket.resolution = "solved"
            event_type = "marked_solved"
            event_body = "Marked as solved"
        elif resolution == "unsolved":
            ticket.status = "closed_unresolved"
            ticket.resolution = "unsolved"
            event_type = "marked_unresolved"
            event_body = "Marked as unresolved"
        else:
            raise ValueError(f"Unsupported resolution: {resolution}")

        ticket.close_reason = close_reason
        ticket.resolved_at = now
        ticket.closed_at = now
        ticket.resolved_by_user_id = user_id
        ticket.updated_at = now

        conversation.ticket_status = "closed"
        conversation.ticket_closed_at = now
        conversation.awaiting_customer_since = None
        conversation.response_timeout_token = None
        # Reset DM order/menu flow when a ticket is explicitly closed.
        write_session(conversation, clear=True)
        conversation.sales_session = {"step": STEP_IDLE, "menu_sent": True}
        conversation.updated_at = now

        self.log_event(
            ticket,
            event_type,
            close_reason or event_body,
            actor_user_id=user_id,
            created_at=now,
        )

    def reopen_ticket(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        *,
        user_id: str | None = None,
    ) -> SupportTicket:
        if conversation.is_ticket_open():
            ticket = self.get_current_ticket(conversation)
            if ticket is not None and ticket.is_open():
                raise ValueError("Ticket is already open.")
            raise ValueError("Conversation is already open.")

        now = utc_now()
        conversation.ticket_status = "open"
        conversation.ticket_opened_at = now
        conversation.ticket_closed_at = None
        conversation.awaiting_customer_since = None
        conversation.response_timeout_token = None
        # Reopened tickets should always begin from a clean DM menu flow.
        write_session(conversation, clear=True)
        conversation.sales_session = {"step": STEP_IDLE, "menu_sent": True}
        conversation.updated_at = now

        ticket = self.open_ticket(account, conversation, now=now)
        ticket.status = "open"
        ticket.updated_at = now
        self.log_event(
            ticket,
            "manually_reopened",
            "Ticket reopened by agent",
            actor_user_id=user_id,
            created_at=now,
        )
        return ticket

    def try_resolve_for_order_completion(
        self,
        order: Order,
        *,
        user_id: str | None = None,
    ) -> bool:
        """Mark the DM ticket solved when an order is delivered or picked up."""
        status = str(order.status or "")
        if status not in {DELIVERED, PICKED_UP}:
            return False
        if not order.source_conversation_id:
            return False

        conversation = (
            self.db.query(InstagramConversation)
            .filter(InstagramConversation.id == order.source_conversation_id)
            .first()
        )
        if conversation is None:
            return False

        ticket = self.get_current_ticket(conversation)
        if ticket is None or not ticket.is_open():
            return False

        ref = str(order.order_number or "").strip() or "order"
        if status == DELIVERED:
            close_reason = f"Order {ref} delivered and closed"
        else:
            close_reason = f"Order {ref} picked up and closed"

        try:
            self.resolve_ticket(
                ticket,
                conversation,
                resolution="solved",
                user_id=user_id,
                close_reason=close_reason,
            )
        except ValueError:
            return False
        return True

    def get_current_ticket(self, conversation: InstagramConversation) -> SupportTicket | None:
        if conversation.current_support_ticket_id:
            ticket = (
                self.db.query(SupportTicket)
                .filter(SupportTicket.id == conversation.current_support_ticket_id)
                .first()
            )
            if ticket is not None:
                return ticket
        return (
            self.db.query(SupportTicket)
            .filter(SupportTicket.instagram_conversation_id == conversation.id)
            .order_by(SupportTicket.opened_at.desc(), SupportTicket.created_at.desc())
            .first()
        )

    def log_event(
        self,
        ticket: SupportTicket,
        event_type: str,
        body: str | None = None,
        *,
        actor_user_id: str | None = None,
        metadata: dict | None = None,
        created_at: datetime | None = None,
    ) -> TicketEvent:
        now = created_at or utc_now()
        event = TicketEvent(
            support_ticket_id=ticket.id,
            event_type=event_type,
            body=body,
            metadata_json=metadata,
            actor_user_id=actor_user_id,
            created_at=now,
        )
        self.db.add(event)
        return event

    def _next_ticket_number(self, instagram_account_id: str) -> int:
        current = (
            self.db.query(func.max(SupportTicket.ticket_number))
            .filter(SupportTicket.instagram_account_id == instagram_account_id)
            .scalar()
        )
        return int(current or 0) + 1
