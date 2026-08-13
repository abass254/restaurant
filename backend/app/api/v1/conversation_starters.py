from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.core.session import require_onboarded_user, validate_csrf
from app.support.merchant_permissions import assert_merchant_section_access
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.models import ConversationStarter
from app.schemas import ConversationStarterOut
from app.services.conversation_starter_service import ConversationStarterService
from app.services.platform_instagram import require_merchant_instagram_account

router = APIRouter(prefix="/conversation-starters", tags=["conversation-starters"])


def _extract_ice_breaker_questions(profile: dict | None) -> list[str]:
    if not profile:
        return []

    questions: list[str] = []
    rows = profile.get("data") or []
    if rows:
        for action in (rows[0].get("ice_breakers") or [{}])[0].get("call_to_actions") or []:
            if action.get("question"):
                questions.append(str(action["question"]))

    if not questions:
        for row in rows:
            for block in row.get("ice_breakers") or []:
                for action in block.get("call_to_actions") or []:
                    if action.get("question"):
                        questions.append(str(action["question"]))
    return questions


def _extract_persistent_menu_titles(profile: dict | None) -> list[str]:
    if not profile:
        return []

    titles: list[str] = []
    for row in profile.get("data") or []:
        for block in row.get("persistent_menu") or []:
            for action in block.get("call_to_actions") or []:
                if action.get("title"):
                    titles.append(str(action["title"]))
    return titles


@router.get("")
def list_starters(
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tools")
    account = require_merchant_instagram_account(services.db, user)
    services.starters.seed_defaults(account)
    services.db.refresh(account)

    instagram_profile = None
    sync_error = None
    webhook_fields: list[str] = []
    connection_warnings: list[str] = []

    try:
        instagram_profile = services.instagram_api.get_messenger_profile(account.access_token())
    except Exception as exc:
        sync_error = str(exc)

    try:
        subs = services.instagram_api.get(
            f"{account.instagram_user_id}/subscribed_apps",
            {"access_token": account.access_token()},
        )
        webhook_fields = (subs.get("data") or [{}])[0].get("subscribed_fields") or []
    except Exception as exc:
        connection_warnings.append(f"Webhook subscription status: {exc}")

    meta_questions = _extract_ice_breaker_questions(instagram_profile)
    meta_menu_titles = _extract_persistent_menu_titles(instagram_profile)
    if not meta_questions:
        connection_warnings.append(
            "No ice breakers on Meta yet — click Push to Instagram to show chips on new DMs.",
        )
    if not meta_menu_titles:
        connection_warnings.append(
            "No persistent menu on Meta yet — Push to Instagram to show chips on existing threads.",
        )
    if "messaging_postbacks" not in webhook_fields:
        connection_warnings.append(
            "Subscribe messaging_postbacks in Meta Dashboard → Webhooks → Instagram.",
        )

    starters = sorted(account.conversation_starters, key=lambda item: item.sort_order)
    return {
        "starters": [ConversationStarterOut.model_validate(item) for item in starters],
        "max_starters": ConversationStarterService.MAX_STARTERS,
        "max_persistent_menu": ConversationStarterService.MAX_PERSISTENT_MENU,
        "max_quick_replies": ConversationStarterService.MAX_QUICK_REPLIES,
        "meta_ice_breaker_questions": meta_questions,
        "meta_persistent_menu_titles": meta_menu_titles,
        "webhook_fields": webhook_fields,
        "connection_warnings": connection_warnings,
        "sync_error": sync_error,
    }


class StarterCreateRequest(BaseModel):
    question: str = Field(max_length=80)
    reply_text: str | None = Field(default=None, max_length=1000)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_starter(
    payload: StarterCreateRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tools")
    account = require_merchant_instagram_account(services.db, user)

    active_count = sum(1 for item in account.conversation_starters if item.is_active)
    if active_count >= ConversationStarterService.MAX_STARTERS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Instagram allows at most {ConversationStarterService.MAX_STARTERS} "
                "conversation starters."
            ),
        )

    starter_payload = ConversationStarterService.make_payload(payload.question)
    if any(item.payload == starter_payload for item in account.conversation_starters):
        starter_payload = f"{starter_payload}_{int(time.time())}"

    sort_order = max((item.sort_order for item in account.conversation_starters), default=-1) + 1
    starter = ConversationStarter(
        instagram_account_id=account.id,
        question=payload.question,
        payload=starter_payload,
        reply_text=payload.reply_text,
        sort_order=sort_order,
        is_active=True,
    )
    services.db.add(starter)
    services.db.commit()
    services.db.refresh(starter)
    return {
        "message": "Starter saved. Push to Instagram to show it in the Instagram app.",
        "data": ConversationStarterOut.model_validate(starter),
    }


@router.delete("/{starter_id}")
def delete_starter(
    starter_id: str,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    starter = _get_starter(services, session, starter_id)
    services.db.delete(starter)
    services.db.commit()
    return {"message": "Starter removed. Push to Instagram to update."}


@router.post("/{starter_id}/toggle")
def toggle_starter(
    starter_id: str,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    starter = _get_starter(services, session, starter_id)
    starter.is_active = not starter.is_active
    services.db.commit()
    services.db.refresh(starter)
    return {
        "message": "Starter updated. Push to Instagram to apply.",
        "data": ConversationStarterOut.model_validate(starter),
    }


@router.post("/sync")
def sync_starters(
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tools")
    account = require_merchant_instagram_account(services.db, user)
    try:
        services.connection.subscribe_webhooks(account)
        services.starters.sync_to_instagram(account)
    except Exception as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not push to Instagram: {exc}",
        ) from exc

    return {
        "message": (
            f"Pushed to Instagram. Chips will appear in new DMs with @{account.username} "
            "and in the persistent menu of existing threads (may take a minute to refresh)."
        ),
    }


def _get_starter(
    services: ServiceContainer,
    session: dict,
    starter_id: str,
) -> ConversationStarter:
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tools")
    account = require_merchant_instagram_account(services.db, user)
    starter = (
        services.db.query(ConversationStarter)
        .filter(
            ConversationStarter.id == starter_id,
            ConversationStarter.instagram_account_id == account.id,
        )
        .first()
    )
    if not starter:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")
    return starter
