"""Bot reply modeler — isolated preview account per merchant (no live Instagram)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session, joinedload

from app.dependencies import ServiceContainer
from app.models import Account, InstagramAccount, InstagramConversation, User, UserMembership
from app.services.bot_sandbox_context import SANDBOX_LOGIN_PROVIDER
from app.services.platform_instagram import (
    BOT_PLATFORM,
    get_merchant_bot_preview_account,
    require_merchant_account_id,
)
from fastapi import HTTPException, status


def _preview_external_id(merchant_id: str) -> str:
    return f"bot_preview_{merchant_id}"


def _load_account_with_relations(db: Session, account_id: str) -> InstagramAccount | None:
    return (
        db.query(InstagramAccount)
        .options(
            joinedload(InstagramAccount.conversations).joinedload(InstagramConversation.messages),
            joinedload(InstagramAccount.auto_reply_rules),
        )
        .filter(
            InstagramAccount.id == account_id,
            InstagramAccount.platform == BOT_PLATFORM,
        )
        .first()
    )


def _create_bot_preview_account(
    services: ServiceContainer,
    merchant_id: str,
    owner_user_id: str,
) -> InstagramAccount:
    now = datetime.now(timezone.utc)
    account = InstagramAccount(
        user_id=owner_user_id,
        account_id=merchant_id,
        platform=BOT_PLATFORM,
        login_provider=SANDBOX_LOGIN_PROVIDER,
        instagram_user_id=_preview_external_id(merchant_id),
        username="bot_preview",
        name="Bot preview",
        user_access_token="",
        onboarding_complete=True,
        auto_replies_enabled=True,
        created_at=now,
        updated_at=now,
    )
    services.db.add(account)
    services.db.flush()

    try:
        services.starters.seed_defaults(account)
    except Exception:
        pass

    try:
        services.auto_reply.seed_default_greeting_rule(account)
    except Exception:
        pass

    services.db.commit()
    loaded = _load_account_with_relations(services.db, account.id)
    if loaded is None:
        services.db.refresh(account)
        return account
    return loaded


def _owner_user_id_for_merchant(db: Session, merchant_id: str) -> str:
    user = (
        db.query(User.id)
        .join(UserMembership, UserMembership.user_id == User.id)
        .filter(
            UserMembership.account_id == merchant_id,
            UserMembership.is_active.is_(True),
        )
        .order_by(User.created_at.asc(), User.id.asc())
        .first()
    )
    if user is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Merchant has no users to attach a bot preview to.",
        )
    return str(user[0])


def resolve_bot_sandbox_account_for_merchant(
    services: ServiceContainer,
    merchant_id: str,
) -> InstagramAccount:
    """Return (or create) the bot preview channel for ``merchant_id``."""
    existing = get_merchant_bot_preview_account(services.db, merchant_id)
    if existing is not None:
        loaded = _load_account_with_relations(services.db, existing.id)
        return loaded or existing

    merchant = services.db.get(Account, merchant_id)
    if merchant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Merchant not found.")

    owner_id = _owner_user_id_for_merchant(services.db, merchant_id)
    return _create_bot_preview_account(services, merchant_id, owner_id)


def resolve_bot_sandbox_account(services: ServiceContainer, user: User) -> InstagramAccount:
    """Return the merchant's dedicated bot preview row (never the live Instagram channel)."""
    merchant_id = require_merchant_account_id(user)
    existing = get_merchant_bot_preview_account(services.db, merchant_id)
    if existing is not None:
        loaded = _load_account_with_relations(services.db, existing.id)
        return loaded or existing

    return _create_bot_preview_account(services, merchant_id, user.id)
