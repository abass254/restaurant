"""Order processing endpoints.

The order lifecycle and supported sources/fulfillment types live in
:mod:`app.support.order_status`. This module is intentionally thin — it
validates input, talks to the DB, and delegates legality checks to the
state-machine helpers.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.session import require_user, validate_csrf
from app.support.merchant_permissions import (
    assert_merchant_section_access,
    assert_merchant_section_any_access,
)
from app.database import get_db
from app.dependencies import get_request_session
from app.models import (
    Account,
    InventoryItem,
    MpesaTransaction,
    Order,
    OrderItem,
    OrderStatusHistory,
    Rider,
    User,
)
from app.schemas import OrderOut, attach_order_mpesa_settlement
from app.support.mpesa_order_link import (
    link_mpesa_transaction_to_order,
    confirm_mpesa_receipt_for_order,
    order_requires_mpesa_receipt_confirmation,
)
from app.services import mpesa_service
from app.services.mpesa_service import (
    MpesaApiError,
    MpesaConfigurationMissing,
)
from app.support.mpesa_merchant_copy import merchant_safe_stk_error
from app.services.order_creation import insert_order, next_order_number
from app.services.order_tracking_service import (
    OrderTrackingError,
    OrderTrackingService,
    OrderTrackingUnavailable,
)
from app.services.order_completion_service import OrderCompletionError, OrderCompletionService
from app.services.customer_service import CustomerService, CustomerServiceError
from app.services.inventory_stock_service import (
    InsufficientStockError,
    deduct_stock,
    stock_usage_lines,
)
from app.services.menu_options import (
    LineOptionsError,
    line_stock_usage,
    resolve_line_options,
)
from app.services.order_stock_service import consume_for_order, release_order_holds
from app.services.sell_units import resolve_sell_unit
from app.support.datetime_utils import naive_utc
from app.support.store_type import is_restaurant
from app.support.order_delivery_details import order_needs_delivery_details
from app.support.account_location import (
    STORE_LOCATION_REQUIRED_FOR_RIDERS,
    account_has_store_coordinates,
)
from app.support.order_status import (
    ALL_FULFILLMENT_TYPES,
    ALL_PAYMENT_METHODS,
    ALL_SOURCES,
    ALL_STATUSES,
    AWAITING_PAYMENT,
    CANCELLED,
    DELIVERED,
    FULFILLMENT_DELIVERY,
    OUT_FOR_DELIVERY,
    PAYMENT_CREDIT,
    PAYMENT_MPESA,
    PAYMENT_CASH,
    PAYMENT_CARD,
    PAYMENT_RECEIVED,
    PAYMENT_SPLIT,
    PICKED_UP,
    PLACED,
    READY,
    REFUNDED,
    SOURCE_RIDER_REQUEST,
    SOURCE_WALKIN,
    TERMINAL_STATUSES,
    BEING_PREPARED,
    allowed_next_statuses,
    can_transition,
)
from app.support.order_payments import (
    normalize_payment_splits,
    order_uses_payment,
    payment_methods,
    payment_portion,
)
from app.support.merchant_permissions import active_account_id, require_store_admin

router = APIRouter(prefix="/orders", tags=["orders"])

logger = logging.getLogger(__name__)


# --- Helpers ----------------------------------------------------------------


def _require_shop(user: User) -> int:
    return active_account_id(user)


def _auth_orders_user(db: Session, session: dict, *, pos_ok: bool = False) -> User:
    user = require_user(db, session)
    if pos_ok:
        assert_merchant_section_any_access(user, "orders", "pos", "dashboard")
    else:
        assert_merchant_section_access(user, "orders")
    return user


def _get_owned_order(
    db: Session,
    account_id: str,
    order_id: str,
    *,
    eager: bool = True,
) -> Order:
    query = db.query(Order).filter(
        Order.id == order_id,
        Order.account_id == account_id,
    )
    if eager:
        query = query.options(
            selectinload(Order.items).selectinload(OrderItem.inventory_item),
            selectinload(Order.status_history),
            selectinload(Order.mpesa_transaction),
            selectinload(Order.mpesa_transactions),
            selectinload(Order.assigned_rider),
        )
    order = query.first()
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Order not found.")
    return order


def _money(value: float | int | Decimal | None) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value)).quantize(Decimal("0.01"))


# --- Pydantic payloads ------------------------------------------------------


class OrderItemPayload(BaseModel):
    """One line on the order being created.

    Provide either an ``inventory_item_id`` (we'll snapshot the catalog
    product's current name/sku and the inventory item's selling price) or a
    free-text ``product_name``+``unit_price`` (for custom one-off items).
    """

    inventory_item_id: str | None = Field(default=None, min_length=1, max_length=64)
    product_name: str | None = Field(default=None, max_length=255)
    product_sku: str | None = Field(default=None, max_length=120)
    quantity: int = Field(ge=1, le=10_000)
    unit_price: float | None = Field(default=None, ge=0, le=99_999_999.99)
    # Sell unit name. Stock deducts quantity × unit factor in the base unit.
    sell_unit: str | None = Field(default=None, max_length=64)
    unit_factor: Decimal | None = Field(
        default=None,
        gt=0,
        le=1_000_000,
        decimal_places=4,
    )
    notes: str | None = Field(default=None, max_length=1000)
    # Choices from the item's option groups; the server prices and snapshots them.
    modifier_option_ids: list[str] | None = Field(default=None, max_length=60)
    # Free-form extras typed at the till (not from an option group).
    modifiers: list["OrderItemModifierPayload"] | None = Field(default=None, max_length=30)


class OrderItemModifierPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    price: float = Field(default=0, ge=0, le=99_999_999.99)
    group: str | None = Field(default=None, max_length=120)
    option_id: str | None = Field(default=None, max_length=64)


OrderItemPayload.model_rebuild()


class OrderPaymentSplitPayload(BaseModel):
    method: Literal["mpesa", "cash", "card", "credit", "other"]
    amount: float = Field(gt=0, le=99_999_999.99)


class OrderCreate(BaseModel):
    source: Literal[
        "walkin",
        "phone_call",
        "instagram",
        "whatsapp",
        "tiktok",
        "facebook",
    ]
    fulfillment_type: Literal["pickup", "delivery", "dine_in"]
    table_number: str | None = Field(default=None, max_length=50)

    customer_name: str | None = Field(default=None, max_length=255)
    customer_phone: str | None = Field(default=None, max_length=32)
    customer_email: str | None = Field(default=None, max_length=255)

    delivery_address: str | None = Field(default=None, max_length=2000)
    delivery_notes: str | None = Field(default=None, max_length=2000)

    payment_method: Literal["mpesa", "cash", "card", "credit", "other", "split"] | None = None
    # Required when payment_method="split"; amounts must add up to the order total.
    payments: list[OrderPaymentSplitPayload] | None = Field(default=None, max_length=5)
    # Credit sales: when the customer promises to pay (YYYY-MM-DD).
    date_to_pay: date | str | None = None

    delivery_fee: float | None = Field(default=0, ge=0, le=99_999_999.99)
    discount: float | None = Field(default=0, ge=0, le=99_999_999.99)
    tax: float | None = Field(default=0, ge=0, le=99_999_999.99)
    currency: str = Field(default="KES", min_length=2, max_length=8)

    notes: str | None = Field(default=None, max_length=4000)
    # When set with payment_method=mpesa, skip STK and close the sale with this SMS code
    # (customer paid the merchant's Till/Paybill/phone directly).
    mpesa_receipt_number: str | None = Field(default=None, max_length=50)

    items: list[OrderItemPayload] = Field(min_length=1, max_length=100)


class OrderUpdate(BaseModel):
    """Editing fields on an order while it isn't yet completed.

    The status field is intentionally NOT here — use ``POST /transition``
    instead, which enforces the state machine.
    """

    customer_name: str | None = Field(default=None, max_length=255)
    customer_phone: str | None = Field(default=None, max_length=32)
    customer_email: str | None = Field(default=None, max_length=255)
    delivery_address: str | None = Field(default=None, max_length=2000)
    delivery_notes: str | None = Field(default=None, max_length=2000)
    payment_method: Literal["mpesa", "cash", "card", "credit", "other"] | None = None
    delivery_fee: float | None = Field(default=None, ge=0, le=99_999_999.99)
    discount: float | None = Field(default=None, ge=0, le=99_999_999.99)
    notes: str | None = Field(default=None, max_length=4000)


class OrderTransition(BaseModel):
    to_status: Literal[
        "placed",
        "awaiting_payment",
        "payment_received",
        "being_prepared",
        "ready",
        "out_for_delivery",
        "delivered",
        "picked_up",
        "cancelled",
        "refunded",
    ]
    note: str | None = Field(default=None, max_length=1000)
    mpesa_receipt_number: str | None = Field(default=None, max_length=50)
    # Restaurant cancel / refund: food was made or not returned, so write the stock off as wastage.
    waste_stock: bool = False


class OrderMpesaTransactionUpdate(BaseModel):
    status: Literal["pending", "success", "failed", "cancelled"] | None = None
    phone_number: str | None = Field(default=None, max_length=20)
    amount: int | None = Field(default=None, ge=1, le=300_000)
    result_desc: str | None = Field(default=None, max_length=500)
    mpesa_receipt_number: str | None = Field(default=None, max_length=50)


class AssignRiderRequest(BaseModel):
    rider_id: str = Field(min_length=1, max_length=36)


class HailRiderRequest(BaseModel):
    """Pickup → drop-off rider request, not tied to a kitchen order."""

    pickup_address: str = Field(min_length=1, max_length=2000)
    delivery_address: str = Field(min_length=1, max_length=2000)
    pickup_lat: float | None = Field(default=None, ge=-90, le=90)
    pickup_lng: float | None = Field(default=None, ge=-180, le=180)
    customer_name: str | None = Field(default=None, max_length=255)
    customer_phone: str | None = Field(default=None, max_length=32)
    delivery_notes: str | None = Field(default=None, max_length=2000)
    delivery_fee: float | None = Field(default=150, ge=0, le=99_999_999.99)


class TestDeliveryRequest(BaseModel):
    """Optional overrides for a dummy ready delivery offered to online riders."""

    customer_name: str | None = Field(default=None, max_length=255)
    customer_phone: str | None = Field(default=None, max_length=32)
    pickup_address: str | None = Field(default=None, max_length=2000)
    delivery_address: str | None = Field(default=None, max_length=2000)
    delivery_notes: str | None = Field(default=None, max_length=2000)
    delivery_fee: float | None = Field(default=150, ge=0, le=99_999_999.99)


class SendReceiptEmailIn(BaseModel):
    email: EmailStr | None = None


class SendReceiptWhatsAppIn(BaseModel):
    phone: str | None = Field(default=None, max_length=32)


# --- Endpoints --------------------------------------------------------------


@router.get("")
def list_orders(
    q: str | None = Query(default=None, max_length=255),
    status_filter: str | None = Query(default=None, alias="status"),
    source: str | None = Query(default=None),
    fulfillment_type: str | None = Query(default=None),
    since: datetime | None = Query(
        default=None,
        description="Only orders whose paid/placed/created time is at or after this instant.",
    ),
    until: datetime | None = Query(
        default=None,
        description="Only orders whose paid/placed/created time is before this instant.",
    ),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    if fulfillment_type == FULFILLMENT_DELIVERY:
        assert_merchant_section_any_access(
            user, "orders", "pos", "dashboard", "delivery", "tools",
        )
    else:
        user = _auth_orders_user(db, session, pos_ok=True)
    account_id = _require_shop(user)

    # Hail upkeep only concerns standalone deliveries; walk-in (POS) lists are
    # fetched many pages at a time and must not repeat it per page.
    if source != "walkin":
        from app.services.rider_trip_service import RiderTripService

        trip_service = RiderTripService(db)
        trip_service.repair_cancelled_hails_with_active_rider(account_id)
        trip_service.expire_stale_rider_searches(account_id)

    query = (
        db.query(Order)
        .options(
            selectinload(Order.items).selectinload(OrderItem.inventory_item),
            joinedload(Order.assigned_rider),
            joinedload(Order.placed_by),
            joinedload(Order.mpesa_transaction),
            selectinload(Order.mpesa_transactions),
        )
        .filter(Order.account_id == account_id)
        .order_by(
            Order.created_at.is_(None),
            Order.created_at.desc(),
            Order.id.desc(),
        )
    )

    if status_filter:
        if status_filter not in ALL_STATUSES:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unknown status: {status_filter}",
            )
        query = query.filter(Order.status == status_filter)

    if source:
        if source not in ALL_SOURCES:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unknown source: {source}",
            )
        query = query.filter(Order.source == source)

    if fulfillment_type:
        if fulfillment_type not in ALL_FULFILLMENT_TYPES:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unknown fulfillment type: {fulfillment_type}",
            )
        query = query.filter(Order.fulfillment_type == fulfillment_type)

    if since is not None or until is not None:
        # Same timestamp the Trans Chap dashboard buckets a sale by.
        activity_at = func.coalesce(Order.paid_at, Order.placed_at, Order.created_at)
        if since is not None:
            query = query.filter(activity_at >= naive_utc(since))
        if until is not None:
            query = query.filter(activity_at < naive_utc(until))

    if q:
        term = f"%{q}%"
        query = query.filter(
            or_(
                Order.order_number.ilike(term),
                Order.customer_name.ilike(term),
                Order.customer_phone.ilike(term),
                Order.customer_email.ilike(term),
            ),
        )

    total = query.count()
    rows = query.offset((page - 1) * per_page).limit(per_page).all()

    items = [
        OrderOut.from_model(
            row,
            include_items=True,
            include_history=False,
            allowed_next=allowed_next_statuses(row.status, row.fulfillment_type),
        )
        for row in rows
    ]

    last_page = max(1, (total + per_page - 1) // per_page)
    return {
        "data": items,
        "meta": {
            "current_page": page,
            "last_page": last_page,
            "per_page": per_page,
            "total": total,
        },
    }


@router.get("/track/{token}")
def track_order(token: str, db: Session = Depends(get_db)):
    """Public order progress — no merchant session required.

    The signed token in the URL is the only credential. Returns a
    customer-safe snapshot (no phone, email, or internal notes).
    """
    try:
        service = OrderTrackingService(db)
        payload = service.load(token)
        order = db.query(Order).filter(Order.id == payload.get("order_id")).first()
        if order:
            OrderCompletionService(db).check_pending_finalization(order)
            payload = service.load(token)
        return {"data": payload}
    except OrderTrackingUnavailable as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc))
    except OrderTrackingError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/track/{token}/confirm-receipt")
def track_confirm_receipt(token: str, db: Session = Depends(get_db)):
    try:
        order = OrderTrackingService(db).order_for_token(token)
    except OrderTrackingUnavailable as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc))
    except OrderTrackingError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))

    try:
        OrderCompletionService(db).customer_confirm_receipt(order)
    except OrderCompletionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    db.refresh(order)
    return {
        "message": "Receipt confirmed.",
        "data": OrderTrackingService(db).load(token),
    }


@router.post("/track/{token}/dispute-receipt")
def track_dispute_receipt(token: str, db: Session = Depends(get_db)):
    try:
        order = OrderTrackingService(db).order_for_token(token)
    except OrderTrackingUnavailable as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc))
    except OrderTrackingError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))

    try:
        OrderCompletionService(db).customer_dispute_receipt(order)
    except OrderCompletionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    db.refresh(order)
    return {
        "message": "Issue reported. The shop will follow up with you.",
        "data": OrderTrackingService(db).load(token),
    }


class TrackDeliveryDetailsRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    phone_number: str = Field(min_length=9, max_length=32)
    delivery_location: str = Field(min_length=5, max_length=2000)
    delivery_instructions: str = Field(min_length=3, max_length=2000)


@router.post("/track/{token}/delivery-details")
def track_submit_delivery_details(
    token: str,
    payload: TrackDeliveryDetailsRequest,
    db: Session = Depends(get_db),
):
    try:
        data = OrderTrackingService(db).submit_delivery_details(
            token,
            full_name=payload.full_name,
            phone_number=payload.phone_number,
            delivery_location=payload.delivery_location,
            delivery_instructions=payload.delivery_instructions,
        )
        return {
            "message": "Delivery details saved. Your order will be dispatched soon.",
            "data": data,
        }
    except OrderTrackingUnavailable as exc:
        raise HTTPException(status.HTTP_410_GONE, detail=str(exc))
    except OrderTrackingError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/test-delivery", status_code=status.HTTP_201_CREATED)
def create_test_delivery(
    request: Request,
    payload: TestDeliveryRequest | None = None,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Create a ready dummy delivery and fan out offers to online riders.

    Used from Delivery settings so merchants can test rider dispatch without
    a real hail from Tools → Delivery.
    """
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "delivery", "orders", "tools")
    account_id = _require_shop(user)
    body = payload or TestDeliveryRequest()

    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Shop not found.")
    if not account_has_store_coordinates(account):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=STORE_LOCATION_REQUIRED_FOR_RIDERS,
        )

    shop_location = (account.business_location or "").strip() or "Nairobi"
    shop_name = (account.business_name or "").strip() or "the shop"
    customer_name = (body.customer_name or "").strip() or "Test Customer"
    customer_phone = (body.customer_phone or "").strip() or "+254700000001"
    pickup_address = (body.pickup_address or "").strip() or shop_location
    delivery_address = (
        (body.delivery_address or "").strip()
        or f"Test drop-off near {shop_location}"
    )
    note_parts: list[str] = [
        f"Come to {shop_name} ({shop_location}) for pickup, then deliver to {delivery_address}."
    ]
    if pickup_address.lower() != shop_location.lower():
        note_parts.append(f"Quoted pickup: {pickup_address}.")
    extra_notes = (body.delivery_notes or "").strip()
    note_parts.append(
        extra_notes or "Ring the shop, then continue to the drop-off."
    )
    delivery_notes = " ".join(note_parts)
    delivery_fee = _money(body.delivery_fee if body.delivery_fee is not None else 150)
    unit_price = Decimal("100.00")
    quantity = 1
    subtotal = unit_price * quantity
    total = (subtotal + delivery_fee).quantize(Decimal("0.01"))

    now = datetime.utcnow()
    order = Order(
        account_id=account_id,
        order_number=next_order_number(db, account_id),
        source="walkin",
        fulfillment_type=FULFILLMENT_DELIVERY,
        status=READY,
        customer_name=customer_name,
        customer_phone=customer_phone,
        delivery_address=delivery_address,
        delivery_notes=delivery_notes,
        subtotal=subtotal,
        delivery_fee=delivery_fee,
        discount=Decimal("0.00"),
        total=total,
        currency="KES",
        payment_method="cash",
        placed_by_user_id=user.id,
        placed_at=now,
        paid_at=now,
        prepared_at=now,
        ready_at=now,
        stock_deducted=False,
        notes="Rider request — come to the shop, then deliver to the drop-off.",
        pickup_address=pickup_address,
        pickup_lat=float(account.latitude),
        pickup_lng=float(account.longitude),
        created_at=now,
        updated_at=now,
    )
    insert_order(db, order)

    db.add(
        OrderItem(
            order_id=order.id,
            inventory_item_id=None,
            product_id=None,
            product_name="Test delivery item",
            product_sku="TEST-DELIVERY",
            quantity=quantity,
            unit_price=unit_price,
            line_total=subtotal.quantize(Decimal("0.01")),
            notes="Dummy line — no stock deducted.",
            created_at=now,
            updated_at=now,
        )
    )
    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=None,
            to_status=READY,
            changed_by_user_id=user.id,
            note="Dummy test delivery created ready for rider offers.",
            created_at=now,
        )
    )
    db.commit()
    db.refresh(order)

    from app.services.rider_trip_service import RiderTripService

    trip_service = RiderTripService(db)
    offers = trip_service.fan_out_offers_for_ready_order(order)

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

    db.refresh(order, attribute_names=["items", "status_history"])

    if offers:
        message = (
            f"Test order {order.order_number} offered to {len(offers)} online rider"
            f"{'' if len(offers) == 1 else 's'}."
        )
    elif eligible_count == 0:
        message = (
            f"Test order {order.order_number} is ready, but no eligible online riders "
            "were found. Open the rider app, go online, and dispatch again."
        )
    else:
        message = (
            f"Test order {order.order_number} is ready, but no new offers were created."
        )

    return {
        "message": message,
        "data": {
            "order": OrderOut.from_model(
                order,
                allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
            ),
            "offers_created": len(offers),
            "online_riders": len(online_riders),
            "eligible_riders": eligible_count,
        },
    }


