"""Lightweight sidebar badge counts."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.messages import _load_messaging_accounts, _unread_count
from app.core.session import require_user
from app.support.merchant_permissions import user_can_access_section
from app.database import get_db
from app.dependencies import get_request_session, get_services, ServiceContainer
from app.models import Order, User
from app.services.agent_reply_policy import (
    conversation_needs_merchant_attention,
    merchant_unread_count,
)
from app.support.order_status import SOURCE_RIDER_REQUEST, TERMINAL_STATUSES
from app.support.merchant_permissions import active_account_id, user_can_access_section

router = APIRouter(prefix="/nav-counts", tags=["nav-counts"])


class NavCountsOut(BaseModel):
    messages: int = 0
    tickets: int = 0
    orders: int = 0


def _messaging_counts(services: ServiceContainer, user: User) -> tuple[int, int]:
    try:
        accounts = _load_messaging_accounts(services, user)
    except Exception:
        return 0, 0

    messages_unread = 0
    tickets_needing_attention = 0
    db = services.db

    for account in accounts:
        account_ig_id = str(account.instagram_user_id or "")
        for conversation in account.conversations:
            raw_unread = _unread_count(conversation, account_ig_id)
            unread = merchant_unread_count(conversation, raw_unread, account, db)
            # Badge shows number of unopened chats, not total unread messages.
            if unread > 0:
                messages_unread += 1
            if conversation.is_ticket_open() and conversation_needs_merchant_attention(
                conversation,
                raw_unread,
                account,
                db,
            ):
                tickets_needing_attention += 1

    return messages_unread, tickets_needing_attention


def _active_orders_count(db: Session, user: User) -> int:
    account_id = active_account_id(user)
    return (
        db.query(Order)
        .filter(
            Order.account_id == str(account_id),
            Order.status.notin_(tuple(TERMINAL_STATUSES)),
            Order.source != SOURCE_RIDER_REQUEST,
        )
        .count()
    )


@router.get("")
def show_nav_counts(
    services: ServiceContainer = Depends(get_services),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
) -> dict:
    user = require_user(db, session)
    messages_unread, open_tickets = _messaging_counts(services, user)
    active_orders = _active_orders_count(db, user)

    if not user_can_access_section(user, "tickets"):
        messages_unread = 0
        open_tickets = 0
    if not user_can_access_section(user, "orders"):
        active_orders = 0

    return {
        "data": NavCountsOut(
            messages=messages_unread,
            tickets=open_tickets,
            orders=active_orders,
        ),
    }
