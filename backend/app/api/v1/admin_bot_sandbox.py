"""Admin-only bot sandbox — test merchant DM bots from the platform console."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.api.v1.admin_auth import require_super_admin
from app.api.v1.settings import SalesAutopilotScriptRequest, _sales_script_payload
from app.api.v1.messages import _conversation_detail
from app.config import get_settings
from app.core.session import validate_csrf
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.models import InstagramAccount, InstagramConversation, User
from app.services.agent_reply_policy import (
    bot_sandbox_allows_free_text,
    platform_bot_is_ai_agent,
)
from app.services.bot_sandbox_context import bot_sandbox_messaging_context
from app.services.bot_sandbox_service import resolve_bot_sandbox_account_for_merchant
from app.services.bot_training_chat_service import BotTrainingChatService
from app.services.dm_chips_only import sandbox_chips_for_account

router = APIRouter(tags=["admin"])


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


def _resolve_account(
    services: ServiceContainer,
    merchant_id: str,
) -> InstagramAccount:
    return resolve_bot_sandbox_account_for_merchant(services, merchant_id)


@router.get("/bot-sandbox")
def admin_get_bot_sandbox(
    merchant_id: str = Query(..., min_length=1, max_length=64),
    services: ServiceContainer = Depends(get_services),
    _: User = Depends(require_super_admin),
):
    settings = get_settings()
    _require_bot_sandbox(settings)
    account = _resolve_account(services, merchant_id)
    sender_id = settings.instagram_simulate_dm_sender_id
    conversation = _find_bot_conversation(account, sender_id)
    uses_ai_agent = platform_bot_is_ai_agent(services.db)

    account_ig_id = str(account.instagram_user_id or "")
    free_messaging = bot_sandbox_allows_free_text(
        conversation,
        uses_ai_agent=uses_ai_agent,
    )

    return {
        "merchant_id": merchant_id,
        "client_sender_id": sender_id,
        "client_username": (conversation.participant_username if conversation else None)
        or "dev_client",
        "auto_replies_enabled": bool(getattr(account, "auto_replies_enabled", True)),
        "chips_only": not free_messaging,
        "free_messaging": free_messaging,
        "available_chips": sandbox_chips_for_account(
            conversation,
            account,
            settings,
            services.dm_agent.tools.catalog,
            uses_ai_agent=uses_ai_agent,
        ),
        "conversation": (
            _conversation_detail(
                conversation,
                account.platform,
                account_ig_id,
                account=account,
                db=services.db,
            )
            if conversation is not None
            else None
        ),
    }


class AdminBotSandboxMessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    client_username: str | None = Field(default=None, max_length=64)
    from_chip: bool = False


@router.post("/bot-sandbox/message")
def admin_bot_sandbox_message(
    payload: AdminBotSandboxMessageRequest,
    request: Request,
    merchant_id: str = Query(..., min_length=1, max_length=64),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
    _: User = Depends(require_super_admin),
):
    validate_csrf(request, session)
    settings = get_settings()
    _require_bot_sandbox(settings)
    account = _resolve_account(services, merchant_id)
    sender_id = settings.instagram_simulate_dm_sender_id

    if payload.client_username:
        conversation = _find_bot_conversation(account, sender_id)
        if conversation is not None:
            username = payload.client_username.strip().lstrip("@")
            if username and not (conversation.participant_username or "").strip():
                conversation.participant_username = username
                services.db.commit()

    conversation = _find_bot_conversation(account, sender_id)
    uses_ai_agent = platform_bot_is_ai_agent(services.db)
    free_messaging = bot_sandbox_allows_free_text(
        conversation,
        uses_ai_agent=uses_ai_agent,
    )

    if not payload.from_chip and not free_messaging:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Bot sandbox is chip-only. Send from_chip=true with a chip label.",
        )

    with bot_sandbox_messaging_context():
        message = services.simulator.ingest(
            account,
            sender_id,
            payload.text,
            simulate_typing=False,
            from_chip=payload.from_chip,
        )
    services.db.refresh(message.conversation)
    services.db.refresh(message)
    account_ig_id = str(account.instagram_user_id or "")

    return {
        "message": "Message sent.",
        "free_messaging": bot_sandbox_allows_free_text(
            message.conversation,
            uses_ai_agent=uses_ai_agent,
        ),
        "available_chips": sandbox_chips_for_account(
            message.conversation,
            account,
            settings,
            services.dm_agent.tools.catalog,
            uses_ai_agent=uses_ai_agent,
        ),
        "conversation": _conversation_detail(
            message.conversation,
            account.platform,
            account_ig_id,
            account=account,
            db=services.db,
        ),
    }


@router.get("/bot-sandbox/script")
def admin_get_bot_sandbox_script(
    merchant_id: str = Query(..., min_length=1, max_length=64),
    services: ServiceContainer = Depends(get_services),
    _: User = Depends(require_super_admin),
):
    settings = get_settings()
    _require_bot_sandbox(settings)
    account = _resolve_account(services, merchant_id)
    return {
        "merchant_id": merchant_id,
        "sales_autopilot_script": _sales_script_payload(account),
    }


@router.patch("/bot-sandbox/script")
def admin_update_bot_sandbox_script(
    payload: SalesAutopilotScriptRequest,
    request: Request,
    merchant_id: str = Query(..., min_length=1, max_length=64),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
    _: User = Depends(require_super_admin),
):
    validate_csrf(request, session)
    settings = get_settings()
    _require_bot_sandbox(settings)
    account = _resolve_account(services, merchant_id)
    checks = account.onboarding_checks if isinstance(account.onboarding_checks, dict) else {}
    checks = dict(checks)
    checks["sales_autopilot_script"] = payload.model_dump()
    account.onboarding_checks = checks
    services.db.commit()
    services.db.refresh(account)
    return {
        "message": "Bot training script updated.",
        "sales_autopilot_script": _sales_script_payload(account),
    }


class AdminBotTrainingChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.get("/bot-sandbox/training-chat")
def admin_get_bot_training_chat(
    merchant_id: str = Query(..., min_length=1, max_length=64),
    services: ServiceContainer = Depends(get_services),
    _: User = Depends(require_super_admin),
):
    settings = get_settings()
    _require_bot_sandbox(settings)
    account = _resolve_account(services, merchant_id)
    coach = BotTrainingChatService(services.db, settings)
    state = coach.get_state(account)
    return {
        "merchant_id": merchant_id,
        "messages": state["messages"],
        "current_instructions": state["current_instructions"],
        "sales_autopilot_script": _sales_script_payload(account),
    }


@router.post("/bot-sandbox/training-chat")
def admin_bot_training_chat(
    payload: AdminBotTrainingChatRequest,
    request: Request,
    merchant_id: str = Query(..., min_length=1, max_length=64),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
    _: User = Depends(require_super_admin),
):
    validate_csrf(request, session)
    settings = get_settings()
    _require_bot_sandbox(settings)
    account = _resolve_account(services, merchant_id)
    coach = BotTrainingChatService(services.db, settings)
    try:
        result = coach.chat(account, payload.text)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return {
        "merchant_id": merchant_id,
        "reply": result["reply"],
        "messages": result["messages"],
        "current_instructions": result["current_instructions"],
        "sales_autopilot_script": _sales_script_payload(account),
    }


@router.post("/bot-sandbox/training-chat/reset")
def admin_reset_bot_training_chat(
    request: Request,
    merchant_id: str = Query(..., min_length=1, max_length=64),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
    _: User = Depends(require_super_admin),
):
    validate_csrf(request, session)
    settings = get_settings()
    _require_bot_sandbox(settings)
    account = _resolve_account(services, merchant_id)
    coach = BotTrainingChatService(services.db, settings)
    coach.clear_history(account)
    services.db.commit()
    return {
        "message": "Training chat cleared.",
        "messages": [],
        "sales_autopilot_script": _sales_script_payload(account),
    }


@router.post("/bot-sandbox/inventory-test")
def admin_test_bot_sandbox_inventory(
    request: Request,
    merchant_id: str = Query(..., min_length=1, max_length=64),
    query: str = Query(default="test", min_length=1, max_length=120),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
    _: User = Depends(require_super_admin),
):
    validate_csrf(request, session)
    settings = get_settings()
    _require_bot_sandbox(settings)
    account = _resolve_account(services, merchant_id)
    merchant_account_id = str(account.account_id or "").strip()
    if not merchant_account_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Shop not configured.")

    from app.services.catalog.factory import resolve_catalog_provider

    provider = resolve_catalog_provider(
        services.db,
        settings,
        merchant_account_id,
        instagram_account=account,
    )
    hits = provider.search(merchant_account_id, query.strip(), limit=5)
    return {
        "ok": True,
        "query": query.strip(),
        "count": len(hits),
        "products": [
            {
                "catalog_item_ref": hit.item.ref,
                "name": hit.item.name,
                "price_kes": hit.item.price_kes,
                "stock": hit.item.stock,
                "source": hit.item.source,
            }
            for hit in hits
        ],
    }


@router.post("/bot-sandbox/reset")
def admin_reset_bot_sandbox(
    request: Request,
    merchant_id: str = Query(..., min_length=1, max_length=64),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
    _: User = Depends(require_super_admin),
):
    validate_csrf(request, session)
    settings = get_settings()
    _require_bot_sandbox(settings)
    account = _resolve_account(services, merchant_id)
    sender_id = settings.instagram_simulate_dm_sender_id
    conversation = _find_bot_conversation(account, sender_id)
    if conversation is None:
        return {"message": "Nothing to reset."}

    conversation.current_support_ticket_id = None
    services.db.flush()
    for ticket in list(conversation.support_tickets):
        services.db.delete(ticket)
    for item in list(conversation.messages):
        services.db.delete(item)
    services.db.delete(conversation)
    services.db.commit()
    return {"message": "Bot sandbox reset."}