@router.post("/hail-rider", status_code=status.HTTP_201_CREATED)
def hail_rider(
    request: Request,
    payload: HailRiderRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Deprecated alias — prefer POST /api/v1/deliveries/hail."""
    from app.api.v1 import deliveries as deliveries_api

    return deliveries_api.hail_rider(request, payload, db, session)


@router.post("/{order_id}/retry-rider-search")
def retry_rider_search(
    order_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Look for a rider again on a timed-out Tools → Delivery hail."""
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "delivery", "orders", "tools")
    account_id = _require_shop(user)
    order = _get_owned_order(db, account_id, order_id)

    if order.source != SOURCE_RIDER_REQUEST:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only rider hails can be retried from Delivery.",
        )
    if order.assigned_rider_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="This delivery already has a rider assigned.",
        )
    if order.status != CANCELLED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Only timed-out hails can be retried.",
        )

    from app.services.rider_trip_service import (
        RIDER_SEARCH_TTL_SECONDS,
        RiderTripService,
        rider_search_timeout_label,
    )

    now = datetime.utcnow()
    order.status = READY
    order.cancelled_at = None
    order.rider_trip_phase = None
    order.rider_search_expires_at = now + timedelta(seconds=RIDER_SEARCH_TTL_SECONDS)
    order.ready_at = now
    order.updated_at = now
    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=CANCELLED,
            to_status=READY,
            changed_by_user_id=user.id,
            note="Looking for a rider again.",
            created_at=now,
        )
    )
    db.commit()
    db.refresh(order)

    trip_service = RiderTripService(db)
    offers = trip_service.fan_out_offers_for_ready_order(order)

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

    db.refresh(order, attribute_names=["items", "status_history"])

    timeout_note = (
        f" We'll stop looking after {rider_search_timeout_label()} if no one accepts."
    )
    if offers:
        message = (
            f"Looking for a rider again — offered to {len(offers)} online rider"
            f"{'' if len(offers) == 1 else 's'}.{timeout_note}"
        )
    elif eligible_count == 0:
        message = (
            "Looking for a rider again. None are online right now — "
            f"they'll get this as soon as they go online.{timeout_note}"
        )
    else:
        message = f"Looking for a rider again.{timeout_note}"

    return {
        "message": message,
        "data": {
            "order": OrderOut.from_model(
                order,
                allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
            ),
            "offers_created": len(offers),
            "online_riders": len(online_riders),
            "eligible_riders": eligible_count,
        },
    }


