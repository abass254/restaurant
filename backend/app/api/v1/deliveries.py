"""Merchant delivery endpoints — standalone hails and delivery listing."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, selectinload

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import Account, Delivery, Rider, User
from app.services.delivery_service import DeliveryService
from app.services.rider_trip_service import (
    RIDER_SEARCH_TTL_SECONDS,
    RiderTripService,
    rider_search_timeout_label,
)
from app.support.datetime_utils import as_utc
from app.support.account_location import (
    STORE_LOCATION_REQUIRED_FOR_RIDERS,
    account_has_store_coordinates,
)
from app.support.delivery_status import DELIVERY_CANCELLED, DELIVERY_SEARCHING
from app.support.merchant_permissions import active_account_id, assert_merchant_section_any_access

router = APIRouter(prefix="/deliveries", tags=["deliveries"])


class HailRiderRequest(BaseModel):
    pickup_address: str = Field(min_length=1, max_length=2000)
    delivery_address: str = Field(min_length=1, max_length=2000)
    pickup_lat: float | None = Field(default=None, ge=-90, le=90)
    pickup_lng: float | None = Field(default=None, ge=-180, le=180)
    customer_name: str | None = Field(default=None, max_length=255)
    customer_phone: str | None = Field(default=None, max_length=32)
    delivery_notes: str | None = Field(default=None, max_length=2000)
    delivery_fee: float | None = Field(default=150, ge=0, le=99_999_999.99)


class DeliveryOut(BaseModel):
    id: str
    delivery_number: str
    order_id: str | None
    status: str
    pickup_address: str | None
    pickup_lat: float | None
    pickup_lng: float | None
    delivery_address: str | None
    delivery_notes: str | None
    customer_name: str | None
    customer_phone: str | None
    delivery_fee: float
    currency: str
    assigned_rider_id: str | None
    assigned_rider_name: str | None
    rider_trip_phase: str | None
    rider_search_expires_at: datetime | None
    created_at: datetime | None
    updated_at: datetime | None
    cancelled_at: datetime | None
    completed_at: datetime | None


def _require_shop(user: User) -> str:
    account_id = active_account_id(user)
    if not account_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Select a shop first.")
    return str(account_id)


def _money(value: float | int | Decimal | None) -> Decimal:
    if value is None:
        return Decimal("0.00")
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _serialize_delivery(delivery: Delivery) -> DeliveryOut:
    rider_name = delivery.assigned_rider.name if delivery.assigned_rider else None
    return DeliveryOut(
        id=delivery.id,
        delivery_number=delivery.delivery_number,
        order_id=delivery.order_id,
        status=delivery.status,
        pickup_address=delivery.pickup_address,
        pickup_lat=delivery.pickup_lat,
        pickup_lng=delivery.pickup_lng,
        delivery_address=delivery.delivery_address,
        delivery_notes=delivery.delivery_notes,
        customer_name=delivery.customer_name,
        customer_phone=delivery.customer_phone,
        delivery_fee=float(delivery.delivery_fee or 0),
        currency=delivery.currency or "KES",
        assigned_rider_id=delivery.assigned_rider_id,
        assigned_rider_name=rider_name,
        rider_trip_phase=delivery.rider_trip_phase,
        rider_search_expires_at=as_utc(delivery.rider_search_expires_at),
        created_at=as_utc(delivery.created_at),
        updated_at=as_utc(delivery.updated_at),
        cancelled_at=as_utc(delivery.cancelled_at),
        completed_at=as_utc(delivery.completed_at),
    )


def _get_owned_delivery(db: Session, account_id: str, delivery_id: str) -> Delivery:
    delivery = (
        db.query(Delivery)
        .options(selectinload(Delivery.assigned_rider))
        .filter(Delivery.id == delivery_id, Delivery.account_id == account_id)
        .first()
    )
    if not delivery:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Delivery not found.")
    return delivery


@router.get("")
def list_deliveries(
    standalone: bool = Query(default=False),
    per_page: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "delivery", "orders", "tools")
    account_id = _require_shop(user)

    trip_service = RiderTripService(db)
    trip_service.repair_cancelled_standalone_with_active_rider(account_id)
    trip_service.expire_stale_rider_searches(account_id)

    q = (
        db.query(Delivery)
        .options(selectinload(Delivery.assigned_rider))
        .filter(Delivery.account_id == account_id)
        .order_by(Delivery.created_at.desc())
    )
    if standalone:
        q = q.filter(Delivery.order_id.is_(None))
    rows = q.limit(per_page).all()
    return {"data": [_serialize_delivery(row) for row in rows]}


@router.get("/{delivery_id}")
def get_delivery(
    delivery_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "delivery", "orders", "tools")
    account_id = _require_shop(user)
    delivery = _get_owned_delivery(db, account_id, delivery_id)
    return {"data": _serialize_delivery(delivery)}


@router.post("/hail", status_code=status.HTTP_201_CREATED)
def hail_rider(
    request: Request,
    payload: HailRiderRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Look for a rider for a pickup → drop-off, without a kitchen order."""
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "delivery", "orders", "tools")
    account_id = _require_shop(user)

    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Shop not found.")

    pickup_address = payload.pickup_address.strip()
    delivery_address = payload.delivery_address.strip()
    if not pickup_address:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Pickup is required.")
    if not delivery_address:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Drop-off is required.")

    pickup_lat = payload.pickup_lat
    pickup_lng = payload.pickup_lng
    if pickup_lat is None or pickup_lng is None:
        if not account_has_store_coordinates(account):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=STORE_LOCATION_REQUIRED_FOR_RIDERS,
            )
        pickup_lat = float(account.latitude)
        pickup_lng = float(account.longitude)

    delivery = DeliveryService(db).create_standalone_hail(
        account_id=account_id,
        user_id=user.id,
        pickup_address=pickup_address,
        delivery_address=delivery_address,
        pickup_lat=pickup_lat,
        pickup_lng=pickup_lng,
        customer_name=(payload.customer_name or "").strip() or None,
        customer_phone=(payload.customer_phone or "").strip() or None,
        delivery_notes=(payload.delivery_notes or "").strip() or None,
        delivery_fee=_money(payload.delivery_fee if payload.delivery_fee is not None else 150),
        search_ttl_seconds=RIDER_SEARCH_TTL_SECONDS,
    )

    trip_service = RiderTripService(db)
    offers = trip_service.fan_out_offers_for_delivery(delivery)

    online_riders = (
        db.query(Rider)
        .filter(
            Rider.account_id == account_id,
            Rider.status == "active",
            Rider.is_online.is_(True),
        )
        .all()
    )
    eligible_count = sum(
        1 for rider in online_riders if trip_service._rider_eligible_for_offers(rider)
    )

    timeout_note = (
        f" We'll stop looking after {rider_search_timeout_label()} if no one accepts."
    )
    if offers:
        message = (
            f"Looking for a rider — offered to {len(offers)} online rider"
            f"{'' if len(offers) == 1 else 's'}.{timeout_note}"
        )
    elif eligible_count == 0:
        message = (
            "No eligible riders online right now. We'll keep looking when someone comes online."
            + timeout_note
        )
    else:
        message = "Looking for a rider." + timeout_note

    db.refresh(delivery, attribute_names=["assigned_rider"])
    return {
        "message": message,
        "data": {
            **_serialize_delivery(delivery).model_dump(),
            "offers_created": len(offers),
            "online_riders": len(online_riders),
            "eligible_riders": eligible_count,
        },
    }


