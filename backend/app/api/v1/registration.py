from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session, selectinload

from app.core.session import login_user, require_user, save_session, validate_csrf
from app.database import get_db
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.models import User, UserMembership
from app.schemas import build_user_out
from app.services.registration import RegistrationEmailError

router = APIRouter(tags=["registration"])


class RegisterRequest(BaseModel):
    business_name: str = Field(max_length=255)
    business_location: str = Field(max_length=255)
    business_category: str = Field(max_length=100)
    admin_email: EmailStr
    admin_phone: str = Field(max_length=20)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class CreateShopRequest(BaseModel):
    business_name: str = Field(min_length=1, max_length=255)
    business_location: str = Field(min_length=1, max_length=255)
    business_category: str = Field(min_length=1, max_length=100)
    admin_phone: str | None = Field(default=None, max_length=20)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


@router.post("/accounts", status_code=status.HTTP_201_CREATED)
def create_shop(
    payload: CreateShopRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    services: ServiceContainer = Depends(get_services),
):
    """Logged-in merchant creates their shop after signup."""
    validate_csrf(request, session)
    user = require_user(db, session)
    try:
        result = services.registration.create_shop_for_user(
            user,
            {
                "business_name": payload.business_name,
                "business_location": payload.business_location,
                "business_category": payload.business_category,
                "admin_phone": payload.admin_phone,
                "latitude": payload.latitude,
                "longitude": payload.longitude,
            },
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    account = result["account"]
    owner = (
        db.query(User)
        .options(
            selectinload(User.account),
            selectinload(User.instagram_account),
            selectinload(User.memberships).selectinload(UserMembership.account),
        )
        .filter(User.id == user.id)
        .first()
    )
    login_user(session, owner.id, active_account_id=account.id)
    response.set_cookie(**save_session(request, session))
    return {
        "message": "Your shop is ready. Continue setup.",
        "account": {
            "id": account.id,
            "business_name": account.business_name,
            "business_category": account.business_category,
        },
        "is_service_business": False,
        "continue_url": "/onboarding",
        "user": build_user_out(db, owner),
    }


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)

    from app.models import User

    existing = (
        services.db.query(User).filter(User.email == str(payload.admin_email)).first()
    )
    if existing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "The admin email has already been taken.",
                "errors": {"admin_email": ["The admin email has already been taken."]},
            },
        )

    try:
        result = services.registration.register(payload.model_dump())
    except RegistrationEmailError:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=(
                "We couldn't send your welcome email, so no account was created. "
                "Please try again in a moment."
            ),
        )
    user = result["user"]
    account = result["account"]
    email_sent = result.get("email_sent", False)

    # Start an authenticated session so the /onboarding wizard can continue.
    login_user(session, user.id, active_account_id=account.id)
    response.set_cookie(**save_session(request, session))

    if email_sent:
        message = (
            f"Your account is ready. We've sent login instructions to {user.email}."
        )
    else:
        message = (
            f"Your account is ready. Continue setup — we'll also email {user.email} "
            f"when mail is configured."
        )
    return {
        "message": message,
        "account": {
            "id": account.id,
            "business_name": account.business_name,
            "business_category": account.business_category,
        },
        "is_service_business": False,
        "continue_url": "/onboarding",
        "user": build_user_out(services.db, user),
    }