@router.get("/{order_id}")
def get_order(
    order_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = _auth_orders_user(db, session, pos_ok=True)
    account_id = _require_shop(user)
    from app.services.rider_trip_service import RiderTripService

    trip_service = RiderTripService(db)
    trip_service.repair_cancelled_hails_with_active_rider(account_id)
    trip_service.expire_stale_rider_searches(account_id)
    order = _get_owned_order(db, account_id, order_id)
    OrderCompletionService(db).check_pending_finalization(order, user_id=user.id)
    db.refresh(order)
    profile = mpesa_service.get_merchant_profile(db, account_id)
    order_out = OrderOut.from_model(
        order,
        allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
    )
    return {
        "data": attach_order_mpesa_settlement(order_out, profile),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_order(
    payload: OrderCreate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_orders_user(db, session, pos_ok=True)
    account_id = _require_shop(user)

    if payload.fulfillment_type == FULFILLMENT_DELIVERY and not (
        payload.delivery_address and payload.delivery_address.strip()
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "errors": {
                    "delivery_address": ["Delivery orders need a delivery address."],
                },
            },
        )

    payment_method = payload.payment_method
    payment_splits: list[dict[str, Any]] | None = None
    if payment_method == PAYMENT_SPLIT:
        payment_splits = normalize_payment_splits(
            [p.model_dump() for p in (payload.payments or [])],
        )
        if len(payment_splits) < 2:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "errors": {
                        "payments": [
                            "Split payments need at least two different payment methods.",
                        ],
                    },
                },
            )
    split_methods = {row["method"] for row in payment_splits or []}
    uses_mpesa = payment_method == PAYMENT_MPESA or PAYMENT_MPESA in split_methods
    uses_credit = payment_method == PAYMENT_CREDIT or PAYMENT_CREDIT in split_methods

    account = db.get(Account, account_id)
    force_mpesa_prompt = (
        account.force_mpesa_prompt
        if account and account.force_mpesa_prompt is not None
        else True
    )

    # STK push needs a phone; typing an SMS code for a direct payment does not.
    direct_mpesa_receipt = (
        (payload.mpesa_receipt_number or "").strip()
        if uses_mpesa
        else ""
    )
    if (
        uses_mpesa
        and force_mpesa_prompt
        and not direct_mpesa_receipt
        and not (payload.customer_phone and payload.customer_phone.strip())
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "errors": {
                    "customer_phone": [
                        "Customer phone is required to send the M-PESA prompt.",
                    ],
                },
            },
        )

    if (
        uses_mpesa
        and force_mpesa_prompt
        and not mpesa_service.get_merchant_profile(db, account_id)
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "errors": {
                    "payment_method": [
                        "Set your M-PESA payout details in Settings before taking M-PESA payments.",
                    ],
                },
            },
        )

    if uses_credit:
        if not (payload.customer_name and payload.customer_name.strip()):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "errors": {
                        "customer_name": [
                            "Customer name is required for credit sales.",
                        ],
                    },
                },
            )
        if not (payload.customer_phone and payload.customer_phone.strip()):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "errors": {
                        "customer_phone": [
                            "Customer phone is required for credit sales.",
                        ],
                    },
                },
            )

    # Resolve & snapshot every line up front so we either accept the whole
    # order or fail before writing anything.
    # Tuple: payload, inv, price, display_name, sku, sell_unit_label, unit_factor
    resolved_lines: list[
        tuple[
            OrderItemPayload,
            InventoryItem | None,
            Decimal,
            str,
            str | None,
            str | None,
            Decimal,
        ]
    ] = []
    line_modifiers: list[list[dict] | None] = []
    line_usage: list[list[dict] | None] = []
    for idx, line in enumerate(payload.items):
        inv_item: InventoryItem | None = None
        sell_unit_label: str | None = None
        unit_factor = Decimal("1")
        resolved_unit: dict[str, Any] | None = None
        if line.inventory_item_id:
            inv_item = (
                db.query(InventoryItem)
                .options(joinedload(InventoryItem.product))
                .filter(
                    InventoryItem.id == line.inventory_item_id,
                    InventoryItem.account_id == account_id,
                )
                .first()
            )
            if not inv_item:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "errors": {
                            f"items.{idx}.inventory_item_id": [
                                "Not found in your inventory.",
                            ],
                        },
                    },
                )
            if not inv_item.is_saleable():
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "errors": {
                            f"items.{idx}.inventory_item_id": [
                                "This item is a raw material and cannot be sold.",
                            ],
                        },
                    },
                )
            try:
                resolved_unit = resolve_sell_unit(inv_item, line.sell_unit)
            except ValueError as exc:
                if line.unit_factor is not None and line.sell_unit:
                    if line.unit_factor < 1:
                        product_unit = (
                            (inv_item.product.unit or "").strip().lower()
                            if inv_item.product
                            else ""
                        )
                        allowed_fraction = {
                            "1/4 kg": Decimal("0.25"),
                            "1/2 kg": Decimal("0.5"),
                            "3/4 kg": Decimal("0.75"),
                            "1/4 l": Decimal("0.25"),
                            "1/2 l": Decimal("0.5"),
                            "3/4 l": Decimal("0.75"),
                        }
                        normalized_label = line.sell_unit.strip().lower()
                        is_weight_volume = product_unit in {
                            "kg",
                            "kgs",
                            "kg(s)",
                            "kilogram",
                            "kilograms",
                            "kilogram(s)",
                            "l",
                            "ls",
                            "l(s)",
                            "liter",
                            "liters",
                            "litre",
                            "litres",
                            "liter(s)",
                            "litre(s)",
                        }
                        expected_factor = allowed_fraction.get(normalized_label)
                        if (
                            not is_weight_volume
                            or expected_factor is None
                            or line.unit_factor != expected_factor
                        ):
                            raise HTTPException(
                                status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail={
                                    "errors": {
                                        f"items.{idx}.sell_unit": [
                                            "Fractional sell units are supported only for kilogram and litre products.",
                                        ],
                                    },
                                },
                            ) from exc
                    resolved_unit = {
                        "name": line.sell_unit.strip(),
                        "factor": line.unit_factor,
                    }
                else:
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail={
                            "errors": {
                                f"items.{idx}.sell_unit": [str(exc)],
                            },
                        },
                    ) from exc
            if line.unit_factor is not None and not line.sell_unit:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "errors": {
                            f"items.{idx}.unit_factor": [
                                "A sell unit is required when providing a unit factor.",
                            ],
                        },
                    },
                )
            unit_factor = (
                line.unit_factor
                if line.unit_factor is not None
                else Decimal(str(resolved_unit["factor"]))
            )
            sell_unit_label = (
                str(resolved_unit["name"])
                if unit_factor != 1
                else None
            )

        # Resolve display name + price from the snapshot or the explicit payload.
        if inv_item and inv_item.product:
            name = (line.product_name or inv_item.product.name).strip()
            sku = line.product_sku or inv_item.product.sku
            pack_price = (resolved_unit or {}).get("selling_price")
            default_price = (
                Decimal(str(pack_price))
                if pack_price is not None
                else (
                    Decimal(str(inv_item.selling_price))
                    if inv_item.selling_price is not None
                    else Decimal("0")
                )
            )
            price = (
                _money(line.unit_price)
                if line.unit_price is not None
                else default_price
            )
            if unit_factor != 1 and resolved_unit:
                name = f"{name} ({resolved_unit['name']})"
        else:
            if (line.sell_unit and str(line.sell_unit).strip()) or line.unit_factor is not None:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "errors": {
                            f"items.{idx}.sell_unit": [
                                "Sell units require an inventory item.",
                            ],
                        },
                    },
                )
            if not line.product_name or not line.product_name.strip():
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "errors": {
                            f"items.{idx}.product_name": [
                                "A product name is required for custom items.",
                            ],
                        },
                    },
                )
            if line.unit_price is None:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "errors": {
                            f"items.{idx}.unit_price": [
                                "A unit price is required for custom items.",
                            ],
                        },
                    },
                )
            name = line.product_name.strip()
            sku = (line.product_sku or "").strip() or None
            price = _money(line.unit_price)

        custom_mods = [
            {
                "group": (mod.group or "").strip() or "Extras",
                "name": mod.name.strip(),
                "price": float(_money(mod.price)),
            }
            for mod in line.modifiers or []
            if not mod.option_id
        ]
        snapshot: list[dict] | None = None
        chosen_options: list = []
        if line.modifier_option_ids is not None:
            if not (inv_item and inv_item.product):
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "errors": {
                            f"items.{idx}.modifier_option_ids": [
                                "Choices can only be added to menu items.",
                            ],
                        },
                    },
                )
            try:
                resolved = resolve_line_options(
                    db, account_id, inv_item.product, line.modifier_option_ids,
                )
            except LineOptionsError as exc:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"errors": {f"items.{idx}.modifier_option_ids": [str(exc)]}},
                ) from exc
            price = (
                default_price
                + resolved.price_delta
                + sum((_money(m["price"]) for m in custom_mods), Decimal("0"))
            ).quantize(Decimal("0.01"))
            if resolved.size_label and inv_item.product.is_combo():
                name = f"{name} ({resolved.size_label})"
            snapshot = resolved.modifiers + custom_mods
            chosen_options = resolved.chosen
        elif line.modifiers:
            snapshot = [mod.model_dump(exclude_none=True) for mod in line.modifiers]
        line_modifiers.append(snapshot or None)
        line_usage.append(
            line_stock_usage(db, account_id, inv_item.product, chosen_options) or None
            if inv_item and inv_item.product
            else None
        )

        resolved_lines.append(
            (line, inv_item, price, name, sku, sell_unit_label, unit_factor),
        )

    # Money roll-up.
    subtotal = sum(
        (price * line.quantity for line, _, price, _, _, _, _ in resolved_lines),
        Decimal("0"),
    )
    delivery_fee = _money(payload.delivery_fee)
    discount = _money(payload.discount)
    tax = _money(payload.tax)
    total = (subtotal + delivery_fee + tax - discount).quantize(Decimal("0.01"))
    if total < 0:
        total = Decimal("0.00")

    if payment_splits is not None:
        split_total = sum((_money(row["amount"]) for row in payment_splits), Decimal("0"))
        if split_total != total:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "errors": {
                        "payments": [
                            f"Split amounts add up to {split_total:,.2f} but the "
                            f"order total is {total:,.2f}.",
                        ],
                    },
                },
            )

    now = datetime.utcnow()
    order = Order(
        account_id=account_id,
        order_number=next_order_number(db, account_id),
        source=payload.source,
        fulfillment_type=payload.fulfillment_type,
        table_number=(payload.table_number or "").strip() or None,
        status=PLACED,
        customer_name=(payload.customer_name or "").strip() or None,
        customer_phone=(payload.customer_phone or "").strip() or None,
        customer_email=(payload.customer_email or "").strip() or None,
        delivery_address=(payload.delivery_address or "").strip() or None,
        delivery_notes=(payload.delivery_notes or "").strip() or None,
        subtotal=subtotal,
        delivery_fee=delivery_fee,
        tax=tax,
        discount=discount,
        total=total,
        currency=payload.currency.upper(),
        payment_method=payment_method,
        payment_splits=payment_splits,
        placed_by_user_id=user.id,
        placed_at=now,
        notes=(payload.notes or "").strip() or None,
        created_at=now,
        updated_at=now,
    )
    insert_order(db, order)

    order_items: list[OrderItem] = []
    for (line, inv_item, price, name, sku, sell_unit_label, unit_factor), modifiers, usage in zip(
        resolved_lines, line_modifiers, line_usage,
    ):
        item = OrderItem(
            order_id=order.id,
            inventory_item_id=inv_item.id if inv_item else None,
            product_id=inv_item.product_id if inv_item else None,
            product_name=name,
            product_sku=sku,
            quantity=line.quantity,
            unit_price=price,
            line_total=(price * line.quantity).quantize(Decimal("0.01")),
            sell_unit=sell_unit_label,
            unit_factor=unit_factor,
            modifiers=modifiers,
            stock_usage=usage,
            notes=line.notes,
            created_at=now,
            updated_at=now,
        )
        db.add(item)
        order_items.append(item)

    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=None,
            to_status=PLACED,
            changed_by_user_id=user.id,
            note="Order placed.",
            created_at=now,
        ),
    )

    shop = db.get(Account, account_id)
    try:
        if is_restaurant(shop):
            db.flush()  # order item ids for the ledger links
            consume_for_order(db, order, order_items, account=shop, user_id=user.id)
        else:
            if deduct_stock(
                db,
                [
                    (inv_item.id, line.quantity * unit_factor)
                    for line, inv_item, _, _, _, _, unit_factor in resolved_lines
                    if inv_item
                ]
                + [
                    stock_line
                    for (line, *_), usage in zip(resolved_lines, line_usage)
                    for stock_line in stock_usage_lines(
                        usage, Decimal(str(line.quantity)), recipe=False,
                    )
                ],
                account_id=account_id,
            ):
                order.stock_deducted = True
            if deduct_stock(
                db,
                [
                    stock_line
                    for (line, *_), usage in zip(resolved_lines, line_usage)
                    for stock_line in stock_usage_lines(
                        usage, Decimal(str(line.quantity)), recipe=True,
                    )
                ],
                account_id=account_id,
                allow_negative=True,
            ):
                order.stock_deducted = True
    except InsufficientStockError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    credit_customer = None
    if uses_credit:
        try:
            customers = CustomerService(db)
            credit_customer = customers.get_or_create_for_sale(
                str(account_id),
                name=payload.customer_name or "",
                phone=payload.customer_phone or "",
            )
            customers.charge_credit(
                credit_customer,
                payment_portion(order, PAYMENT_CREDIT),
                date_to_pay=payload.date_to_pay,
            )
            order.customer_name = credit_customer.name
            order.customer_phone = credit_customer.phone
        except CustomerServiceError as exc:
            db.rollback()
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc

    # Manual M-PESA confirmation is only available when STK is disabled.
    # Receipt codes are optional; without one, the cashier confirms payment.
    push_result: dict[str, str] | None = None
    if uses_mpesa and not force_mpesa_prompt:
        try:
            matched_txn = confirm_mpesa_receipt_for_order(
                db,
                order,
                direct_mpesa_receipt,
                confirmed_by_user_id=user.id,
            )
        except ValueError as exc:
            db.rollback()
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
        link_mpesa_transaction_to_order(db, order, matched_txn)
        prev_status = order.status
        now_paid = datetime.utcnow()
        order.status = PAYMENT_RECEIVED
        order.paid_at = now_paid
        order.updated_at = now_paid
        db.add(
            OrderStatusHistory(
                order_id=order.id,
                from_status=prev_status,
                to_status=PAYMENT_RECEIVED,
                changed_by_user_id=user.id,
                note=(
                    "M-PESA payment confirmed with SMS code "
                    f"{matched_txn.mpesa_receipt_number}."
                ),
                created_at=now_paid,
            ),
        )
        push_result = {
            "status": "confirmed",
            "message": (
                f"M-PESA code {matched_txn.mpesa_receipt_number} recorded. Sale closed."
            ),
        }

    db.commit()
    db.refresh(order)
    if credit_customer is not None:
        db.refresh(credit_customer)

    try:
        from app.services.merchant_notification_service import MerchantNotificationService

        MerchantNotificationService(db).notify_order_status(
            order,
            order.status if order.status == PAYMENT_RECEIVED else PLACED,
        )
    except Exception:
        logger.exception("Merchant dashboard notification failed order_id=%s", order.id)

    if (
        payment_method is not None
        and payment_methods(order) <= {PAYMENT_CASH, PAYMENT_CARD}
        and (order.customer_phone or "").strip()
    ):
        try:
            from app.services.order_notification_service import OrderNotificationService

            OrderNotificationService(db).notify_customer_whatsapp(
                order,
                PLACED,
                force=True,
            )
        except Exception:
            logger.exception("Customer WhatsApp notification failed order_id=%s", order.id)

    credit_tab: dict[str, object] | None = None
    if credit_customer is not None:
        from app.services.credit_pay_service import CreditPayService
        from app.services.order_notification_service import OrderNotificationService

        outstanding = float(credit_customer.outstanding_balance or 0)
        pay_bill_url = CreditPayService.pay_bill_url(credit_customer.id)
        credit_tab = {
            "customer_id": credit_customer.id,
            "customer_name": credit_customer.name,
            "outstanding_balance": outstanding,
            "credit_limit": float(credit_customer.credit_limit or 0),
            "pay_bill_url": pay_bill_url,
        }
        if (order.customer_phone or "").strip():
            try:
                OrderNotificationService(db).notify_customer_receipt_whatsapp(
                    order,
                    order.customer_phone,
                    credit_outstanding=outstanding,
                    pay_bill_url=pay_bill_url,
                )
            except Exception:
                logger.exception(
                    "Credit WhatsApp receipt failed order_id=%s",
                    order.id,
                )

    # STK push after commit so the receipt can link to a real order id.
    # Failures are non-fatal — cashier can retry or enter a code later.
    if (
        uses_mpesa
        and force_mpesa_prompt
        and not direct_mpesa_receipt
    ):
        push_result = _trigger_mpesa_for_order(
            db,
            order,
            initiated_by_user_id=user.id,
        )

    db.refresh(order, attribute_names=["items", "status_history", "mpesa_transaction", "mpesa_transactions"])

    response: dict[str, object] = {
        "message": "Order placed.",
        "data": OrderOut.from_model(
            order,
            allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
        ),
    }
    if push_result is not None:
        response["mpesa_push"] = push_result
    if credit_tab is not None:
        response["credit_tab"] = credit_tab
    return response


