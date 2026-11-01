from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.core.password_reset_tokens import (
    PasswordResetTokenInvalid,
    password_fingerprint,
    read_password_reset_token,
)
from app.core.security import hash_password, verify_password
from app.core.session import (
    get_active_account_id,
    login_user,
    logout_user,
    require_user,
    save_session,
    set_active_account_id,
    validate_csrf,
)
from app.core import auth_throttle
from app.database import get_db
from app.dependencies import get_request_session
from app.models import User, UserMembership
from app.schemas import UserOut, build_user_out
from app.services.merchant_login_otp import (
    LOGIN_CODE_LENGTH,
    MerchantLoginOtpService,
    MerchantOtpError,
)
from app.services.password_reset_service import request_password_reset

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class OtpRequestCodeIn(BaseModel):
    """Request a login code via email or phone."""

    identifier: str = Field(min_length=3, max_length=255)


class OtpVerifyCodeIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=255)
    code: str = Field(min_length=LOGIN_CODE_LENGTH, max_length=LOGIN_CODE_LENGTH)


class SignupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    phone: str | None = Field(default=None, max_length=20)
    business_name: str | None = Field(default=None, min_length=1, max_length=255)
    business_location: str | None = Field(default=None, min_length=1, max_length=255)
    business_category: str | None = Field(default=None, min_length=1, max_length=100)
    store_type: str | None = Field(default=None, min_length=1, max_length=32)


class AdminLoginRequest(BaseModel):
    """Username + password login used by the platform admin console.

    Kept separate from :class:`LoginRequest` because admin accounts don't
    have an email address attached: they're identified by ``username``.
    """

    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1)


class SwitchMerchantRequest(BaseModel):
    account_id: str = Field(min_length=1)


def _default_active_account_id(user: User) -> str | None:
    memberships = list(getattr(user, "memberships", []) or [])
    if not memberships:
        return None
    active = next((m for m in memberships if bool(m.is_active)), memberships[0])
    return str(active.account_id)


@router.post("/login", response_model=UserOut)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    auth_throttle.throttle_login(request, payload.email)
    user = (
        db.query(User)
        .options(
            selectinload(User.account),
            selectinload(User.instagram_account),
            selectinload(User.memberships).selectinload(UserMembership.account),
        )
        .filter(User.email == str(payload.email))
        .first()
    )

    if not user or not user.password or not verify_password(payload.password, user.password):
        auth_throttle.record_login_failure(str(payload.email))
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "message": "These credentials do not match our records.",
                "errors": {"email": ["These credentials do not match our records."]},
            },
        )

    if not user.is_activated:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "message": "This account is not activated yet.",
                "errors": {"email": ["This account is not activated yet."]},
            },
        )

    login_user(
        session,
        user.id,
        active_account_id=_default_active_account_id(user),
    )
    auth_throttle.record_login_success(str(payload.email))
    response.set_cookie(**save_session(request, session))
    return build_user_out(db, user)


@router.post("/request-code")
def request_login_code(
    payload: OtpRequestCodeIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Send (or issue) a 6-digit OTP for merchant dashboard sign-in."""
    validate_csrf(request, session)
    auth_throttle.throttle_otp_request(request, payload.identifier)

    try:
        result = MerchantLoginOtpService(db).request_login_code(
            identifier=payload.identifier,
        )
    except MerchantOtpError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return result


@router.post("/verify-code", response_model=UserOut)
def verify_login_code(
    payload: OtpVerifyCodeIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Verify a merchant OTP and create a dashboard session."""
    validate_csrf(request, session)
    auth_throttle.throttle_otp_verify(request, payload.identifier)

    try:
        user = MerchantLoginOtpService(db).verify_login_code(
            identifier=payload.identifier,
            code=payload.code,
        )
    except MerchantOtpError as exc:
        auth_throttle.record_otp_verify_failure(payload.identifier)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    login_user(
        session,
        user.id,
        active_account_id=_default_active_account_id(user),
    )
    auth_throttle.record_otp_verify_success(payload.identifier)
    response.set_cookie(**save_session(request, session))
    return build_user_out(db, user)


@router.post("/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def signup(
    payload: SignupRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Create a merchant user account (no shop yet)."""
    validate_csrf(request, session)
    email = str(payload.email).strip().lower()
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "An account with this email already exists.",
                "errors": {"email": ["An account with this email already exists."]},
            },
        )

    shop_fields = (
        payload.business_name,
        payload.business_location,
        payload.business_category,
        payload.store_type,
    )
    shop = None
    if any(value is not None for value in shop_fields):
        if any(value is None for value in shop_fields):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Complete all business details to create a shop account.",
            )
        shop = {
            "business_name": payload.business_name,
            "business_location": payload.business_location,
            "business_category": payload.business_category,
            "store_type": payload.store_type,
            "admin_phone": payload.phone,
        }

    from app.services.registration import BusinessRegistrationService

    try:
        user = BusinessRegistrationService(db).signup_user(
            name=payload.name,
            email=email,
            password=payload.password,
            phone=payload.phone,
            shop=shop,
        )
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    user = (
        db.query(User)
        .options(
            selectinload(User.account),
            selectinload(User.instagram_account),
            selectinload(User.memberships).selectinload(UserMembership.account),
        )
        .filter(User.id == user.id)
        .first()
    )
    login_user(
        session,
        user.id,
        active_account_id=_default_active_account_id(user),
    )
    response.set_cookie(**save_session(request, session))
    return build_user_out(db, user)


@router.get("/signup-options")
def signup_options():
    """Public flags for the signup UI (e.g. whether Google is configured)."""
    settings = get_settings()
    google = bool(
        settings.google_oauth_client_id.strip()
        and settings.google_oauth_client_secret.strip()
        and settings.google_oauth_redirect_uri.strip()
    )
    return {"google": google}


@router.post("/admin/login", response_model=UserOut)
def admin_login(
    payload: AdminLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Log in a super_admin via username/password.

    Only ``user_role == "super_admin"`` accounts may use this endpoint —
    a merchant user who happens to also have a username set still has to
    sign in through the regular merchant login.
    """
    validate_csrf(request, session)
    auth_throttle.throttle_login(request, payload.username)

    user = (
        db.query(User)
        .options(selectinload(User.memberships).selectinload(UserMembership.account))
        .filter(User.username == payload.username.strip())
        .first()
    )

    if not user or not verify_password(payload.password, user.password):
        auth_throttle.record_login_failure(payload.username)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "message": "These credentials do not match our records.",
                "errors": {
                    "username": ["These credentials do not match our records."],
                },
            },
        )

    if not user.is_super_admin():
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={
                "message": "This account is not authorized for the admin console.",
                "errors": {
                    "username": [
                        "This account is not authorized for the admin console.",
                    ],
                },
            },
        )

    if not user.is_activated:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "message": "This account is not activated yet.",
                "errors": {"username": ["This account is not activated yet."]},
            },
        )

    login_user(session, user.id, active_account_id=_default_active_account_id(user))
    auth_throttle.record_login_success(payload.username)
    response.set_cookie(**save_session(request, session))
    return build_user_out(db, user)


