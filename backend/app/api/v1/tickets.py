from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import joinedload

from app.core.session import require_onboarded_user, validate_csrf
from app.support.merchant_permissions import assert_merchant_section_access
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.models import InstagramAccount, InstagramConversation, SupportTicket, User
from app.schemas import SupportTicketOut
from app.services.platform_instagram import require_merchant_account_id
from app.services.support_ticket_presenter import ticket_to_out
from app.services.support_ticket_service import SupportTicketService
from app.services.ticket_analytics_service import TicketAnalyticsService

router = APIRouter(prefix="/tickets", tags=["tickets"])


class ResolveTicketRequest(BaseModel):
    resolution: str = Field(pattern="^(solved|unsolved)$")
    close_reason: str | None = Field(default=None, max_length=500)


def _account_for_ticket(
    services: ServiceContainer,
    ticket: SupportTicket,
    user: User,
) -> InstagramAccount | None:
    merchant_id = require_merchant_account_id(user)
    return (
        services.db.query(InstagramAccount)
        .filter(
            InstagramAccount.id == ticket.instagram_account_id,
            InstagramAccount.account_id == merchant_id,
        )
        .first()
    )


@router.get("/analytics")
def ticket_analytics(
    days: int = Query(default=30, ge=1, le=365),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tickets")
    merchant_id = require_merchant_account_id(user)
    report = TicketAnalyticsService(services.db).build_report(merchant_id, days=days)
    return {"data": report}


@router.get("/{ticket_id}")
def show_ticket(
    ticket_id: str,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tickets")
    ticket = (
        services.db.query(SupportTicket)
        .options(joinedload(SupportTicket.events))
        .filter(SupportTicket.id == ticket_id)
        .first()
    )
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")
    if _account_for_ticket(services, ticket, user) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")
    return {"data": ticket_to_out(ticket, include_events=True)}


@router.patch("/{ticket_id}/resolve")
def resolve_ticket(
    ticket_id: str,
    payload: ResolveTicketRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tickets")
    ticket = (
        services.db.query(SupportTicket)
        .options(joinedload(SupportTicket.events))
        .filter(SupportTicket.id == ticket_id)
        .first()
    )
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")
    if _account_for_ticket(services, ticket, user) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")

    conversation = (
        services.db.query(InstagramConversation)
        .filter(InstagramConversation.id == ticket.instagram_conversation_id)
        .first()
    )
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")

    ticket_service = SupportTicketService(services.db)
    try:
        ticket_service.resolve_ticket(
            ticket,
            conversation,
            resolution=payload.resolution,
            user_id=user.id,
            close_reason=payload.close_reason,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    account = _account_for_ticket(services, ticket, user)
    if account is not None:
        services.dm_tickets.send_agent_closed_notice(account, conversation)
        services.dm_agent.resume_autopilot_after_handoff(account, conversation)

    services.db.commit()
    services.db.refresh(ticket)

    return {
        "message": "Ticket updated.",
        "data": ticket_to_out(ticket, include_events=True),
    }