def _trigger_mpesa_for_order(
    db: Session,
    order: Order,
    *,
    initiated_by_user_id: str | None,
) -> dict[str, str]:
    """Send an STK push for ``order`` and link the resulting transaction.

    On success: links ``order.mpesa_transaction_id``, transitions the
    order to ``awaiting_payment``, and records a status history entry.
    On failure: returns an error result without raising so the caller
    can keep the order at its current status.
    """
    if order.total is None:
        return {
            "status": "skipped",
            "message": "Order total is missing.",
        }

    profile = (
        mpesa_service.get_merchant_profile(db, order.account_id)
        if order.account_id
        else None
    )
    if not profile:
        return {
            "status": "not_configured",
            "message": (
                "Set your M-PESA payout details in Settings before taking M-PESA payments."
            ),
        }
    from app.support.mpesa_amounts import min_collection_kes

    min_kes = min_collection_kes(
        profile.shortcode_type if profile else None,
        sandbox=mpesa_service.use_mpesa_sandbox(db),
    )
    mpesa_due = float(payment_portion(order, PAYMENT_MPESA))
    if mpesa_due < min_kes:
        return {
            "status": "skipped",
            "message": f"M-PESA amount is below M-PESA's minimum of KES {min_kes}.",
        }

    amount = int(round(mpesa_due))
    try:
        txn = mpesa_service.stk_push(
            db,
            phone_number=order.customer_phone or "",
            amount=amount,
            account_reference=order.order_number,
            transaction_desc=f"Order {order.order_number}",
            initiated_by_user_id=initiated_by_user_id,
            account_id=order.account_id,
        )
    except MpesaConfigurationMissing as exc:
        return {"status": "not_configured", "message": str(exc)}
    except MpesaApiError as exc:
        return {"status": "failed", "message": str(exc)}

    now = datetime.utcnow()
    link_mpesa_transaction_to_order(db, order, txn)
    prev_status = order.status
    if order.status == PLACED:
        order.status = AWAITING_PAYMENT
        db.add(
            OrderStatusHistory(
                order_id=order.id,
                from_status=prev_status,
                to_status=AWAITING_PAYMENT,
                changed_by_user_id=initiated_by_user_id,
                note=f"M-PESA STK push sent to {txn.phone_number}.",
                created_at=now,
            ),
        )
    order.updated_at = now
    db.commit()
    db.refresh(order)
    return {
        "status": "sent",
        "message": f"STK push sent to {txn.phone_number}. Ask the customer to check their phone.",
    }


