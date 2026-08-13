"""Lookup helpers for inviting users to a merchant."""

from __future__ import annotations

from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from fastapi import HTTPException, status

from app.models import User, UserMembership


class UserInviteLookupOut(BaseModel):
    found: bool
    user_id: str | None = None
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    already_member: bool = False
    invite_blocked: bool = False
    invite_blocked_reason: str | None = None


def lookup_user_for_merchant_invite(
    db: Session,
    email: str,
    account_id: str,
) -> UserInviteLookupOut:
    normalized = (email or "").strip().lower()
    if not normalized or "@" not in normalized:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter a valid email address.",
        )

    user = db.query(User).filter(func.lower(User.email) == normalized).first()
    if user is None:
        return UserInviteLookupOut(found=False)

    if user.is_super_admin():
        return UserInviteLookupOut(
            found=True,
            user_id=user.id,
            name=user.name,
            email=user.email,
            phone=user.phone,
            invite_blocked=True,
            invite_blocked_reason=(
                "Platform admin accounts cannot be added as shop staff."
            ),
        )

    membership = (
        db.query(UserMembership)
        .filter(
            UserMembership.user_id == user.id,
            UserMembership.account_id == account_id,
        )
        .first()
    )
    already_member = membership is not None and bool(membership.is_active)

    return UserInviteLookupOut(
        found=True,
        user_id=user.id,
        name=user.name,
        email=user.email,
        phone=user.phone,
        already_member=already_member,
    )
