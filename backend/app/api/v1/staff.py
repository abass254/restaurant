"""Merchant staff user management (shop owner only)."""

from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.password_reset_tokens import mint_password_reset_token
from app.core.security import hash_password
from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import Account, User, UserMembership
from app.services.email_service import EmailService
from app.services.email_templates import render_branded_email
from app.services.merchant_invite_email import (
    send_merchant_access_granted_email,
    send_merchant_user_invite_email,
)
from app.support.merchant_permissions import (
    active_account_id,
    MERCHANT_SECTION_LABELS,
    RETAIL_STAFF_SECTIONS,
    membership_role,
    parse_allowed_sections,
    require_merchant_admin,
    serialize_allowed_sections,
    user_allowed_sections,
    with_active_account_context,
    is_membership_owner,
)
from app.support.user_invite_lookup import UserInviteLookupOut, lookup_user_for_merchant_invite

router = APIRouter(prefix="/staff", tags=["staff"])

_TEMP_PASSWORD_ALPHABET = (
    "".join(c for c in string.ascii_uppercase if c not in "OI")
    + "".join(c for c in string.ascii_lowercase if c not in "l")
    + "".join(c for c in string.digits if c not in "01")
)


def _generate_temp_password(length: int = 12) -> str:
    return "".join(secrets.choice(_TEMP_PASSWORD_ALPHABET) for _ in range(length))


class MerchantSectionOut(BaseModel):
    key: str
    label: str


class StaffUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    email: str | None
    phone: str | None
    user_role: str | None
    is_activated: bool
    require_change_password: bool
    allowed_sections: list[str]
    created_at: datetime | None = None


class StaffListResponse(BaseModel):
    data: list[StaffUserOut]
    total: int
    sections: list[MerchantSectionOut]


class StaffCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=20)
    password: str | None = Field(default=None, max_length=72)
    allowed_sections: list[str] = Field(min_length=1)
    require_change_password: bool = True
    send_invite_email: bool = False


class StaffUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=20)
    is_activated: bool | None = None
    allowed_sections: list[str] | None = None


class StaffPasswordIn(BaseModel):
    password: str = Field(min_length=8, max_length=72)
    require_change_password: bool = True


class StaffActionResponse(BaseModel):
    message: str
    data: StaffUserOut
    existing_user: bool = False


class StaffPasswordResponse(BaseModel):
    message: str
    user_id: str
    require_change_password: bool


def _staff_out(user: User, account_id: str) -> StaffUserOut:
    with_active_account_context(user, account_id)
    return StaffUserOut(
        id=user.id,
        name=user.name,
        email=user.email,
        phone=user.phone,
        user_role=membership_role(user, account_id),
        is_activated=bool(user.is_activated),
        require_change_password=bool(user.require_change_password),
        allowed_sections=user_allowed_sections(user),
        created_at=user.created_at,
    )


def _account_staff_query(db: Session, account_id: str):
    return (
        db.query(User)
        .join(UserMembership, UserMembership.user_id == User.id)
        .filter(
            UserMembership.account_id == account_id,
            UserMembership.is_active.is_(True),
        )
        .order_by(
            UserMembership.role == "system_admin",
            User.created_at.is_(None),
            User.created_at.asc(),
            User.id.asc(),
        )
    )


def _get_staff_member(db: Session, account_id: str, user_id: str) -> User:
    user = (
        db.query(User)
        .join(UserMembership, UserMembership.user_id == User.id)
        .filter(
            User.id == user_id,
            UserMembership.account_id == account_id,
            UserMembership.is_active.is_(True),
        )
        .first()
    )
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Staff member not found.")
    return user


def _ensure_staff_role(user: User, account_id: str) -> None:
    if is_membership_owner(user, account_id):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="The shop owner account cannot be changed here.",
        )


