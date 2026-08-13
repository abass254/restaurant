"""Merchant fleet rider management."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core.session import (
    login_rider,
    require_user,
    save_session,
    validate_csrf,
)
from app.database import get_db
from app.dependencies import get_request_session
from app.models import Account
from app.services.platform_instagram import require_merchant_account_id
from app.services.rider_invite_email import send_rider_invite_email
from app.services.rider_service import RiderService, RiderServiceError
from app.support.datetime_utils import as_utc
from app.support.merchant_permissions import assert_merchant_section_access

router = APIRouter(prefix="/riders", tags=["riders"])


class RiderCreateRequest(BaseModel):
    name: str = Field(max_length=255)
    phone: str = Field(max_length=32)
    vehicle_type: str | None = Field(default=None, max_length=64)
    notes: str | None = None
    email: EmailStr | None = None
    send_invite_email: bool = False


class RiderUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    vehicle_type: str | None = Field(default=None, max_length=64)
    notes: str | None = None


class RiderOut(BaseModel):
    id: str
    name: str
    phone: str
    email: str | None = None
    status: str
    vehicle_type: str | None
    notes: str | None
    invited_at: datetime | None
    activated_at: datetime | None
    active_deliveries_count: int = 0
    is_online: bool = False
    last_seen_at: datetime | None = None
    last_lat: float | None = None
    last_lng: float | None = None


class RiderInviteOut(BaseModel):
    rider: RiderOut
    invite_url: str
    expires_at: datetime
    email_sent: bool = False


class RiderJoinInfoOut(BaseModel):
    rider_name: str
    merchant_name: str
    phone: str
    email: str | None = None
    already_active: bool
    needs_email: bool = False
    deliveries_url: str


class RiderAcceptRequest(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    email: EmailStr


class RiderEmailUpdateRequest(BaseModel):
    email: EmailStr


def _rider_row(rider, *, active_deliveries_count: int = 0) -> dict:
    return {
        "id": rider.id,
        "name": rider.name,
        "phone": rider.phone,
        "email": rider.email,
        "status": rider.status,
        "vehicle_type": rider.vehicle_type,
        "notes": rider.notes,
        "invited_at": as_utc(rider.invited_at),
        "activated_at": as_utc(rider.activated_at),
        "active_deliveries_count": active_deliveries_count,
        "is_online": bool(getattr(rider, "is_online", False)),
        "last_seen_at": as_utc(getattr(rider, "last_seen_at", None)),
        "last_lat": getattr(rider, "last_lat", None),
        "last_lng": getattr(rider, "last_lng", None),
    }


def _rider_out(row: dict) -> RiderOut:
    return RiderOut(
        id=row["id"],
        name=row["name"],
        phone=row["phone"],
        email=row.get("email"),
        status=row["status"],
        vehicle_type=row.get("vehicle_type"),
        notes=row.get("notes"),
        invited_at=row.get("invited_at"),
        activated_at=row.get("activated_at"),
        active_deliveries_count=int(row.get("active_deliveries_count") or 0),
        is_online=bool(row.get("is_online")),
        last_seen_at=row.get("last_seen_at"),
        last_lat=row.get("last_lat"),
        last_lng=row.get("last_lng"),
    )


@router.get("")
def list_riders(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "delivery")
    account_id = require_merchant_account_id(user)
    rows = RiderService(db).list_riders(account_id)
    return {"data": [_rider_out(row) for row in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_rider_invite(
    payload: RiderCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "delivery")
    account_id = require_merchant_account_id(user)

    email = str(payload.email).strip().lower() if payload.email else None
    if payload.send_invite_email and not email:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Email is required when sending an invite by email.",
        )

    service = RiderService(db)
    try:
        result = service.create_invite(
            account_id,
            name=payload.name,
            phone=payload.phone,
            vehicle_type=payload.vehicle_type,
            notes=payload.notes,
            email=email,
        )
    except RiderServiceError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    email_sent = False
    email_error: str | None = None
    if payload.send_invite_email and email:
        account = db.get(Account, account_id)
        try:
            send_rider_invite_email(
                to_email=email,
                rider_name=payload.name,
                merchant_name=account.business_name if account else "Shop",
                invite_url=result["invite_url"],
            )
            email_sent = True
        except HTTPException as exc:
            detail = exc.detail
            email_error = detail if isinstance(detail, str) else "Could not send email."

    rider = result["rider"]
    if email_sent:
        message = f"Rider invite created and emailed to {email}."
    elif email_error:
        message = f"Rider invite created, but email failed: {email_error}"
    else:
        message = "Rider invite created."
    return {
        "message": message,
        "data": RiderInviteOut(
            rider=_rider_out(_rider_row(rider)),
            invite_url=result["invite_url"],
            expires_at=result["expires_at"],
            email_sent=email_sent,
        ),
    }


@router.post("/{rider_id}/suspend")
def suspend_rider(
    rider_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "delivery")
    account_id = require_merchant_account_id(user)
    service = RiderService(db)
    try:
        rider = service.suspend_rider(account_id, rider_id)
    except RiderServiceError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {"message": "Rider suspended.", "data": _rider_out(_rider_row(rider))}


@router.post("/{rider_id}/email")
def update_rider_email(
    rider_id: str,
    payload: RiderEmailUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "delivery")
    account_id = require_merchant_account_id(user)
    service = RiderService(db)
    try:
        rider = service.set_rider_email(account_id, rider_id, str(payload.email))
    except RiderServiceError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"message": "Rider email updated.", "data": _rider_out(_rider_row(rider))}


@router.post("/{rider_id}/update")
def update_rider_details(
    rider_id: str,
    payload: RiderUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "delivery")
    account_id = require_merchant_account_id(user)
    service = RiderService(db)
    data = payload.model_dump(exclude_unset=True)
    try:
        rider = service.update_rider(
            account_id,
            rider_id,
            name=data.get("name") if "name" in data else None,
            phone=data.get("phone") if "phone" in data else None,
            email=(
                str(data["email"]).strip().lower()
                if "email" in data and data["email"] is not None
                else None
            ),
            vehicle_type=data.get("vehicle_type") if "vehicle_type" in data else None,
            notes=data.get("notes") if "notes" in data else None,
            clear_vehicle_type="vehicle_type" in data
            and not str(data.get("vehicle_type") or "").strip(),
            clear_notes="notes" in data and not str(data.get("notes") or "").strip(),
        )
    except RiderServiceError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return {"message": "Rider details saved.", "data": _rider_out(_rider_row(rider))}


@router.get("/join/{token}")
def describe_rider_invite(token: str, db: Session = Depends(get_db)):
    service = RiderService(db)
    try:
        info = service.get_join_info(token)
    except RiderServiceError as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc)) from exc
    return {"data": RiderJoinInfoOut.model_validate(info)}


@router.post("/join/{token}")
def accept_rider_invite(
    token: str,
    payload: RiderAcceptRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    service = RiderService(db)
    try:
        rider = service.accept_invite(
            token,
            name=payload.name,
            email=str(payload.email).strip().lower(),
        )
    except RiderServiceError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    login_rider(session, rider.id)
    cookie = save_session(request, session)
    response.set_cookie(**cookie)

    account_name = ""
    if rider.account_id:
        account = db.get(Account, rider.account_id)
        account_name = account.business_name if account else ""

    return {
        "message": "Welcome aboard! You can now view your deliveries.",
        "data": {
            "rider_id": rider.id,
            "rider_name": rider.name,
            "merchant_name": account_name,
            "deliveries_url": service._deliveries_url(),
        },
    }