@router.get("/user", response_model=UserOut)
def current_user(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    response.set_cookie(**save_session(request, session))
    return build_user_out(db, user)


@router.post("/switch-merchant", response_model=UserOut)
def switch_merchant(
    payload: SwitchMerchantRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    memberships = list(getattr(user, "memberships", []) or [])
    target = next(
        (
            membership
            for membership in memberships
            if str(membership.account_id) == str(payload.account_id) and bool(membership.is_active)
        ),
        None,
    )
    if target is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="You do not belong to that merchant account.",
        )
    set_active_account_id(session, str(target.account_id))
    response.set_cookie(**save_session(request, session))
    refreshed = require_user(db, session)
    return build_user_out(db, refreshed)


@router.post("/session/refresh")
def refresh_session(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Re-issue the session cookie to extend the signed session lifetime."""
    validate_csrf(request, session)
    require_user(db, session)
    response.set_cookie(**save_session(request, session))
    return {"message": "Session refreshed."}


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    logout_user(session)
    response.set_cookie(**save_session(request, session))
    return {"message": "Logged out."}


class ChangePasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=72)


class ChangePasswordResponse(BaseModel):
    message: str


@router.post("/change-password", response_model=ChangePasswordResponse)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Set a new password while logged in (required after staff onboarding)."""
    validate_csrf(request, session)
    user = require_user(db, session)
    if not user.require_change_password:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Your account does not require a password change.",
        )

    user.password = hash_password(payload.password)
    user.require_change_password = False
    user.updated_at = datetime.utcnow()
    db.add(user)
    db.commit()
    return ChangePasswordResponse(
        message="Your password has been updated.",
    )


# --- Self-serve forgot password + token reset -----------------------------


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str
    reset_link: str | None = None


class PasswordResetInfoOut(BaseModel):
    """Minimal account info so the reset page can confirm who it's for."""

    email: str | None
    name: str


class PasswordResetRequest(BaseModel):
    token: str = Field(min_length=1)
    password: str = Field(min_length=8, max_length=72)


class PasswordResetResponse(BaseModel):
    message: str


def _resolve_reset_token(db: Session, token: str) -> User:
    """Validate a reset token and return the user, or raise HTTP 400.

    Enforces single-use by comparing the token's password fingerprint against
    the user's current password hash: once the password changes (or a newer
    link is minted) the fingerprint no longer matches.
    """
    try:
        data = read_password_reset_token(token)
    except PasswordResetTokenInvalid as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))

    user = db.query(User).filter(User.id == data["uid"]).first()
    if user is None or password_fingerprint(user.password) != data["fp"]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                "This password reset link has already been used or is no longer "
                "valid. Request a new one from the forgot password page."
            ),
        )
    return user


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Email a password reset link when the address matches an active account.

    The response is the same whether or not the email exists, to avoid account
    enumeration. ``reset_link`` is only populated in debug when mail is not
    delivered, so local development can still complete the flow.
    """
    validate_csrf(request, session)
    return ForgotPasswordResponse(**request_password_reset(db, str(payload.email)))


@router.get("/password-reset", response_model=PasswordResetInfoOut)
def password_reset_info(
    token: str,
    db: Session = Depends(get_db),
):
    """Validate a reset link and return the account it belongs to."""
    user = _resolve_reset_token(db, token)
    return PasswordResetInfoOut(email=user.email, name=user.name)


@router.post("/password-reset", response_model=PasswordResetResponse)
def password_reset(
    payload: PasswordResetRequest,
    db: Session = Depends(get_db),
):
    """Set a new password using a valid reset link."""
    user = _resolve_reset_token(db, payload.token)
    user.password = hash_password(payload.password)
    user.require_change_password = False
    user.updated_at = datetime.utcnow()
    db.add(user)
    db.commit()
    return PasswordResetResponse(
        message="Your password has been set. You can now sign in.",
    )
