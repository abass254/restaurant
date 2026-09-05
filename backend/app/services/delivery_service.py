"""Delivery records — standalone hails and order-linked trips."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Account, Delivery, Order
from app.support.delivery_status import (
    DELIVERY_ACTIVE,
    DELIVERY_CANCELLED,
    DELIVERY_COMPLETED,
    DELIVERY_SEARCHING,
)
from app.support.order_status import FULFILLMENT_DELIVERY, READY


def next_delivery_number(db: Session, account_id: str) -> str:
    seq = (
        db.query(func.count(Delivery.id))
        .filter(Delivery.account_id == account_id)
        .scalar()
        or 0
    ) + 1
    while True:
        candidate = f"DEL-{seq:06d}"
        exists = (
            db.query(Delivery.id)
            .filter(Delivery.delivery_number == candidate)
            .first()
        )
        if not exists:
            return candidate
        seq += 1


class DeliveryService:
    def __init__(self, db: Session):
        self.db = db

    def is_standalone(self, delivery: Delivery) -> bool:
        return delivery.order_id is None

    def ensure_for_order(self, order: Order, *, now: datetime | None = None) -> Delivery:
        """Create or return the delivery linked to a kitchen order."""
        if order.delivery_id:
            existing = self.db.get(Delivery, order.delivery_id)
            if existing:
                return existing

        stamp = now or datetime.utcnow()
        if order.status in {"delivered", "cancelled", "refunded"}:
            status = DELIVERY_COMPLETED if order.status == "delivered" else DELIVERY_CANCELLED
        elif order.assigned_rider_id:
            status = DELIVERY_ACTIVE
        elif order.status == READY:
            status = DELIVERY_SEARCHING
        else:
            status = DELIVERY_SEARCHING

        account = self.db.get(Account, order.account_id)
        pickup_lat = order.pickup_lat
        pickup_lng = order.pickup_lng
        pickup_address = (order.pickup_address or "").strip() or None
        if pickup_lat is None or pickup_lng is None:
            if account and account.latitude is not None and account.longitude is not None:
                pickup_lat = account.latitude
                pickup_lng = account.longitude
            if not pickup_address and account:
                pickup_address = (account.business_location or "").strip() or None

        delivery = Delivery(
            account_id=order.account_id,
            order_id=order.id,
            delivery_number=next_delivery_number(self.db, order.account_id),
            pickup_address=pickup_address,
            pickup_lat=pickup_lat,
            pickup_lng=pickup_lng,
            delivery_address=order.delivery_address,
            delivery_notes=order.delivery_notes,
            customer_name=order.customer_name,
            customer_phone=order.customer_phone,
            delivery_fee=order.delivery_fee or Decimal("0.00"),
            currency=order.currency or "KES",
            status=status,
            assigned_rider_id=order.assigned_rider_id,
            rider_assigned_at=order.rider_assigned_at,
            rider_dispatched_at=order.rider_dispatched_at,
            rider_trip_phase=order.rider_trip_phase,
            rider_search_expires_at=None,
            merchant_delivery_confirmed_at=order.merchant_delivery_confirmed_at,
            customer_delivery_confirmed_at=order.customer_delivery_confirmed_at,
            created_by_user_id=order.placed_by_user_id,
            created_at=stamp,
            updated_at=stamp,
            completed_at=order.completed_at,
            cancelled_at=order.cancelled_at,
        )
        self.db.add(delivery)
        self.db.flush()
        order.delivery_id = delivery.id
        order.updated_at = stamp
        self.db.commit()
        self.db.refresh(delivery)
        return delivery

    def create_standalone_hail(
        self,
        *,
        account_id: str,
        user_id: str | None,
        pickup_address: str,
        delivery_address: str,
        pickup_lat: float | None = None,
        pickup_lng: float | None = None,
        customer_name: str | None = None,
        customer_phone: str | None = None,
        delivery_notes: str | None = None,
        delivery_fee: Decimal,
        search_ttl_seconds: int,
        now: datetime | None = None,
    ) -> Delivery:
        """Standalone pickup → drop-off with no kitchen order."""
        stamp = now or datetime.utcnow()
        notes = delivery_notes or f"Pick up at {pickup_address}, then go to {delivery_address}."
        delivery = Delivery(
            account_id=account_id,
            order_id=None,
            delivery_number=next_delivery_number(self.db, account_id),
            pickup_address=pickup_address,
            pickup_lat=pickup_lat,
            pickup_lng=pickup_lng,
            delivery_address=delivery_address,
            delivery_notes=notes,
            customer_name=customer_name,
            customer_phone=customer_phone,
            delivery_fee=delivery_fee,
            currency="KES",
            status=DELIVERY_SEARCHING,
            rider_search_expires_at=stamp + timedelta(seconds=search_ttl_seconds),
            created_by_user_id=user_id,
            created_at=stamp,
            updated_at=stamp,
        )
        self.db.add(delivery)
        self.db.commit()
        self.db.refresh(delivery)
        return delivery

    def sync_order_rider_fields(self, delivery: Delivery, order: Order) -> None:
        """Keep legacy order columns in sync for kitchen-order deliveries."""
        order.assigned_rider_id = delivery.assigned_rider_id
        order.rider_assigned_at = delivery.rider_assigned_at
        order.rider_dispatched_at = delivery.rider_dispatched_at
        order.rider_trip_phase = delivery.rider_trip_phase
        order.rider_search_expires_at = delivery.rider_search_expires_at
        order.updated_at = delivery.updated_at or datetime.utcnow()

    def linked_order(self, delivery: Delivery) -> Order | None:
        if delivery.order_id:
            return self.db.get(Order, delivery.order_id)
        return None

    def account_for(self, delivery: Delivery) -> Account | None:
        return self.db.get(Account, delivery.account_id)

    def delivery_ready_for_offers(self, delivery: Delivery) -> bool:
        if delivery.status != DELIVERY_SEARCHING:
            return False
        if delivery.assigned_rider_id:
            return False
        order = self.linked_order(delivery)
        if order:
            if order.fulfillment_type != FULFILLMENT_DELIVERY:
                return False
            if order.status != READY:
                return False
        return bool((delivery.delivery_address or "").strip())
