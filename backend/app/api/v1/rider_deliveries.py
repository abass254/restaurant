"""Rider-facing delivery actions (scoped session) + PWA trip/presence APIs."""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, selectinload

from app.core.session import (
    ensure_csrf_token,
    login_rider,
    logout_user,
    require_rider,
    save_session,
    validate_csrf,
)
from app.core import auth_throttle
from app.database import get_db
from app.dependencies import get_request_session
from app.models import Account, Delivery, Order, OrderStatusHistory, Rider
from app.services.delivery_service import DeliveryService
from app.services.order_completion_service import OrderCompletionError, OrderCompletionService
from app.services.rider_service import RiderServiceError
from app.services.rider_trip_service import (
    TRIP_EN_ROUTE_CLIENT,
    TRIP_PICKING_UP,
    RiderTripService,
    trip_pickup_for_delivery,
    trip_route_for_phase,
)
from app.support.delivery_status import DELIVERY_ACTIVE
from app.support.order_delivery_details import order_needs_delivery_details
from app.support.datetime_utils import as_utc
from app.support.order_status import (
    AWAITING_DELIVERY_CONFIRMATION,
    OUT_FOR_DELIVERY,
    READY,
    allowed_next_statuses,
    can_transition,
)

router = APIRouter(prefix="/rider", tags=["rider-deliveries"])

logger = logging.getLogger(__name__)


class RiderDeliveryItemOut(BaseModel):
    product_name: str
    quantity: int


class RiderDeliveryOut(BaseModel):
    id: str
    delivery_number: str
    order_id: str | None = None
    order_number: str | None = None
    has_order: bool = False
    status: str
    customer_name: str | None
    customer_phone_masked: str | None
    customer_phone: str | None = None
    delivery_address: str | None
    delivery_notes: str | None
    total: float
    currency: str
    delivery_fee: float = 0
    items: list[RiderDeliveryItemOut]
    can_dispatch: bool
    can_confirm: bool
    rider_trip_phase: str | None = None
    trip_route: str | None = None
    store_name: str | None = None
    store_location: str | None = None
    store_lat: float | None = None
    store_lng: float | None = None


class PresenceRequest(BaseModel):
    online: bool
    lat: float | None = None
    lng: float | None = None


class HeartbeatRequest(BaseModel):
    lat: float | None = None
    lng: float | None = None


class TripAdvanceRequest(BaseModel):
    phase: str = Field(min_length=1, max_length=32)


class LoginRequestCode(BaseModel):
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=255)


class LoginVerifyRequest(BaseModel):
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=255)
    code: str = Field(max_length=16)


def _mask_phone(phone: str | None) -> str | None:
    raw = (phone or "").strip()
    if len(raw) < 4:
        return raw or None
    return f"{'*' * max(0, len(raw) - 4)}{raw[-4:]}"


def _delivery_out(delivery: Delivery, account: Account | None = None) -> RiderDeliveryOut:
    order = delivery.order
    phase = delivery.rider_trip_phase
    store_location, store_lat, store_lng = trip_pickup_for_delivery(delivery, account)
    status_value = delivery.status
    order_status = order.status if order else None
    items = order.items if order else []
    return RiderDeliveryOut(
        id=delivery.id,
        delivery_number=delivery.delivery_number,
        order_id=delivery.order_id,
        order_number=order.order_number if order else None,
        has_order=order is not None,
        status=order_status or status_value,
        customer_name=delivery.customer_name,
        customer_phone_masked=_mask_phone(delivery.customer_phone),
        customer_phone=delivery.customer_phone,
        delivery_address=delivery.delivery_address,
        delivery_notes=delivery.delivery_notes,
        total=float(order.total or 0) if order else float(delivery.delivery_fee or 0),
        currency=delivery.currency or "KES",
        delivery_fee=float(delivery.delivery_fee or 0),
        items=[
            RiderDeliveryItemOut(
                product_name=item.product_name,
                quantity=int(item.quantity or 0),
            )
            for item in items
        ],
        can_dispatch=bool(
            order
            and order_status == READY
            and not order_needs_delivery_details(order),
        ),
        can_confirm=bool(
            order
            and order_status in {OUT_FOR_DELIVERY, AWAITING_DELIVERY_CONFIRMATION}
            and not order.merchant_delivery_confirmed_at,
        )
        or (not order and delivery.status == DELIVERY_ACTIVE),
        rider_trip_phase=phase,
        trip_route=trip_route_for_phase(phase) if phase else None,
        store_name=account.business_name if account else None,
        store_location=store_location,
        store_lat=store_lat,
        store_lng=store_lng,
    )