@router.patch("/{order_id}")
def update_order(
    order_id: str,
    payload: OrderUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_orders_user(db, session)
    account_id = _require_shop(user)

    order = _get_owned_order(db, account_id, order_id)
    if order.status in TERMINAL_STATUSES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="This order is closed and can no longer be edited.",
        )

    data = payload.model_dump(exclude_unset=True)
    previous_total = _money(order.total)
    previous_credit = payment_portion(order, PAYMENT_CREDIT)
    previous_phone = order.customer_phone
    for key, value in data.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(order, key, value)
    if "payment_method" in data:
        order.payment_splits = None

    # Recompute total if fee/discount changed.
    if "delivery_fee" in data or "discount" in data:
        order.total = (
            Decimal(str(order.subtotal or 0))
            + Decimal(str(order.delivery_fee or 0))
            + Decimal(str(order.tax or 0))
            - Decimal(str(order.discount or 0))
        ).quantize(Decimal("0.01"))
        if order.total < 0:
            order.total = Decimal("0.00")
        if order.payment_method == PAYMENT_SPLIT and _money(order.total) != previous_total:
            db.rollback()
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="This order was paid with split payments, so its total can't change.",
            )

    new_credit = payment_portion(order, PAYMENT_CREDIT)
    if previous_credit > 0 or new_credit > 0:
        try:
            CustomerService(db).rebalance_order_credit(
                str(account_id),
                previous_phone=previous_phone,
                previous_amount=previous_credit,
                phone=order.customer_phone,
                name=order.customer_name,
                amount=new_credit,
            )
        except CustomerServiceError as exc:
            db.rollback()
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc

    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    db.refresh(order, attribute_names=["items", "status_history"])

    return {
        "message": "Order updated.",
        "data": OrderOut.from_model(
            order,
            allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
        ),
    }


