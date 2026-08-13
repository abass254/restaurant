from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.session import require_instagram_user, validate_csrf
from app.support.merchant_permissions import active_account_id, assert_merchant_section_access
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.schemas import InstagramAccountOut
from app.services.platform_instagram import get_merchant_instagram_account

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


@router.get("")
def show_onboarding(
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_instagram_user(services.db, session)
    assert_merchant_section_access(user, "tools")
    account = get_merchant_instagram_account(services.db, active_account_id(user))
    if account is None:
        raise RuntimeError("Merchant Instagram account missing")
    checks = services.onboarding.evaluate(account)
    services.db.refresh(account)
    return {
        "account": InstagramAccountOut.from_model(account),
        "checks": checks,
        "help_links": services.settings.instagram_help_links,
        "permissions": services.connection.permission_summary(account),
        "onboarding_complete": account.is_onboarded(),
    }


@router.post("/refresh")
def refresh_onboarding(
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_instagram_user(services.db, session)
    assert_merchant_section_access(user, "tools")
    account = get_merchant_instagram_account(services.db, active_account_id(user))
    if account is None:
        raise RuntimeError("Merchant Instagram account missing")
    try:
        services.connection.subscribe_webhooks(account)
    except Exception:
        pass
    checks = services.onboarding.evaluate(account)
    services.db.refresh(account)
    return {
        "account": InstagramAccountOut.from_model(account),
        "checks": checks,
        "onboarding_complete": account.is_onboarded(),
        "message": (
            "All requirements met. Welcome to your inbox!"
            if account.is_onboarded()
            else "Checklist refreshed."
        ),
    }
