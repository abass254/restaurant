from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import joinedload

from app.config import get_settings
from app.core.session import require_onboarded_user, require_user, validate_csrf
from app.support.merchant_permissions import assert_merchant_section_access
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.models import AutoReplyRule, InstagramAccount, InstagramConversation, SupportTicket, User, WebhookEvent
from app.services.support_ticket_presenter import active_ticket_for_conversation, ticket_to_out
from app.services.support_ticket_service import SupportTicketService
from app.services.agent_reply_policy import (
    agent_manual_reply_allowed,
    bot_sandbox_allows_free_text,
    conversation_free_messaging,
    conversation_live_agent_handoff,
    merchant_unread_count,
)
from app.services.bot_sandbox_context import bot_sandbox_messaging_context
from app.services.bot_sandbox_service import resolve_bot_sandbox_account
from app.services.dm_chips_only import sandbox_chips_for_account
from app.services.dm_templates import greeting_was_sent
from app.services.auto_reply_service import (
    DEFAULT_GREETING_REPLY,
    DEFAULT_GREETING_TRIGGER,
)
from app.services.conversation_resolver import merge_duplicate_conversations
from app.services.participant_profile_service import schedule_participant_profile_enrichment
from app.services.platform_instagram import get_merchant_instagram_beta_account, require_merchant_account_id
from app.support.datetime_utils import as_utc, sortable_datetime
from app.schemas import ConversationOut, MessageOut
from app.services.typing_state import is_agent_typing, is_typing
from app.support.sales_session import STEP_IDLE, write_session
from app.support.webhook_utils import count_tester_like

router = APIRouter(prefix="/messages", tags=["messages"])


def _load_messaging_accounts(services: ServiceContainer, user: User) -> list[InstagramAccount]:
    merchant_id = require_merchant_account_id(user)
    accounts = (
        services.db.query(InstagramAccount)
        .options(
            joinedload(InstagramAccount.conversations).joinedload(InstagramConversation.messages),
            joinedload(InstagramAccount.conversations).joinedload(
                InstagramConversation.current_support_ticket,
            ),
            joinedload(InstagramAccount.auto_reply_rules),
        )
        .filter(
            InstagramAccount.account_id == merchant_id,
            InstagramAccount.platform.in_(["instagram", "whatsapp"]),
        )
        .all()
    )
    if not accounts:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "no_channel_connected",
                "message": "No messaging channel is connected for your shop yet. Connect Instagram in Settings.",
            },
        )
    return accounts


def _account_for_conversation(
    services: ServiceContainer,
    conversation: InstagramConversation,
    user: User,
) -> InstagramAccount | None:
    merchant_id = require_merchant_account_id(user)
    return (
        services.db.query(InstagramAccount)
        .filter(
            InstagramAccount.id == conversation.instagram_account_id,
            InstagramAccount.account_id == merchant_id,
        )
        .first()
    )


def _as_utc(value: datetime | None) -> datetime | None:
    return as_utc(value)


def _conversation_sort_key(conversation: InstagramConversation) -> datetime:
    return sortable_datetime(conversation.last_message_at or conversation.created_at)


def _message_timestamp(message) -> datetime:
    raw = message.sent_at or message.created_at
    if raw is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    return _as_utc(raw) or datetime.min.replace(tzinfo=timezone.utc)


def _unread_count(conversation: InstagramConversation, account_ig_id: str) -> int:
    last_read = _as_utc(conversation.last_read_at)
    count = 0
    for message in conversation.messages:
        if message.direction != "inbound":
            continue
        if account_ig_id and str(message.sender_ig_id or "") == account_ig_id:
            continue
        if last_read is None or _message_timestamp(message) > last_read:
            count += 1
    return count


