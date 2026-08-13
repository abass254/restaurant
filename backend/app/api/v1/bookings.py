"""Merchant booking setup + public booking page APIs."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import (
    Account,
    Booking,
    BookingProvider,
    BookingSettings,
    BookingWeeklyHours,
    InventoryItem,
    MpesaTransaction,
)
from app.services import booking_service as svc
from app.services import mpesa_service
from app.services.mpesa_service import MpesaApiError
from app.support.merchant_permissions import (
    active_account_id,
    assert_merchant_section_access,
    assert_merchant_section_any_access,
)

router = APIRouter(tags=["bookings"])

_SLUG_VALID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _shop_id(user) -> str:
    return str(active_account_id(user))


# ---- payloads -------------------------------------------------------------


class BookingSettingsUpdate(BaseModel):
    booking_slug: str | None = Field(default=None, max_length=80)
    header_text: str | None = Field(default=None, max_length=255)
    brand_color: str | None = Field(default=None, max_length=16)
    deposit_type: Literal["none", "fixed", "percent", "full"] | None = None
    deposit_amount: float | None = Field(default=None, ge=0, le=99_999_999)
    deposit_percent: float | None = Field(default=None, ge=0, le=100)
    min_notice_minutes: int | None = Field(default=None, ge=0, le=7 * 24 * 60)
    timezone: str | None = Field(default=None, max_length=64)
    go_live: bool | None = None


class ProviderCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=255)
    role: str | None = Field(default=None, max_length=120)
    bio: str | None = Field(default=None, max_length=2000)
    photo_url: str | None = Field(default=None, max_length=1024)
    inventory_item_ids: list[str] = Field(default_factory=list)
    sort_order: int = 0


class ProviderUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    role: str | None = Field(default=None, max_length=120)
    bio: str | None = Field(default=None, max_length=2000)
    photo_url: str | None = Field(default=None, max_length=1024)
    is_active: bool | None = None
    inventory_item_ids: list[str] | None = None
    sort_order: int | None = None


class HoursDay(BaseModel):
    weekday: int = Field(ge=0, le=6)
    open_time: str = Field(default="09:00", max_length=5)
    close_time: str = Field(default="17:00", max_length=5)
    is_closed: bool = False
    provider_id: str | None = None


class HoursReplace(BaseModel):
    days: list[HoursDay]


class PublicBookingCreate(BaseModel):
    inventory_item_id: str
    provider_id: str | None = None
    starts_at: str  # ISO local naive
    customer_name: str = Field(min_length=1, max_length=255)
    customer_phone: str = Field(min_length=7, max_length=32)
    notes: str | None = Field(default=None, max_length=2000)


class AppointmentPatch(BaseModel):
    status: Literal["confirmed", "completed", "cancelled", "no_show"] | None = None
    notes: str | None = Field(default=None, max_length=2000)


class AppointmentReschedule(BaseModel):
    starts_at: str
    provider_id: str | None = None


class AppointmentCreate(BaseModel):
    inventory_item_id: str
    provider_id: str | None = None
    starts_at: str
    customer_name: str = Field(min_length=1, max_length=255)
    customer_phone: str = Field(min_length=7, max_length=32)
    notes: str | None = Field(default=None, max_length=2000)


class PublicDepositPayBody(BaseModel):
    public_token: str = Field(min_length=8, max_length=64)
    phone_number: str | None = Field(default=None, max_length=32)


# ---- authenticated --------------------------------------------------------


@router.get("/booking/settings")
def get_booking_settings(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "settings", "appointments", "schedule")
    account_id = _shop_id(user)
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Shop not found.")
    row = svc.ensure_booking_settings(db, account)
    db.commit()
    readiness = svc.booking_readiness(db, row)
    return {
        "settings": svc.settings_out(row, readiness=readiness),
        "is_service_business": svc.is_service_business(account.business_category),
    }


@router.patch("/booking/settings")
def update_booking_settings(
    payload: BookingSettingsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "settings", "schedule")
    account_id = _shop_id(user)
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Shop not found.")
    row = svc.ensure_booking_settings(db, account)

    if payload.booking_slug is not None:
        slug = svc.slugify_booking(payload.booking_slug)
        if not _SLUG_VALID.match(slug):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Slug must be lowercase letters, numbers, and hyphens.",
            )
        clash = (
            db.query(BookingSettings)
            .filter(
                BookingSettings.booking_slug == slug,
                BookingSettings.account_id != account_id,
            )
            .first()
        )
        if clash:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="That booking link is already taken.",
            )
        row.booking_slug = slug

    for field in (
        "header_text",
        "brand_color",
        "deposit_type",
        "deposit_amount",
        "deposit_percent",
        "min_notice_minutes",
        "timezone",
    ):
        value = getattr(payload, field)
        if value is not None:
            setattr(row, field, value)

    if payload.go_live is not None:
        if payload.go_live:
            readiness = svc.booking_readiness(db, row)
            if not readiness["ready"]:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "message": "Cannot go live until booking setup is complete.",
                        "missing": readiness["missing"],
                    },
                )
        row.go_live = payload.go_live

    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    readiness = svc.booking_readiness(db, row)
    return {
        "message": "Booking settings saved.",
        "settings": svc.settings_out(row, readiness=readiness),
    }


@router.get("/booking/providers")
def list_providers(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "settings", "appointments", "schedule")
    account_id = _shop_id(user)
    rows = (
        db.query(BookingProvider)
        .filter(BookingProvider.account_id == account_id)
        .order_by(BookingProvider.sort_order.asc(), BookingProvider.display_name.asc())
        .all()
    )
    return {
        "providers": [
            svc.provider_out(r, svc.list_provider_service_ids(db, r.id)) for r in rows
        ]
    }


@router.post("/booking/providers", status_code=status.HTTP_201_CREATED)
def create_provider(
    payload: ProviderCreate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "settings", "schedule")
    account_id = _shop_id(user)
    now = datetime.utcnow()
    row = BookingProvider(
        account_id=account_id,
        display_name=payload.display_name.strip(),
        role=(payload.role or "").strip() or None,
        bio=(payload.bio or "").strip() or None,
        photo_url=payload.photo_url,
        is_active=True,
        sort_order=payload.sort_order,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    if payload.inventory_item_ids:
        svc.set_provider_services(db, row.id, payload.inventory_item_ids)
    db.commit()
    db.refresh(row)
    return {
        "message": "Staff member added.",
        "provider": svc.provider_out(row, svc.list_provider_service_ids(db, row.id)),
    }


@router.patch("/booking/providers/{provider_id}")
def update_provider(
    provider_id: str,
    payload: ProviderUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "settings", "schedule")
    account_id = _shop_id(user)
    row = (
        db.query(BookingProvider)
        .filter(
            BookingProvider.id == provider_id,
            BookingProvider.account_id == account_id,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Staff not found.")
    if payload.display_name is not None:
        row.display_name = payload.display_name.strip()
    if payload.role is not None:
        row.role = payload.role.strip() or None
    if payload.bio is not None:
        row.bio = payload.bio.strip() or None
    if payload.photo_url is not None:
        row.photo_url = payload.photo_url
    if payload.is_active is not None:
        row.is_active = payload.is_active
    if payload.sort_order is not None:
        row.sort_order = payload.sort_order
    if payload.inventory_item_ids is not None:
        svc.set_provider_services(db, row.id, payload.inventory_item_ids)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return {
        "message": "Staff updated.",
        "provider": svc.provider_out(row, svc.list_provider_service_ids(db, row.id)),
    }


@router.delete("/booking/providers/{provider_id}")
def delete_provider(
    provider_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "settings", "schedule")
    account_id = _shop_id(user)
    row = (
        db.query(BookingProvider)
        .filter(
            BookingProvider.id == provider_id,
            BookingProvider.account_id == account_id,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Staff not found.")
    svc.set_provider_services(db, row.id, [])
    db.delete(row)
    db.commit()
    return {"message": "Staff removed."}


@router.get("/booking/hours")
def list_hours(
    provider_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "settings", "schedule", "appointments")
    account_id = _shop_id(user)
    q = db.query(BookingWeeklyHours).filter(BookingWeeklyHours.account_id == account_id)
    if provider_id:
        q = q.filter(BookingWeeklyHours.provider_id == provider_id)
    else:
        q = q.filter(BookingWeeklyHours.provider_id.is_(None))
    rows = q.order_by(BookingWeeklyHours.weekday.asc()).all()
    return {"hours": [svc.hours_out(r) for r in rows]}


@router.put("/booking/hours")
def replace_hours(
    payload: HoursReplace,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "schedule", "settings")
    account_id = _shop_id(user)
    provider_ids = {d.provider_id for d in payload.days}
    # Clear matching scopes then insert.
    for pid in provider_ids:
        q = db.query(BookingWeeklyHours).filter(BookingWeeklyHours.account_id == account_id)
        if pid:
            q = q.filter(BookingWeeklyHours.provider_id == pid)
        else:
            q = q.filter(BookingWeeklyHours.provider_id.is_(None))
        q.delete()
    now = datetime.utcnow()
    created: list[BookingWeeklyHours] = []
    for day in payload.days:
        row = BookingWeeklyHours(
            account_id=account_id,
            provider_id=day.provider_id,
            weekday=day.weekday,
            open_time=day.open_time,
            close_time=day.close_time,
            is_closed=day.is_closed,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        created.append(row)
    db.commit()
    return {"message": "Hours saved.", "hours": [svc.hours_out(r) for r in created]}


@router.get("/booking/appointments")
def list_appointments(
    from_day: str | None = Query(default=None, alias="from"),
    to_day: str | None = Query(default=None, alias="to"),
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "appointments")
    account_id = _shop_id(user)
    q = db.query(Booking).filter(Booking.account_id == account_id)
    if from_day:
        try:
            start = datetime.fromisoformat(from_day)
            if len(from_day) <= 10:
                start = datetime(start.year, start.month, start.day)
        except ValueError as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid from date.",
            ) from exc
        q = q.filter(Booking.starts_at >= start)
    if to_day:
        try:
            end = datetime.fromisoformat(to_day)
            if len(to_day) <= 10:
                end = datetime(end.year, end.month, end.day, 23, 59, 59)
        except ValueError as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid to date.",
            ) from exc
        q = q.filter(Booking.starts_at <= end)
    if status_filter:
        statuses = [s.strip() for s in status_filter.split(",") if s.strip()]
        if statuses:
            q = q.filter(Booking.status.in_(statuses))
    rows = q.order_by(Booking.starts_at.asc()).limit(500).all()
    return {"bookings": [svc.enrich_booking_out(db, r) for r in rows]}


@router.get("/booking/appointments/{booking_id}")
def get_appointment(
    booking_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "appointments")
    account_id = _shop_id(user)
    row = (
        db.query(Booking)
        .filter(Booking.id == booking_id, Booking.account_id == account_id)
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Appointment not found.")
    return {"booking": svc.enrich_booking_out(db, row)}


@router.post("/booking/appointments", status_code=status.HTTP_201_CREATED)
def create_appointment(
    payload: AppointmentCreate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "appointments")
    account_id = _shop_id(user)
    settings = (
        db.query(BookingSettings).filter(BookingSettings.account_id == account_id).first()
    )
    if settings is None:
        account = db.get(Account, account_id)
        if account is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Shop not found.")
        settings = svc.ensure_booking_settings(db, account)
    try:
        starts = datetime.fromisoformat(payload.starts_at)
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid starts_at.",
        ) from exc
    try:
        booking = svc.create_booking(
            db,
            account_id=account_id,
            settings=settings,
            inventory_item_id=payload.inventory_item_id,
            provider_id=payload.provider_id,
            starts_at=starts,
            customer_name=payload.customer_name,
            customer_phone=payload.customer_phone,
            notes=payload.notes,
            # Merchant walk-ins: confirm immediately even if deposits configured.
            skip_slot_check=False,
        )
        if booking.status == "pending":
            booking.status = "confirmed"
            booking.updated_at = datetime.utcnow()
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    db.commit()
    db.refresh(booking)
    return {
        "message": "Appointment created.",
        "booking": svc.enrich_booking_out(db, booking),
    }


@router.patch("/booking/appointments/{booking_id}")
def patch_appointment(
    booking_id: str,
    payload: AppointmentPatch,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "appointments")
    account_id = _shop_id(user)
    row = (
        db.query(Booking)
        .filter(Booking.id == booking_id, Booking.account_id == account_id)
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Appointment not found.")
    try:
        svc.update_booking_status(
            db,
            row,
            status_value=payload.status,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    db.commit()
    db.refresh(row)
    return {
        "message": "Appointment updated.",
        "booking": svc.enrich_booking_out(db, row),
    }


@router.post("/booking/appointments/{booking_id}/reschedule")
def reschedule_appointment(
    booking_id: str,
    payload: AppointmentReschedule,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "appointments")
    account_id = _shop_id(user)
    row = (
        db.query(Booking)
        .filter(Booking.id == booking_id, Booking.account_id == account_id)
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Appointment not found.")
    settings = (
        db.query(BookingSettings).filter(BookingSettings.account_id == account_id).first()
    )
    if settings is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Booking settings missing.")
    try:
        starts = datetime.fromisoformat(payload.starts_at)
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid starts_at.",
        ) from exc
    try:
        svc.reschedule_booking(
            db,
            row,
            settings,
            starts_at=starts,
            provider_id=payload.provider_id,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    db.commit()
    db.refresh(row)
    return {
        "message": "Appointment rescheduled.",
        "booking": svc.enrich_booking_out(db, row),
    }


# ---- public ---------------------------------------------------------------


@router.get("/book/{slug}")
def public_booking_page(
    slug: str,
    preview: bool = Query(default=False),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    row = (
        db.query(BookingSettings)
        .filter(BookingSettings.booking_slug == slug)
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Booking page not found.")
    if not row.go_live:
        if not preview:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                detail="This booking page is not live yet.",
            )
        try:
            user = require_user(db, session)
            if str(active_account_id(user)) != row.account_id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not live.")
        except HTTPException:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                detail="This booking page is not live yet.",
            )

    account = db.get(Account, row.account_id)
    items = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .filter(
            InventoryItem.account_id == row.account_id,
            InventoryItem.is_active.is_(True),
        )
        .all()
    )
    services = [
        svc.service_card(i)
        for i in items
        if i.product and i.product.product_type == "service"
    ]
    providers = (
        db.query(BookingProvider)
        .filter(
            BookingProvider.account_id == row.account_id,
            BookingProvider.is_active.is_(True),
        )
        .order_by(BookingProvider.sort_order.asc())
        .all()
    )
    return {
        "settings": svc.settings_out(row),
        "business_name": account.business_name if account else None,
        "business_location": account.business_location if account else None,
        "services": services,
        "providers": [
            svc.provider_out(p, svc.list_provider_service_ids(db, p.id)) for p in providers
        ],
    }


@router.get("/book/{slug}/slots")
def public_slots(
    slug: str,
    inventory_item_id: str = Query(...),
    day: str = Query(..., description="YYYY-MM-DD"),
    provider_id: str | None = Query(default=None),
    preview: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    row = (
        db.query(BookingSettings)
        .filter(BookingSettings.booking_slug == slug)
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Booking page not found.")
    if not row.go_live and not preview:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not live.")
    try:
        day_date = date.fromisoformat(day)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid day.") from exc
    slots = svc.available_slots(
        db,
        account_id=row.account_id,
        settings=row,
        inventory_item_id=inventory_item_id,
        provider_id=provider_id,
        day=day_date,
    )
    return {"slots": slots, "day": day}


@router.post("/book/{slug}", status_code=status.HTTP_201_CREATED)
def public_create_booking(
    slug: str,
    payload: PublicBookingCreate,
    preview: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    row = (
        db.query(BookingSettings)
        .filter(BookingSettings.booking_slug == slug)
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Booking page not found.")
    if not row.go_live and not preview:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not live.")
    try:
        starts = datetime.fromisoformat(payload.starts_at)
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid starts_at.",
        ) from exc
    try:
        booking = svc.create_booking(
            db,
            account_id=row.account_id,
            settings=row,
            inventory_item_id=payload.inventory_item_id,
            provider_id=payload.provider_id,
            starts_at=starts,
            customer_name=payload.customer_name,
            customer_phone=payload.customer_phone,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    db.commit()
    db.refresh(booking)
    out = svc.enrich_booking_out(db, booking)
    message = (
        "Booking held — complete the deposit to confirm."
        if booking.status == "pending"
        else "Booking confirmed."
    )
    return {"message": message, "booking": out}


@router.post("/book/{slug}/deposit")
def public_deposit_stk(
    slug: str,
    payload: PublicDepositPayBody,
    preview: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    settings = (
        db.query(BookingSettings)
        .filter(BookingSettings.booking_slug == slug)
        .first()
    )
    if settings is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Booking page not found.")
    if not settings.go_live and not preview:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not live.")

    booking = (
        db.query(Booking)
        .filter(
            Booking.account_id == settings.account_id,
            Booking.public_token == payload.public_token,
        )
        .first()
    )
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Booking not found.")
    if booking.status == "confirmed":
        return {
            "message": "Booking already confirmed.",
            "booking": svc.enrich_booking_out(db, booking),
        }
    if booking.status != "pending":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This booking cannot accept a deposit.",
        )
    deposit = booking.deposit_amount
    if deposit is None or float(deposit) <= 0:
        booking.status = "confirmed"
        booking.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(booking)
        return {
            "message": "Booking confirmed.",
            "booking": svc.enrich_booking_out(db, booking),
        }

    phone = (payload.phone_number or booking.customer_phone or "").strip()
    amount = max(1, int(round(float(deposit))))
    try:
        txn = mpesa_service.stk_push(
            db,
            phone_number=phone,
            amount=amount,
            account_reference=(booking.public_token or "BOOKING")[:12],
            transaction_desc="Booking deposit",
            account_id=booking.account_id,
        )
    except MpesaApiError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    booking.deposit_mpesa_txn_id = txn.id
    if hasattr(txn, "booking_id"):
        txn.booking_id = booking.id
    booking.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(booking)
    return {
        "message": "Check your phone for the M-PESA prompt.",
        "booking": svc.enrich_booking_out(db, booking),
        "mpesa_payment": {
            "id": txn.id,
            "status": txn.status,
            "amount": txn.amount,
            "phone_number": txn.phone_number,
            "message": "Enter your M-PESA PIN when prompted.",
        },
    }


@router.get("/book/{slug}/deposit/{public_token}")
def public_deposit_status(
    slug: str,
    public_token: str,
    preview: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    settings = (
        db.query(BookingSettings)
        .filter(BookingSettings.booking_slug == slug)
        .first()
    )
    if settings is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Booking page not found.")
    if not settings.go_live and not preview:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not live.")
    booking = (
        db.query(Booking)
        .filter(
            Booking.account_id == settings.account_id,
            Booking.public_token == public_token,
        )
        .first()
    )
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Booking not found.")
    out = svc.enrich_booking_out(db, booking)
    mpesa: dict[str, Any] | None = None
    if booking.deposit_mpesa_txn_id:
        txn = db.get(MpesaTransaction, booking.deposit_mpesa_txn_id)
        if txn:
            mpesa = {
                "id": txn.id,
                "status": txn.status,
                "amount": txn.amount,
                "phone_number": txn.phone_number,
                "mpesa_receipt_number": txn.mpesa_receipt_number,
                "result_desc": txn.result_desc,
            }
    return {"booking": out, "mpesa_payment": mpesa}