@router.get("/lookup", response_model=UserInviteLookupOut)
def lookup_staff_invite(
    email: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    actor = require_user(db, session)
    require_merchant_admin(actor)
    return lookup_user_for_merchant_invite(db, email, active_account_id(actor))


@router.get("", response_model=StaffListResponse)
def list_staff(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    actor = require_user(db, session)
    require_merchant_admin(actor)
    account_id = active_account_id(actor)
    rows = _account_staff_query(db, account_id).all()
    sections = [
        MerchantSectionOut(key=key, label=MERCHANT_SECTION_LABELS[key])
        for key in RETAIL_STAFF_SECTIONS
    ]
    return StaffListResponse(
        data=[_staff_out(row, account_id) for row in rows],
        total=len(rows),
        sections=sections,
    )


@router.post("", response_model=StaffActionResponse)
def create_staff(
    payload: StaffCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    actor = require_user(db, session)
    require_merchant_admin(actor)

    email = str(payload.email).strip().lower()
    existing_user = db.query(User).filter(func.lower(User.email) == email).first()

    allowed = serialize_allowed_sections(payload.allowed_sections)
    if not allowed:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Select at least one section for this staff member.",
        )

    now = datetime.now(timezone.utc)
    account_id = active_account_id(actor)
    is_existing_user = existing_user is not None
    user = existing_user
    if user is None:
        password = (payload.password or "").strip()
        if len(password) < 8:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A temporary password is required for new team members.",
            )
        user = User(
            account_id=account_id,
            name=payload.name.strip(),
            email=email,
            phone=(payload.phone.strip() if payload.phone else None),
            password=hash_password(password),
            user_role="staff",
            allowed_sections=allowed,
            is_activated=True,
            require_change_password=payload.require_change_password,
            created_at=now,
            updated_at=now,
        )
        db.add(user)
        db.flush()
    else:
        if payload.name.strip():
            user.name = payload.name.strip()
        if payload.phone is not None:
            user.phone = payload.phone.strip() or None
        user.updated_at = now
        db.add(user)
    membership = (
        db.query(UserMembership)
        .filter(
            UserMembership.user_id == user.id,
            UserMembership.account_id == account_id,
        )
        .first()
    )
    if membership is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="That email already belongs to this merchant.",
        )
    db.add(
        UserMembership(
            user_id=user.id,
            account_id=account_id,
            role="staff",
            allowed_sections=allowed,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()
    db.refresh(user)

    message = (
        "Existing user added to your team. They can sign in with their current password."
        if is_existing_user
        else "Staff member created successfully."
    )
    if payload.send_invite_email:
        account = db.get(Account, account_id)
        if account is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                detail="Merchant account not found.",
            )
        if is_existing_user:
            send_merchant_access_granted_email(db, user, account)
            message = (
                f"Existing user added. Access notification sent to {user.email}."
            )
        else:
            send_merchant_user_invite_email(db, user)
            message = f"Staff member created. Setup email sent to {user.email}."

    return StaffActionResponse(
        message=message,
        data=_staff_out(user, account_id),
        existing_user=is_existing_user,
    )


@router.patch("/{user_id}", response_model=StaffActionResponse)
def update_staff(
    user_id: str,
    payload: StaffUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    actor = require_user(db, session)
    require_merchant_admin(actor)

    user = _get_staff_member(db, active_account_id(actor), user_id)
    _ensure_staff_role(user, active_account_id(actor))

    if payload.name is not None:
        user.name = payload.name.strip()
    if payload.phone is not None:
        user.phone = payload.phone.strip() or None
    if payload.is_activated is not None:
        user.is_activated = payload.is_activated
    if payload.allowed_sections is not None:
        allowed = serialize_allowed_sections(payload.allowed_sections)
        if not allowed:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Select at least one section for this staff member.",
            )
        membership = (
            db.query(UserMembership)
            .filter(
                UserMembership.user_id == user.id,
                UserMembership.account_id == active_account_id(actor),
            )
            .first()
        )
        if membership is not None:
            membership.allowed_sections = allowed

    user.updated_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()
    db.refresh(user)

    return StaffActionResponse(
        message="Staff member updated successfully.",
        data=_staff_out(user, active_account_id(actor)),
    )


@router.delete("/{user_id}")
def remove_staff(
    user_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    actor = require_user(db, session)
    require_merchant_admin(actor)

    if user_id == actor.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove your own account.",
        )

    user = _get_staff_member(db, active_account_id(actor), user_id)
    _ensure_staff_role(user, active_account_id(actor))

    membership = (
        db.query(UserMembership)
        .filter(
            UserMembership.user_id == user.id,
            UserMembership.account_id == active_account_id(actor),
        )
        .first()
    )
    if membership is not None:
        db.delete(membership)
    db.commit()
    return {"message": "Staff member removed."}


@router.post("/{user_id}/password", response_model=StaffPasswordResponse)
def reset_staff_password(
    user_id: str,
    payload: StaffPasswordIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    actor = require_user(db, session)
    require_merchant_admin(actor)

    user = _get_staff_member(db, active_account_id(actor), user_id)
    _ensure_staff_role(user, active_account_id(actor))

    user.password = hash_password(payload.password)
    user.require_change_password = payload.require_change_password
    user.updated_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    return StaffPasswordResponse(
        message="Password updated successfully.",
        user_id=user.id,
        require_change_password=user.require_change_password,
    )


@router.post("/{user_id}/password/reset-link", response_model=StaffPasswordResponse)
def send_staff_password_reset_link(
    user_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    actor = require_user(db, session)
    require_merchant_admin(actor)

    user = _get_staff_member(db, active_account_id(actor), user_id)
    _ensure_staff_role(user, active_account_id(actor))
    if not user.email:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="This user has no email address on file.",
        )

    service = EmailService()
    if not service.settings.mail_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email sending is disabled.",
        )
    if not service.configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mail provider is not configured.",
        )

    temp_password = _generate_temp_password()
    user.password = hash_password(temp_password)
    user.require_change_password = True
    user.updated_at = datetime.now(timezone.utc)

    token = mint_password_reset_token(user.id, user.password)
    frontend_url = get_settings().frontend_url.rstrip("/")
    reset_link = f"{frontend_url}/reset-password?token={token}"

    html = render_branded_email(
        title="Reset your TransChap password",
        heading="Set a new password for your TransChap account",
        intro=(
            "Your shop owner created a temporary password for your account. "
            "Use the button below to choose your own password."
        ),
        paragraphs=[
            "For your security, set a new password right away. "
            "This link expires in 3 days.",
        ],
        details=[
            ("Email", user.email),
            ("Temporary password", temp_password),
        ],
        cta_label="Set your password",
        cta_url=reset_link,
    )
    sent = service.send_email(
        to=user.email,
        to_name=user.name,
        subject="Reset your TransChap staff account password",
        text=(
            f"Hi {user.name},\n\n"
            "Your shop owner reset your TransChap password.\n\n"
            f"Email: {user.email}\n"
            f"Temporary password: {temp_password}\n\n"
            f"Set your own password here: {reset_link}\n\n"
            "The password setup link expires in 3 days."
        ),
        html=html,
        category="password-reset",
    )
    if not sent:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not send the reset email.",
        )

    db.add(user)
    db.commit()

    return StaffPasswordResponse(
        message="Reset email sent successfully.",
        user_id=user.id,
        require_change_password=True,
    )
