from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.core.session import require_onboarded_user, validate_csrf
from app.support.merchant_permissions import assert_merchant_section_access
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.models import AutoReplyRule
from app.schemas import AutoReplyRuleOut
from app.services.platform_instagram import require_merchant_instagram_account

router = APIRouter(prefix="/auto-reply", tags=["auto-reply"])


@router.get("")
def list_rules(
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tools")
    account = require_merchant_instagram_account(services.db, user)
    rules = sorted(
        account.auto_reply_rules,
        key=lambda item: item.priority,
        reverse=True,
    )
    return {"rules": [AutoReplyRuleOut.model_validate(item) for item in rules]}


class AutoReplyCreateRequest(BaseModel):
    name: str = Field(max_length=120)
    match_type: str = Field(pattern="^(contains|exact|starts_with)$")
    trigger_phrase: str = Field(max_length=255)
    reply_text: str = Field(
        max_length=1000,
        description=(
            "The auto-reply body. Use {username} to mention the customer "
            "(renders as '@their_handle', or 'there' when the handle is unknown)."
        ),
    )
    priority: int | None = Field(default=0, ge=0, le=100)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_rule(
    payload: AutoReplyCreateRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tools")
    account = require_merchant_instagram_account(services.db, user)
    rule = AutoReplyRule(
        instagram_account_id=account.id,
        name=payload.name,
        match_type=payload.match_type,
        trigger_phrase=payload.trigger_phrase,
        reply_text=payload.reply_text,
        priority=payload.priority or 0,
        is_active=True,
    )
    services.db.add(rule)
    services.db.commit()
    services.db.refresh(rule)
    return {
        "message": "Auto-reply rule created.",
        "data": AutoReplyRuleOut.model_validate(rule),
    }


@router.delete("/{rule_id}")
def delete_rule(
    rule_id: str,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tools")
    account = require_merchant_instagram_account(services.db, user)
    rule = _get_rule(services, account.id, rule_id)
    services.db.delete(rule)
    services.db.commit()
    return {"message": "Rule deleted."}


@router.post("/{rule_id}/toggle")
def toggle_rule(
    rule_id: str,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_onboarded_user(services.db, session)
    assert_merchant_section_access(user, "tools")
    account = require_merchant_instagram_account(services.db, user)
    rule = _get_rule(services, account.id, rule_id)
    rule.is_active = not rule.is_active
    services.db.commit()
    services.db.refresh(rule)
    return {
        "message": "Rule updated.",
        "data": AutoReplyRuleOut.model_validate(rule),
    }


def _get_rule(services: ServiceContainer, account_id: str, rule_id: str) -> AutoReplyRule:
    rule = (
        services.db.query(AutoReplyRule)
        .filter(
            AutoReplyRule.id == rule_id,
            AutoReplyRule.instagram_account_id == account_id,
        )
        .first()
    )
    if not rule:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")
    return rule
