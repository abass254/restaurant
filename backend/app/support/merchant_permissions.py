"""Merchant dashboard section permissions for staff accounts."""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, UserMembership

MERCHANT_SECTIONS: tuple[str, ...] = (
    "dashboard",
    "feeds",
    "tickets",
    "inventory",
    "pos",
    "customer",
    "supplier",
    "orders",
    "delivery",
    "tools",
    "settings",
)

MERCHANT_SECTION_LABELS: dict[str, str] = {
    "dashboard": "Dashboard",
    "feeds": "Feeds",
    "tickets": "Tickets",
    "inventory": "Inventory",
    "pos": "POS",
    "customer": "Customers",
    "supplier": "Suppliers",
    "orders": "Orders",
    "delivery": "Delivery",
    "tools": "Tools",
    "settings": "Settings",
}

RETAIL_STAFF_SECTIONS: tuple[str, ...] = (
    "dashboard",
    "feeds",
    "tickets",
    "inventory",
    "pos",
    "customer",
    "supplier",
    "orders",
    "delivery",
    "tools",
    "settings",
)


def parse_allowed_sections(raw: str | None) -> list[str]:
    if not raw:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for part in raw.split(","):
        key = part.strip().lower()
        if not key or key in seen:
            continue
        if key not in MERCHANT_SECTIONS:
            continue
        seen.add(key)
        out.append(key)
    return out


def serialize_allowed_sections(sections: list[str]) -> str | None:
    cleaned = parse_allowed_sections(",".join(sections))
    return ",".join(cleaned) if cleaned else None


def user_allowed_sections(user: User) -> list[str]:
    if user.is_super_admin():
        return list(MERCHANT_SECTIONS)
    membership = get_active_membership(user)
    if membership is None:
        if user.is_system_admin():
            return list(MERCHANT_SECTIONS)
        return parse_allowed_sections(getattr(user, "allowed_sections", None))
    if normalize_membership_role(membership.role) == "systemadmin":
        return list(MERCHANT_SECTIONS)
    return parse_allowed_sections(getattr(membership, "allowed_sections", None))


def user_can_access_section(user: User, section: str) -> bool:
    key = section.strip().lower()
    if key not in MERCHANT_SECTIONS:
        return False
    if user.is_super_admin():
        return True
    membership = get_active_membership(user)
    if membership and normalize_membership_role(membership.role) == "systemadmin":
        return True
    return key in user_allowed_sections(user)


def normalize_membership_role(value: str | None) -> str:
    if not value:
        return ""
    return (
        value.strip()
        .lower()
        .replace("_", "")
        .replace("-", "")
        .replace(" ", "")
    )


def get_memberships(user: User) -> list[UserMembership]:
    rows = getattr(user, "memberships", None)
    return list(rows) if rows is not None else []


def membership_for_account(user: User, account_id: str) -> UserMembership | None:
    target = str(account_id)
    for membership in get_memberships(user):
        if str(membership.account_id) == target:
            return membership
    return None


def with_active_account_context(user: User, account_id: str) -> User:
    """Pin permission helpers to a specific merchant membership."""
    setattr(user, "_active_account_id", str(account_id))
    return user


def membership_role(user: User, account_id: str | None = None) -> str | None:
    aid = account_id or getattr(user, "_active_account_id", None)
    if aid:
        membership = membership_for_account(user, str(aid))
        if membership is not None:
            return membership.role
    active = get_active_membership(user)
    if active is not None:
        return active.role
    return user.user_role


def is_membership_owner(user: User, account_id: str | None = None) -> bool:
    role = membership_role(user, account_id)
    return normalize_membership_role(role) == "systemadmin"


def get_active_membership(user: User) -> UserMembership | None:
    active_account_id = getattr(user, "_active_account_id", None)
    memberships = get_memberships(user)
    if not memberships:
        return None
    if active_account_id:
        membership = membership_for_account(user, str(active_account_id))
        if membership is not None:
            return membership
    for membership in memberships:
        if bool(membership.is_active):
            return membership
    return memberships[0]


def require_active_membership(user: User) -> UserMembership:
    membership = get_active_membership(user)
    if membership is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "code": "merchant_membership_required",
                "message": "This action requires a merchant membership.",
            },
        )
    return membership


def active_account_id(user: User) -> str:
    membership = require_active_membership(user)
    return str(membership.account_id)


def require_merchant_admin(user: User) -> User:
    membership = require_active_membership(user)
    if normalize_membership_role(membership.role) != "systemadmin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only the shop owner can manage staff.",
        )
    return user


def require_merchant_section(section: str):
    """FastAPI dependency factory — gate an endpoint by dashboard section."""
    from app.core.session import require_user
    from app.dependencies import get_request_session

    def _dependency(
        db: Session = Depends(get_db),
        session: dict = Depends(get_request_session),
    ) -> User:
        user = require_user(db, session)
        assert_merchant_section_access(user, section)
        return user

    return _dependency


def assert_merchant_section_access(user: User, section: str) -> None:
    require_active_membership(user)
    if not user_can_access_section(user, section):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"You do not have access to {MERCHANT_SECTION_LABELS.get(section, section)}.",
        )


def user_can_access_any_section(user: User, *sections: str) -> bool:
    return any(user_can_access_section(user, section) for section in sections)


def assert_merchant_section_any_access(user: User, *sections: str) -> None:
    require_active_membership(user)
    if not user_can_access_any_section(user, *sections):
        labels = [MERCHANT_SECTION_LABELS.get(s, s) for s in sections]
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"You do not have access to {', '.join(labels)}.",
        )


def require_merchant_section_any(*sections: str):
    """FastAPI dependency factory — user must have access to at least one section."""
    from app.core.session import require_user
    from app.dependencies import get_request_session

    def _dependency(
        db: Session = Depends(get_db),
        session: dict = Depends(get_request_session),
    ) -> User:
        user = require_user(db, session)
        assert_merchant_section_any_access(user, *sections)
        return user

    return _dependency


def require_onboarded_merchant_section(section: str):
    from app.core.session import require_onboarded_user
    from app.dependencies import get_request_session

    def _dependency(
        db: Session = Depends(get_db),
        session: dict = Depends(get_request_session),
    ) -> User:
        user = require_onboarded_user(db, session)
        assert_merchant_section_access(user, section)
        return user

    return _dependency


def require_onboarded_merchant_section_any(*sections: str):
    from app.core.session import require_onboarded_user
    from app.dependencies import get_request_session

    def _dependency(
        db: Session = Depends(get_db),
        session: dict = Depends(get_request_session),
    ) -> User:
        user = require_onboarded_user(db, session)
        assert_merchant_section_any_access(user, *sections)
        return user

    return _dependency