@router.post("/{order_id}/transition")
def transition_order(
    order_id: str,
    payload: OrderTransition,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Move ``order`` to ``to_status``, enforcing the state machine.

    Also stamps the matching milestone timestamp (``paid_at``, ``ready_at``,
    etc.) so reporting can avoid an extra join against status history.
    """
    validate_csrf(request, session)
    user = _auth_orders_user(db, session, pos_ok=True)
    account_id = _require_shop(user)

    order = _get_owned_order(db, account_id, order_id)
    target = payload.to_status

    if order.status == target:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Order is already {target}.",
        )

    if not can_transition(order.status, target, order.fulfillment_type):
        legal = ", ".join(
            allowed_next_statuses(order.status, order.fulfillment_type)
        ) or "no further moves"
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Cannot move from '{order.status}' to '{target}'. Allowed: {legal}.",
        )

    if target in (DELIVERED, PICKED_UP):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Use Confirm delivery / Confirm handover to close this order.",
        )

    if target in (CANCELLED, REFUNDED) and order.source == SOURCE_WALKIN:
        require_store_admin(user, "Only the store admin can void a sale.")

    if target == OUT_FOR_DELIVERY and order_needs_delivery_details(order):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Customer delivery details are required before dispatch.",
        )

    transition_note = (payload.note or "").strip() or None
    if target == CANCELLED:
        if not transition_note:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A rejection reason is required when cancelling an order.",
            )
    if target == PAYMENT_RECEIVED and order_requires_mpesa_receipt_confirmation(order):
        receipt = (payload.mpesa_receipt_number or "").strip()
        if receipt:
            try:
                matched_txn = confirm_mpesa_receipt_for_order(
                    db,
                    order,
                    receipt,
                    confirmed_by_user_id=user.id,
                )
            except ValueError as exc:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=str(exc),
                ) from exc
            link_mpesa_transaction_to_order(db, order, matched_txn)
            transition_note = (
                transition_note
                or f"M-PESA payment confirmed. Receipt {matched_txn.mpesa_receipt_number}."
            )
        else:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "Enter the M-PESA transaction code from the customer's SMS "
                    "before marking paid."
                ),
            )

    now = datetime.utcnow()
    previous = order.status
    order.status = target
    order.updated_at = now

    # Stamp milestone timestamps.
    if target == PAYMENT_RECEIVED and not order.paid_at:
        order.paid_at = now
    if target == BEING_PREPARED and not order.prepared_at:
        order.prepared_at = now
    if target == READY and not order.ready_at:
        order.ready_at = now
    if target == OUT_FOR_DELIVERY and not order.dispatched_at:
        order.dispatched_at = now
    if target in (DELIVERED, PICKED_UP) and not order.completed_at:
        order.completed_at = now
    if target == CANCELLED and not order.cancelled_at:
        order.cancelled_at = now
    if target in (CANCELLED, REFUNDED):
        release_order_holds(db, order, wastage=payload.waste_stock, user_id=user.id)

    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=previous,
            to_status=target,
            changed_by_user_id=user.id,
            note=transition_note,
            created_at=now,
        ),
    )

    db.commit()
    db.refresh(order)
    db.refresh(order, attribute_names=["items", "status_history", "mpesa_transaction", "mpesa_transactions"])

    if target == READY and order.fulfillment_type == "delivery" and not order.assigned_rider_id:
        from app.services.rider_trip_service import RiderTripService

        try:
            RiderTripService(db).fan_out_offers_for_ready_order(order)
        except Exception:
            logger.exception("Failed to fan out rider offers for order %s", order.id)

    if order.source_conversation_id:
        from app.services.order_notification_service import notify_order_status_change

        notify_order_status_change(db, order.id, user_id=user.id)

    return {
        "message": f"Order moved to {target}.",
        "data": OrderOut.from_model(
            order,
            allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
        ),
    }


@router.patch("/{order_id}/mpesa-transactions/{transaction_id}")
def update_order_mpesa_transaction(
    order_id: str,
    transaction_id: str,
    payload: OrderMpesaTransactionUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_orders_user(db, session)
    account_id = _require_shop(user)

    order = _get_owned_order(db, account_id, order_id, eager=False)
    txn = (
        db.query(MpesaTransaction)
        .filter(
            MpesaTransaction.id == transaction_id,
            MpesaTransaction.order_id == order.id,
        )
        .first()
    )
    if not txn:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="M-PESA transaction not found for this order.",
        )

    updates = payload.model_dump(exclude_unset=True)
    now = datetime.utcnow()
    for key, value in updates.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(txn, key, value)

    if "status" in updates:
        if txn.status == "pending":
            txn.completed_at = None
        elif not txn.completed_at:
            txn.completed_at = now

    txn.updated_at = now
    order.updated_at = now

    db.commit()
    db.refresh(order)
    db.refresh(
        order,
        attribute_names=["items", "status_history", "mpesa_transaction", "mpesa_transactions"],
    )

    return {
        "message": "M-PESA transaction updated.",
        "data": OrderOut.from_model(
            order,
            allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
        ),
    }


@router.post("/{order_id}/assign-rider")
def assign_order_rider(
    order_id: str,
    payload: AssignRiderRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_orders_user(db, session)
    account_id = _require_shop(user)

    from app.services.rider_service import RiderService, RiderServiceError

    order = _get_owned_order(db, account_id, order_id)
    service = RiderService(db)
    try:
        order = service.assign_order(account_id, order, payload.rider_id)
    except RiderServiceError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    db.refresh(order, attribute_names=["items", "status_history", "assigned_rider"])
    return {
        "message": "Rider assigned.",
        "data": OrderOut.from_model(
            order,
            allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
        ),
    }


@router.post("/{order_id}/confirm-handoff")
def confirm_order_handoff(
    order_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_orders_user(db, session, pos_ok=True)
    account_id = _require_shop(user)

    order = _get_owned_order(db, account_id, order_id)
    try:
        OrderCompletionService(db).merchant_confirm_handoff(order, user_id=user.id)
    except OrderCompletionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))

    db.refresh(order)
    db.refresh(order, attribute_names=["items", "status_history"])
    return {
        "message": "Handoff confirmed.",
        "data": OrderOut.from_model(
            order,
            allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
        ),
    }


@router.post("/{order_id}/resend-completion-prompt")
def resend_completion_prompt(
    order_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_orders_user(db, session)
    account_id = _require_shop(user)

    order = _get_owned_order(db, account_id, order_id, eager=False)
    sent = OrderCompletionService(db).resend_completion_prompt(order)
    if not sent:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Customer confirmation cannot be resent for this order.",
        )

    db.refresh(order)
    db.refresh(order, attribute_names=["items", "status_history"])
    return {
        "message": "Confirmation request sent to customer.",
        "data": OrderOut.from_model(
            order,
            allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
        ),
    }


def _order_mpesa_transaction(order: Order):
    txn = order.mpesa_transaction
    if txn is not None:
        return txn
    rows = list(order.mpesa_transactions or [])
    pending = next((row for row in rows if row.status == "pending"), None)
    return pending or (rows[0] if rows else None)


@router.post("/{order_id}/mpesa-check")
def check_mpesa_stk_push(
    order_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Ask Safaricom whether a waiting STK already completed."""
    validate_csrf(request, session)
    user = _auth_orders_user(db, session, pos_ok=True)
    account_id = _require_shop(user)
    order = _get_owned_order(db, account_id, order_id)
    txn = _order_mpesa_transaction(order)
    if txn is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No M-PESA prompt has been sent for this sale yet.",
        )
    try:
        outcome = mpesa_service.refresh_pending_stk(db, txn)
    except MpesaApiError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=merchant_safe_stk_error(str(exc)),
        ) from exc

    db.refresh(order, attribute_names=["items", "status_history", "mpesa_transaction", "mpesa_transactions"])
    if outcome == "paid":
        message = "The customer already paid. This sale is now complete."
    elif outcome == "failed":
        message = txn.result_desc or "The M-PESA prompt did not go through. Send it again."
    else:
        message = "Still waiting. Ask the customer to finish on their phone, or send the prompt again."
    return {
        "message": message,
        "outcome": outcome,
        "data": OrderOut.from_model(
            order,
            allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
        ),
    }