def _get_assigned_delivery(db: Session, rider: Rider, delivery_id: str) -> Delivery:
    """Resolve a rider trip by delivery id or legacy kitchen order id."""
    delivery = (
        db.query(Delivery)
        .options(selectinload(Delivery.order).selectinload(Order.items))
        .filter(
            Delivery.id == delivery_id,
            Delivery.account_id == rider.account_id,
            Delivery.assigned_rider_id == rider.id,
        )
        .first()
    )
    if delivery:
        return delivery

    order = (
        db.query(Order)
        .options(selectinload(Order.items))
        .filter(
            Order.id == delivery_id,
            Order.account_id == rider.account_id,
            Order.assigned_rider_id == rider.id,
        )
        .first()
    )
    if order:
        delivery = DeliveryService(db).ensure_for_order(order)
        if delivery.assigned_rider_id != rider.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Delivery not found.")
        db.refresh(delivery, attribute_names=["order"])
        if delivery.order:
            db.refresh(delivery.order, attribute_names=["items"])
        return delivery

    delivery = (
        db.query(Delivery)
        .options(selectinload(Delivery.order).selectinload(Order.items))
        .filter(
            Delivery.order_id == delivery_id,
            Delivery.account_id == rider.account_id,
            Delivery.assigned_rider_id == rider.id,
        )
        .first()
    )
    if not delivery:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Delivery not found.")
    return delivery


def _account_for(db: Session, rider: Rider) -> Account | None:
    return db.get(Account, rider.account_id)


# --- Auth -------------------------------------------------------------------


@router.post("/auth/request-code")
def rider_request_login_code(
    payload: LoginRequestCode,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    phone = (payload.phone or "").strip() or None
    email = (payload.email or "").strip() or None
    if not phone and not email:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter a phone number or email to continue.",
        )
    auth_throttle.throttle_otp_request(request, email or phone or "")
    try:
        result = RiderTripService(db).request_login_code(
            phone=phone,
            email=email,
        )
    except RiderServiceError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"data": result}


