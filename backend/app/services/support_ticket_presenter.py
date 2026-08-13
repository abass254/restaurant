from __future__ import annotations

from datetime import datetime, timezone

from app.models import InstagramConversation, SupportTicket, TicketEvent
from app.schemas import SupportTicketEventOut, SupportTicketOut
from app.support.datetime_utils import as_utc, sortable_datetime


def ticket_duration_seconds(ticket: SupportTicket, *, now: datetime | None = None) -> int | None:
    opened = as_utc(ticket.opened_at)
    if opened is None:
        return None
    end = as_utc(ticket.closed_at) or as_utc(now) or datetime.now(timezone.utc)
    return max(0, int((end - opened).total_seconds()))


def ticket_to_out(
    ticket: SupportTicket | None,
    *,
    include_events: bool = False,
) -> SupportTicketOut | None:
    if ticket is None:
        return None
    events = None
    if include_events and ticket.events:
        events = [SupportTicketEventOut.model_validate(item) for item in ticket.events]
    return SupportTicketOut(
        id=ticket.id,
        ticket_number=ticket.ticket_number,
        display_number=ticket.display_number(),
        status=ticket.status,
        resolution=ticket.resolution,
        close_reason=ticket.close_reason,
        opened_at=ticket.opened_at,
        closed_at=ticket.closed_at,
        first_customer_reply_at=ticket.first_customer_reply_at,
        first_agent_reply_at=ticket.first_agent_reply_at,
        resolved_at=ticket.resolved_at,
        duration_seconds=ticket_duration_seconds(ticket),
        events=events,
    )


def active_ticket_for_conversation(conversation: InstagramConversation) -> SupportTicket | None:
    if conversation.current_support_ticket is not None:
        return conversation.current_support_ticket
    if not conversation.support_tickets:
        return None
    return max(
        conversation.support_tickets,
        key=lambda item: sortable_datetime(item.opened_at or item.created_at),
    )