@router.post("/{order_id}/mpesa-stk-push")
def resend_mpesa_stk_push(
    order_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Re-send an M-PESA STK push for an order that hasn't been paid yet.

    Useful when the customer's phone is off, the prompt was dismissed,
    or the original push failed (no Daraja config, network error, etc).
    Refuses on terminal/post-payment orders to avoid double-charging.
    """
    validate_csrf(request, session)
    user = _auth_orders_user(db, session, pos_ok=True)
    account_id = _require_shop(user)
    account = db.get(Account, account_id)
    if account is not None and account.force_mpesa_prompt is False:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=(
                "M-PESA prompts are disabled for this business. Record the payment "
                "using the customer's receipt code."
            ),
        )

    order = _get_owned_order(db, account_id, order_id)
    if order.status in TERMINAL_STATUSES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="This order is closed; no new payment can be requested.",
        )
    if order.status == PAYMENT_RECEIVED or order.paid_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="This order has already been paid.",
        )
    if not (order.customer_phone and order.customer_phone.strip()):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "errors": {
                    "customer_phone": [
                        "Add a customer phone number before sending the M-PESA prompt.",
                    ],
                },
            },
        )

    # Ensure the order is recorded as expecting an M-PESA payment so the
    # callback flow can advance it to ``payment_received`` later on.
    if not order_uses_payment(order, PAYMENT_MPESA):
        order.payment_method = PAYMENT_MPESA
        order.payment_splits = None

    push_result = _trigger_mpesa_for_order(
        db,
        order,
        initiated_by_user_id=user.id,
    )

    if push_result["status"] not in {"sent"}:
        # 502 keeps the response shape consistent with the rest of the
        # Daraja-facing routes when the upstream/config is the problem.
        http_status = (
            status.HTTP_400_BAD_REQUEST
            if push_result["status"] == "not_configured"
            else status.HTTP_502_BAD_GATEWAY
        )
        raise HTTPException(http_status, detail=push_result["message"])

    db.refresh(order, attribute_names=["items", "status_history", "mpesa_transaction", "mpesa_transactions"])
    return {
        "message": push_result["message"],
        "mpesa_push": push_result,
        "data": OrderOut.from_model(
            order,
            allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
        ),
    }


@router.post("/{order_id}/send-receipt-email")
def send_receipt_email(
    order_id: str,
    payload: SendReceiptEmailIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Email the customer a branded receipt for this order."""
    validate_csrf(request, session)
    user = _auth_orders_user(db, session, pos_ok=True)
    account_id = _require_shop(user)
    order = _get_owned_order(db, account_id, order_id)

    from app.services.email_service import EmailService
    from app.services.order_notification_service import OrderNotificationService

    mail = EmailService()
    if not mail.settings.mail_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email sending is disabled. Set MAIL_ENABLED=true to send receipts.",
        )
    if not mail.configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email is not configured. Set MAILTRAP_API_TOKEN to send receipts.",
        )

    to = str(payload.email or order.customer_email or "").strip()
    if not to:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "errors": {
                    "email": ["Enter the customer's email address."],
                },
            },
        )

    if order.customer_email != to:
        order.customer_email = to
        db.commit()
        db.refresh(order)

    sent = OrderNotificationService(db).notify_customer_receipt_email(order, to)
    if not sent:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail="Could not send the receipt email. Try again in a moment.",
        )

    db.refresh(order, attribute_names=["items", "status_history", "mpesa_transaction", "mpesa_transactions"])
    return {
        "message": f"Receipt sent to {to}.",
        "recipient": to,
        "data": OrderOut.from_model(
            order,
            allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
        ),
    }