def _conversation_out(
    conversation: InstagramConversation,
    platform: str = "instagram",
    account_ig_id: str = "",
    *,
    include_ticket_events: bool = False,
    account: InstagramAccount | None = None,
    db=None,
) -> ConversationOut:
    latest = None
    if conversation.messages:
        latest_message = max(
            conversation.messages,
            key=lambda item: item.sent_at or item.created_at or item.id,
        )
        latest = MessageOut.model_validate(latest_message)

    raw_unread = _unread_count(conversation, account_ig_id)
    unread = (
        merchant_unread_count(conversation, raw_unread, account, db)
        if account is not None and db is not None
        else raw_unread
    )
    active_ticket = active_ticket_for_conversation(conversation)
    handoff = conversation_live_agent_handoff(conversation)
    reply_allowed = agent_manual_reply_allowed(account, conversation) if account else True

    return ConversationOut(
        id=conversation.id,
        platform=platform,
        instagram_conversation_id=conversation.instagram_conversation_id,
        participant_username=conversation.participant_username,
        participant_ig_id=conversation.participant_ig_id,
        participant_profile_pic_url=conversation.participant_profile_pic_url,
        last_message_at=conversation.last_message_at,
        last_read_at=conversation.last_read_at,
        unread_count=unread,
        is_unread=unread > 0,
        ticket_status=conversation.ticket_status or "open",
        ticket_opened_at=conversation.ticket_opened_at,
        ticket_closed_at=conversation.ticket_closed_at,
        active_ticket=ticket_to_out(active_ticket, include_events=include_ticket_events),
        participant_is_typing=is_typing(conversation.id),
        agent_is_typing=is_agent_typing(conversation.id),
        messages_count=len(conversation.messages),
        latest_message=latest,
        messages=None,
        live_agent_handoff=handoff,
        agent_reply_allowed=reply_allowed,
    )


def _conversation_detail(
    conversation: InstagramConversation,
    platform: str = "instagram",
    account_ig_id: str = "",
    *,
    account: InstagramAccount | None = None,
    db=None,
) -> ConversationOut:
    messages = sorted(
        conversation.messages,
        key=lambda item: item.sent_at or item.created_at or item.id,
    )
    raw_unread = _unread_count(conversation, account_ig_id)
    unread = (
        merchant_unread_count(conversation, raw_unread, account, db)
        if account is not None and db is not None
        else raw_unread
    )
    active_ticket = active_ticket_for_conversation(conversation)
    if active_ticket is not None and active_ticket.events:
        pass  # events loaded via joinedload when present

    handoff = conversation_live_agent_handoff(conversation)
    reply_allowed = agent_manual_reply_allowed(account, conversation) if account else True

    return ConversationOut(
        id=conversation.id,
        platform=platform,
        instagram_conversation_id=conversation.instagram_conversation_id,
        participant_username=conversation.participant_username,
        participant_ig_id=conversation.participant_ig_id,
        participant_profile_pic_url=conversation.participant_profile_pic_url,
        last_message_at=conversation.last_message_at,
        last_read_at=conversation.last_read_at,
        unread_count=unread,
        is_unread=unread > 0,
        ticket_status=conversation.ticket_status or "open",
        ticket_opened_at=conversation.ticket_opened_at,
        ticket_closed_at=conversation.ticket_closed_at,
        active_ticket=ticket_to_out(active_ticket, include_events=True),
        participant_is_typing=is_typing(conversation.id),
        agent_is_typing=is_agent_typing(conversation.id),
        messages_count=len(messages),
        latest_message=MessageOut.model_validate(messages[-1]) if messages else None,
        messages=[MessageOut.model_validate(item) for item in messages],
        live_agent_handoff=handoff,
        agent_reply_allowed=reply_allowed,
    )


def _mark_conversation_read(conversation: InstagramConversation) -> None:
    conversation.last_read_at = datetime.now(timezone.utc)
    conversation.updated_at = datetime.now(timezone.utc)