@router.post("/auth/verify-code")
def rider_verify_login_code(
    payload: LoginVerifyRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    ident = (payload.email or payload.phone or "").strip()
    auth_throttle.throttle_otp_verify(request, ident)
    try:
        rider = RiderTripService(db).verify_login_code(
            phone=payload.phone,
            email=payload.email,
            code=payload.code,
        )
    except RiderServiceError as exc:
        auth_throttle.record_otp_verify_failure(ident)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    login_rider(session, rider.id)
    auth_throttle.record_otp_verify_success(ident)
    csrf = ensure_csrf_token(session)
    cookie = save_session(request, session)
    response.set_cookie(**cookie)
    me = RiderTripService(db).me_payload(rider)
    # session_token lets Expo / native clients auth without cookie jars.
    return {
        "message": "Signed in.",
        "data": {
            **me,
            "session_token": cookie["value"],
            "csrf_token": csrf,
        },
    }


@router.post("/auth/logout")
def rider_logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    rider = None
    try:
        rider = require_rider(db, session)
    except HTTPException:
        rider = None
    if rider:
        rider.is_online = False
        db.commit()
    logout_user(session)
    cookie = save_session(request, session)
    response.set_cookie(**cookie)
    return {"message": "Signed out."}


@router.get("/me")
def rider_me(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    rider = require_rider(db, session)
    return {"data": RiderTripService(db).me_payload(rider)}


# --- Presence / offers ------------------------------------------------------


@router.post("/presence")
def rider_set_presence(
    payload: PresenceRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    rider = require_rider(db, session)
    try:
        rider = RiderTripService(db).set_presence(
            rider,
            online=payload.online,
            lat=payload.lat,
            lng=payload.lng,
        )
    except RiderServiceError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"message": "Online" if rider.is_online else "Offline", "data": RiderTripService(db).me_payload(rider)}


@router.post("/heartbeat")
def rider_heartbeat(
    payload: HeartbeatRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    rider = require_rider(db, session)
    rider = RiderTripService(db).heartbeat(rider, lat=payload.lat, lng=payload.lng)
    offers = RiderTripService(db).list_pending_offers(rider)
    trip = RiderTripService(db).get_active_trip(rider)
    return {
        "data": {
            "is_online": bool(rider.is_online),
            "last_seen_at": as_utc(rider.last_seen_at),
            "offers": offers,
            "active_trip_id": trip.id if trip else None,
            "active_trip_phase": trip.rider_trip_phase if trip else None,
            "active_trip_route": trip_route_for_phase(trip.rider_trip_phase) if trip else None,
        }
    }


@router.get("/offers")
def rider_list_offers(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    rider = require_rider(db, session)
    return {"data": RiderTripService(db).list_pending_offers(rider)}


@router.post("/offers/{offer_id}/accept")
def rider_accept_offer(
    offer_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    rider = require_rider(db, session)
    try:
        delivery_row = RiderTripService(db).accept_offer(rider, offer_id)
    except RiderServiceError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    account = _account_for(db, rider)
    return {
        "message": "Delivery accepted.",
        "data": _delivery_out(delivery_row, account),
    }


@router.post("/offers/{offer_id}/decline")
def rider_decline_offer(
    offer_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    rider = require_rider(db, session)
    try:
        RiderTripService(db).decline_offer(rider, offer_id)
    except RiderServiceError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {"message": "Offer declined."}


# --- Deliveries / trip ------------------------------------------------------


@router.get("/deliveries")
def list_rider_deliveries(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    rider = require_rider(db, session)
    account = _account_for(db, rider)
    deliveries = (
        db.query(Delivery)
        .options(selectinload(Delivery.order).selectinload(Order.items))
        .filter(
            Delivery.account_id == rider.account_id,
            Delivery.assigned_rider_id == rider.id,
            Delivery.status == DELIVERY_ACTIVE,
        )
        .order_by(Delivery.updated_at.desc())
        .all()
    )
    return {"data": [_delivery_out(row, account) for row in deliveries]}


@router.get("/deliveries/{delivery_id}")
def get_rider_delivery(
    delivery_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    rider = require_rider(db, session)
    delivery = _get_assigned_delivery(db, rider, delivery_id)
    return {"data": _delivery_out(delivery, _account_for(db, rider))}


@router.post("/deliveries/{delivery_id}/trip")
def rider_advance_trip(
    delivery_id: str,
    payload: TripAdvanceRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    rider = require_rider(db, session)
    service = RiderTripService(db)
    phase = payload.phase.strip()
    delivery = _get_assigned_delivery(db, rider, delivery_id)
    resolved_id = delivery.id

    if phase == TRIP_EN_ROUTE_CLIENT:
        current = delivery.rider_trip_phase or ""
        if current != TRIP_PICKING_UP:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=f"Cannot move trip from {current} to {phase}.",
            )
        order = delivery.order
        if order and order.status == READY:
            if order_needs_delivery_details(order):
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail="Customer delivery details are required before dispatch.",
                )
            if not can_transition(order.status, OUT_FOR_DELIVERY, order.fulfillment_type):
                legal = ", ".join(allowed_next_statuses(order.status, order.fulfillment_type))
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail=f"Cannot dispatch this order. Allowed: {legal}.",
                )
            now = datetime.utcnow()
            previous = order.status
            order.status = OUT_FOR_DELIVERY
            order.dispatched_at = order.dispatched_at or now
            order.rider_dispatched_at = now
            order.updated_at = now
            delivery.rider_dispatched_at = now
            delivery.updated_at = now
            db.add(
                OrderStatusHistory(
                    order_id=order.id,
                    from_status=previous,
                    to_status=OUT_FOR_DELIVERY,
                    changed_by_user_id=None,
                    note=f"Dispatched by rider {rider.name}",
                    created_at=now,
                ),
            )
            db.commit()
            if order.source_conversation_id:
                from app.services.order_notification_service import notify_order_status_change

                notify_order_status_change(db, order.id)

        try:
            delivery = service.advance_trip(rider, resolved_id, to_phase=phase)
        except RiderServiceError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        return {
            "message": "Heading to customer.",
            "data": _delivery_out(delivery, _account_for(db, rider)),
        }

    try:
        delivery = service.advance_trip(rider, resolved_id, to_phase=phase)
    except RiderServiceError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {
        "message": "Trip updated.",
        "data": _delivery_out(delivery, _account_for(db, rider)),
    }


@router.post("/deliveries/{delivery_id}/dispatch")
def rider_dispatch_delivery(
    delivery_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    rider = require_rider(db, session)
    delivery = _get_assigned_delivery(db, rider, delivery_id)
    order = delivery.order
    if not order:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="This trip has no kitchen order to dispatch.",
        )

    if order.status != READY:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="This order is not ready to dispatch.",
        )
    if order_needs_delivery_details(order):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Customer delivery details are required before dispatch.",
        )
    if not can_transition(order.status, OUT_FOR_DELIVERY, order.fulfillment_type):
        legal = ", ".join(allowed_next_statuses(order.status, order.fulfillment_type))
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Cannot dispatch this order. Allowed: {legal}.",
        )

    now = datetime.utcnow()
    previous = order.status
    order.status = OUT_FOR_DELIVERY
    order.dispatched_at = order.dispatched_at or now
    order.rider_dispatched_at = now
    if delivery.rider_trip_phase in (None, "en_route_to_store", "at_store", "picking_up"):
        delivery.rider_trip_phase = TRIP_EN_ROUTE_CLIENT
        order.rider_trip_phase = TRIP_EN_ROUTE_CLIENT
    delivery.rider_dispatched_at = now
    order.updated_at = now
    delivery.updated_at = now
    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=previous,
            to_status=OUT_FOR_DELIVERY,
            changed_by_user_id=None,
            note=f"Dispatched by rider {rider.name}",
            created_at=now,
        ),
    )
    db.commit()
    db.refresh(delivery)

    if order.source_conversation_id:
        from app.services.order_notification_service import notify_order_status_change

        notify_order_status_change(db, order.id)

    return {
        "message": "Delivery started.",
        "data": _delivery_out(delivery, _account_for(db, rider)),
    }


@router.post("/deliveries/{delivery_id}/confirm")
def rider_confirm_delivery(
    delivery_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    rider = require_rider(db, session)
    delivery = _get_assigned_delivery(db, rider, delivery_id)
    order = delivery.order
    trip_service = RiderTripService(db)

    if order:
        completion = OrderCompletionService(db)
        try:
            completion.merchant_confirm_handoff(order, user_id=None)
        except OrderCompletionError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        db.refresh(order)
        trip_service.mark_trip_completed(delivery)
        db.refresh(delivery)
        if order.source_conversation_id:
            try:
                from app.services.order_notification_service import notify_order_status_change

                notify_order_status_change(db, order.id)
            except Exception:
                logger.exception(
                    "notify_order_status_change failed after rider confirm for order %s",
                    order.id,
                )
    else:
        trip_service.mark_trip_completed(delivery)
        db.refresh(delivery)

    return {
        "message": "Delivery confirmed.",
        "data": _delivery_out(delivery, _account_for(db, rider)),
    }


@router.get("/earnings")
def rider_earnings(
    period: str = "today",
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    rider = require_rider(db, session)
    if period not in {"today", "week", "all"}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid period.")
    return {"data": RiderTripService(db).earnings(rider, period=period)}