@router.post("/{order_id}/send-receipt-whatsapp")
def send_receipt_whatsapp(
    order_id: str,
    payload: SendReceiptWhatsAppIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Send a till-style receipt via the platform WhatsApp agent (openWA)."""
    validate_csrf(request, session)
    user = _auth_orders_user(db, session, pos_ok=True)
    account_id = _require_shop(user)
    order = _get_owned_order(db, account_id, order_id)

    from app.services.openwa_service import OpenWaAgentService
    from app.services.order_notification_service import OrderNotificationService
    from app.services.rider_service import normalize_phone

    agent = OpenWaAgentService()
    if not agent.configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "WhatsApp is not configured. Set OPENWA_AGENT_TOKEN and start the "
                "WhatsApp agent (Admin → WhatsApp)."
            ),
        )

    raw_phone = str(payload.phone or order.customer_phone or "").strip()
    phone = normalize_phone(raw_phone) if raw_phone else ""
    if not phone:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "errors": {
                    "phone": ["Enter the customer's WhatsApp number."],
                },
            },
        )

    if (order.customer_phone or "").strip() != phone:
        order.customer_phone = phone
        db.commit()
        db.refresh(order)

    result = OrderNotificationService(db).notify_customer_receipt_whatsapp(order, phone)
    if not result.ok:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=result.error or "Could not send the WhatsApp receipt. Try again.",
        )

    db.refresh(order, attribute_names=["items", "status_history", "mpesa_transaction", "mpesa_transactions"])
    return {
        "message": f"Receipt sent on WhatsApp to {phone}.",
        "recipient": phone,
        "data": OrderOut.from_model(
            order,
            allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
        ),
    }


@router.delete("/{order_id}")
def delete_order(
    order_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Hard-delete an order. Only allowed while still in 'placed' state —
    after that the audit trail matters and you should cancel instead."""
    validate_csrf(request, session)
    user = _auth_orders_user(db, session)
    account_id = _require_shop(user)

    order = _get_owned_order(db, account_id, order_id, eager=False)
    if order.status != PLACED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Only orders still in 'placed' can be deleted. Cancel it instead.",
        )
    if order.source == SOURCE_WALKIN:
        require_store_admin(user, "Only the store admin can void a sale.")

    release_order_holds(db, order, user_id=user.id)

    db.delete(order)
    db.commit()
    return {"message": "Order deleted."}


# --- Metadata --------------------------------------------------------------


@router.get("/meta/options")
def get_meta_options(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Static lists the frontend needs to render dropdowns + status pills.

    Kept on the server so adding a new source or status doesn't require a
    coordinated frontend deploy.
    """
    _auth_orders_user(db, session, pos_ok=True)
    return {
        "sources": list(ALL_SOURCES),
        "fulfillment_types": list(ALL_FULFILLMENT_TYPES),
        "statuses": list(ALL_STATUSES),
        "payment_methods": list(ALL_PAYMENT_METHODS),
    }