@router.get("")
def list_messages(
    sync: bool = Query(
        False,
        description="Pull history from Meta Graph API (slow). Default: DB only (webhooks).",
    ),
    lite: bool = Query(
        True,
        description="Skip slow Meta diagnostics on inbox load (recommended).",
    ),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tickets")
    accounts = _load_messaging_accounts(services, user)
    settings = get_settings()

    sync_error = None
    api_conversation_count = None
    if sync:
        instagram_account = next((item for item in accounts if item.platform == "instagram"), None)
        if instagram_account is None:
            sync_error = "History sync is currently supported for Instagram only."
        else:
            try:
                result = services.messaging.sync(instagram_account)
                api_conversation_count = result["api_conversation_count"]
                services.db.refresh(instagram_account)
            except Exception as exc:
                sync_error = str(exc)
                # A failed sync (e.g. an IntegrityError mid-flush) leaves the
                # session in a rolled-back state. Reset it so the subsequent
                # merge/commit below doesn't blow up with PendingRollbackError
                # and turn a soft sync warning into a hard 500.
                services.db.rollback()

    for account in accounts:
        if account.platform == "instagram":
            merge_duplicate_conversations(services.db, account)
    services.db.commit()
    for account in accounts:
        services.db.refresh(account)

    conversations_with_platform = [
        (conversation, account)
        for account in accounts
        for conversation in account.conversations
    ]
    conversations_with_platform.sort(
        key=lambda item: _conversation_sort_key(item[0]),
        reverse=True,
    )
    if lite:
        diagnostics = {}
    else:
        instagram_account = next((item for item in accounts if item.platform == "instagram"), None)
        diagnostics = (
            services.connection.diagnostics(instagram_account)
            if instagram_account is not None
            else {"note": "Diagnostics available for Instagram only."}
        )

    instagram_account = next((item for item in accounts if item.platform == "instagram"), None)
    instagram_account_ig_id = str(instagram_account.instagram_user_id or "") if instagram_account else ""

    auto_replies_enabled = (
        bool(getattr(instagram_account, "auto_replies_enabled", True))
        if instagram_account is not None
        else True
    )

    if instagram_account is not None and not settings.instagram_fake_messaging:
        missing_profiles = sorted(
            (
                conversation
                for conversation in instagram_account.conversations
                if conversation.participant_ig_id and not conversation.participant_profile_pic_url
            ),
            key=lambda item: _conversation_sort_key(item),
            reverse=True,
        )[:2]
        for conversation in missing_profiles:
            schedule_participant_profile_enrichment(conversation.id, instagram_account.id)

    recent_events = (
        services.db.query(WebhookEvent)
        .order_by(WebhookEvent.received_at.desc())
        .limit(100)
        .all()
    )

    inbound_from_others_count = sum(
        1
        for conversation, account in conversations_with_platform
        if any(  # noqa: C419
            message.direction == "inbound"
            and message.sender_ig_id != str(account.instagram_user_id or "")
            for message in conversation.messages
        )
    )

    conversation_rows = [
        _conversation_out(
            conversation,
            account.platform,
            str(account.instagram_user_id or ""),
            account=account,
            db=services.db,
        )
        for conversation, account in conversations_with_platform
    ]
    total_unread = sum(item.unread_count for item in conversation_rows)

    return {
        "conversations": conversation_rows,
        "connected_platforms": sorted(
            {account.platform for account in accounts if account.platform in {"instagram", "whatsapp"}},
        ),
        "total_unread": total_unread,
        "auto_replies_enabled": auto_replies_enabled,
        "sync_error": sync_error,
        "api_conversation_count": api_conversation_count,
        "diagnostics": diagnostics,
        "tester_webhook_count": count_tester_like(recent_events, instagram_account_ig_id),
        "inbound_from_others_count": inbound_from_others_count,
        "show_simulate_dm": settings.instagram_show_simulate_dm,
        "simulate_default_sender_id": settings.instagram_simulate_dm_sender_id,
        "fake_messaging": settings.instagram_fake_messaging,
        "instagram_beta_enabled": settings.instagram_beta_enabled,
        "instagram_outbound_transport": settings.instagram_outbound_transport,
        "instagram_beta_connected": get_merchant_instagram_beta_account(
            services.db,
            str(instagram_account.account_id),
        )
        is not None
        if instagram_account is not None and instagram_account.account_id
        else False,
    }


def _require_bot_sandbox(settings) -> None:
    if not settings.bot_preview_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")


def _find_bot_conversation(
    account: InstagramAccount,
    sender_id: str,
) -> InstagramConversation | None:
    return next(
        (item for item in account.conversations if item.participant_ig_id == sender_id),
        None,
    )


@router.get("/bot-sandbox")
def get_bot_sandbox(
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "tools")
    raise HTTPException(
        status.HTTP_404_NOT_FOUND,
        detail="Bot preview is only available in the admin console.",
    )


class BotSandboxMessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    client_username: str | None = Field(default=None, max_length=64)
    from_chip: bool = False


@router.post("/bot-sandbox/message")
def bot_sandbox_message(
    payload: BotSandboxMessageRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "tools")
    raise HTTPException(
        status.HTTP_404_NOT_FOUND,
        detail="Bot preview is only available in the admin console.",
    )


@router.post("/bot-sandbox/reset")
def reset_bot_sandbox(
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "tools")
    raise HTTPException(
        status.HTTP_404_NOT_FOUND,
        detail="Bot preview is only available in the admin console.",
    )


@router.get("/{conversation_id}")
def show_conversation(
    conversation_id: str,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tickets")
    conversation = (
        services.db.query(InstagramConversation)
        .options(
            joinedload(InstagramConversation.messages),
            joinedload(InstagramConversation.current_support_ticket).joinedload(
                SupportTicket.events,
            ),
        )
        .filter(InstagramConversation.id == conversation_id)
        .first()
    )
    if not conversation:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")
    account = _account_for_conversation(services, conversation, user)
    if account is None or account.platform not in {"instagram", "whatsapp"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")

    account_platform = account.platform
    account_ig_id = str(account.instagram_user_id or "")

    _mark_conversation_read(conversation)
    services.db.commit()
    services.db.refresh(conversation)

    return _conversation_detail(
        conversation,
        account_platform,
        account_ig_id,
        account=account,
        db=services.db,
    )


class ReplyRequest(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


@router.post("/{conversation_id}/reply")
def reply_to_conversation(
    conversation_id: str,
    payload: ReplyRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tickets")
    conversation = (
        services.db.query(InstagramConversation)
        .filter(
            InstagramConversation.id == conversation_id,
        )
        .first()
    )
    if not conversation:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")
    account = _account_for_conversation(services, conversation, user)
    if account is None or account.platform not in {"instagram", "whatsapp"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")

    if not agent_manual_reply_allowed(account, conversation):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=(
                "Auto-replies are handling this chat. Turn off auto-replies in settings, "
                "or wait until the customer requests a live agent."
            ),
        )

    if account.platform != "instagram":
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            detail="Sending replies from inbox is currently supported for Instagram only.",
        )

    try:
        message = services.messaging.send_reply(account, conversation, payload.body)
    except Exception as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=f"Failed to send: {exc}") from exc

    ticket_service = SupportTicketService(services.db)
    ticket = ticket_service.get_current_ticket(conversation)
    if ticket is not None and ticket.is_open():
        ticket_service.record_agent_reply(ticket, user_id=user.id)
        services.db.commit()

    return {
        "message": "Message sent.",
        "data": MessageOut.model_validate(message),
    }


class TicketStatusRequest(BaseModel):
    status: str = Field(pattern="^(open|closed)$")
    close_reason: str | None = Field(default=None, max_length=500)


@router.patch("/{conversation_id}/ticket-status")
def update_conversation_ticket_status(
    conversation_id: str,
    payload: TicketStatusRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tickets")
    conversation = (
        services.db.query(InstagramConversation)
        .options(
            joinedload(InstagramConversation.messages),
            joinedload(InstagramConversation.current_support_ticket).joinedload(
                SupportTicket.events,
            ),
        )
        .filter(InstagramConversation.id == conversation_id)
        .first()
    )
    if not conversation:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")
    account = _account_for_conversation(services, conversation, user)
    if account is None or account.platform not in {"instagram", "whatsapp"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")

    ticket_service = SupportTicketService(services.db)
    ticket = ticket_service.get_current_ticket(conversation)
    closed_now = False

    try:
        if payload.status == "closed":
            if ticket is not None and ticket.is_open():
                ticket_service.resolve_ticket(
                    ticket,
                    conversation,
                    resolution="unsolved",
                    user_id=user.id,
                    close_reason=payload.close_reason or "Closed by agent",
                )
                closed_now = True
            elif conversation.is_ticket_open():
                conversation.ticket_status = "closed"
                conversation.ticket_closed_at = datetime.now(timezone.utc)
                conversation.awaiting_customer_since = None
                conversation.response_timeout_token = None
                write_session(conversation, clear=True)
                conversation.sales_session = {"step": STEP_IDLE, "menu_sent": True}
                conversation.updated_at = datetime.now(timezone.utc)
                closed_now = True
            if closed_now:
                services.dm_tickets.send_agent_closed_notice(account, conversation)
        else:
            ticket_service.reopen_ticket(account, conversation, user_id=user.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    account_platform = account.platform
    account_ig_id = str(account.instagram_user_id or "")

    services.db.commit()
    services.db.refresh(conversation)

    return {
        "message": "Ticket updated.",
        "data": _conversation_detail(
            conversation,
            account_platform,
            account_ig_id,
            account=account,
            db=services.db,
        ),
    }


class SimulateInboundRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    sender_ig_id: str | None = Field(default=None, max_length=64)
    seed_rule: bool = False


@router.post("/simulate-inbound")
def simulate_inbound(
    payload: SimulateInboundRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    settings = get_settings()
    if not settings.instagram_show_simulate_dm:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")

    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tickets")
    account = next(
        (item for item in _load_messaging_accounts(services, user) if item.platform == "instagram"),
        None,
    )
    if account is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Simulated inbound currently requires an Instagram channel.",
        )

    if payload.seed_rule:
        _seed_greeting_rule(services, account)

    sender_id = payload.sender_ig_id or settings.instagram_simulate_dm_sender_id
    message = services.simulator.ingest(account, sender_id, payload.text)
    services.db.refresh(message.conversation)
    services.db.refresh(message)

    return {
        "message": (
            "Simulated DM stored and auto-reply ran."
            if message.auto_replied
            else "Simulated DM stored. No auto-reply matched."
        ),
        "conversation": _conversation_detail(
            message.conversation,
            account.platform,
            str(account.instagram_user_id or ""),
            account=account,
            db=services.db,
        ),
    }


def _seed_greeting_rule(services: ServiceContainer, account) -> None:
    existing = next(
        (
            rule
            for rule in account.auto_reply_rules
            if (rule.trigger_phrase or "").strip().lower() in {"hi", "hello", "hey"}
            and rule.match_type == "contains"
        ),
        None,
    )
    if existing:
        existing.name = "Friendly greeting"
        existing.trigger_phrase = DEFAULT_GREETING_TRIGGER
        existing.reply_text = DEFAULT_GREETING_REPLY
        existing.is_active = True
        existing.priority = 10
    else:
        services.db.add(
            AutoReplyRule(
                instagram_account_id=account.id,
                name="Friendly greeting",
                match_type="contains",
                trigger_phrase=DEFAULT_GREETING_TRIGGER,
                reply_text=DEFAULT_GREETING_REPLY,
                is_active=True,
                priority=10,
            ),
        )
    services.db.commit()