@router.post("/{delivery_id}/retry-rider-search")
def retry_rider_search(
    delivery_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Look for a rider again on a timed-out standalone hail."""
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "delivery", "orders", "tools")
    account_id = _require_shop(user)
    delivery = _get_owned_delivery(db, account_id, delivery_id)

    if delivery.order_id is not None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only standalone hails can be retried from Delivery.",
        )
    if delivery.assigned_rider_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="This delivery already has a rider assigned.",
        )
    if delivery.status != DELIVERY_CANCELLED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Only cancelled deliveries without a rider can be retried.",
        )

    now = datetime.utcnow()
    delivery.status = DELIVERY_SEARCHING
    delivery.cancelled_at = None
    delivery.rider_trip_phase = None
    delivery.rider_search_expires_at = now + timedelta(seconds=RIDER_SEARCH_TTL_SECONDS)
    delivery.updated_at = now
    db.commit()
    db.refresh(delivery)

    trip_service = RiderTripService(db)
    offers = trip_service.fan_out_offers_for_delivery(delivery)

    online_riders = (
        db.query(Rider)
        .filter(
            Rider.account_id == account_id,
            Rider.status == "active",
            Rider.is_online.is_(True),
        )
        .all()
    )
    eligible_count = sum(
        1 for rider in online_riders if trip_service._rider_eligible_for_offers(rider)
    )

    timeout_note = (
        f" We'll stop looking after {rider_search_timeout_label()} if no one accepts."
    )
    if offers:
        message = (
            f"Looking for a rider again — offered to {len(offers)} online rider"
            f"{'' if len(offers) == 1 else 's'}.{timeout_note}"
        )
    else:
        message = "Looking for a rider again." + timeout_note

    db.refresh(delivery, attribute_names=["assigned_rider"])
    return {
        "message": message,
        "data": {
            **_serialize_delivery(delivery).model_dump(),
            "offers_created": len(offers),
            "online_riders": len(online_riders),
            "eligible_riders": eligible_count,
        },
    }
