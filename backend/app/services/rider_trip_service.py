"""Rider PWA — presence, hybrid offers, trip phases, login OTP, earnings."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session, selectinload

from app.models import Account, Delivery, DeliveryOffer, Order, OrderStatusHistory, Rider, RiderLoginCode
from app.services.delivery_service import DeliveryService
from app.services.rider_service import RiderServiceError, normalize_phone
from app.support.otp_delivery import (
    MAIL_SEND_FAILED,
    PHONE_OTP_UNAVAILABLE,
    allow_otp_echo,
    phone_otp_allowed,
    with_optional_login_code,
)
from app.support.delivery_status import (
    DELIVERY_ACTIVE,
    DELIVERY_CANCELLED,
    DELIVERY_COMPLETED,
    DELIVERY_SEARCHING,
)
from app.support.order_delivery_details import order_needs_delivery_details
from app.support.order_status import CANCELLED, OUT_FOR_DELIVERY, READY, SOURCE_RIDER_REQUEST
from app.support.datetime_utils import as_utc

OFFER_TTL_SECONDS = 45
RIDER_SEARCH_TTL_SECONDS = 60  # Must exceed rider heartbeat interval; was 10s and missed the app poll window.
HEARTBEAT_STALE_SECONDS = 120
LOGIN_CODE_TTL_SECONDS = 600
LOGIN_CODE_LENGTH = 6

TRIP_EN_ROUTE_STORE = "en_route_to_store"
TRIP_AT_STORE = "at_store"
TRIP_PICKING_UP = "picking_up"
TRIP_EN_ROUTE_CLIENT = "en_route_to_client"
TRIP_AT_CLIENT = "at_client"
TRIP_COMPLETED = "completed"
TRIP_CANCELLED = "cancelled"

ACTIVE_TRIP_PHASES = frozenset(
    {
        TRIP_EN_ROUTE_STORE,
        TRIP_AT_STORE,
        TRIP_PICKING_UP,
        TRIP_EN_ROUTE_CLIENT,
        TRIP_AT_CLIENT,
    },
)

TRIP_TRANSITIONS: dict[str, str] = {
    TRIP_EN_ROUTE_STORE: TRIP_AT_STORE,
    TRIP_AT_STORE: TRIP_PICKING_UP,
    TRIP_PICKING_UP: TRIP_EN_ROUTE_CLIENT,
    TRIP_EN_ROUTE_CLIENT: TRIP_AT_CLIENT,
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _as_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def hash_login_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def claim_searching_delivery(
    db: Session,
    delivery_id: str,
    rider_id: str,
    *,
    now: datetime,
) -> int:
    """Atomically assign a searching delivery. Returns 1 if this rider won."""
    stamp = _naive_utc(now)
    return (
        db.query(Delivery)
        .filter(
            Delivery.id == delivery_id,
            Delivery.status == DELIVERY_SEARCHING,
            Delivery.assigned_rider_id.is_(None),
        )
        .update(
            {
                Delivery.assigned_rider_id: rider_id,
                Delivery.rider_assigned_at: stamp,
                Delivery.rider_trip_phase: TRIP_EN_ROUTE_STORE,
                Delivery.rider_search_expires_at: None,
                Delivery.status: DELIVERY_ACTIVE,
                Delivery.cancelled_at: None,
                Delivery.updated_at: stamp,
            },
            synchronize_session=False,
        )
    )


def trip_route_for_phase(phase: str | None) -> str:
    mapping = {
        TRIP_EN_ROUTE_STORE: "/r/trip/go-to-store",
        TRIP_AT_STORE: "/r/trip/arrived-at-store",
        TRIP_PICKING_UP: "/r/trip/picking-up",
        TRIP_EN_ROUTE_CLIENT: "/r/trip/go-to-client",
        TRIP_AT_CLIENT: "/r/trip/delivery",
    }
    return mapping.get(phase or "", "/r/home")


def rider_search_timeout_label() -> str:
    if RIDER_SEARCH_TTL_SECONDS < 60:
        return f"{RIDER_SEARCH_TTL_SECONDS} seconds"
    minutes = max(1, RIDER_SEARCH_TTL_SECONDS // 60)
    return f"{minutes} minutes"


def trip_pickup_for_delivery(
    delivery: Delivery,
    account: Account | None,
) -> tuple[str | None, float | None, float | None]:
    """Pickup pin for a trip: hail coords if set, otherwise the shop."""
    pickup_address = (delivery.pickup_address or "").strip() or None
    pickup_lat = delivery.pickup_lat
    pickup_lng = delivery.pickup_lng
    if pickup_lat is not None and pickup_lng is not None:
        return (
            pickup_address or (account.business_location if account else None),
            float(pickup_lat),
            float(pickup_lng),
        )
    shop_lat = float(account.latitude) if account and account.latitude is not None else None
    shop_lng = float(account.longitude) if account and account.longitude is not None else None
    return (
        pickup_address or (account.business_location if account else None),
        shop_lat,
        shop_lng,
    )


def trip_pickup_for_order(
    order: Order,
    account: Account | None,
) -> tuple[str | None, float | None, float | None]:
    """Legacy helper — prefer trip_pickup_for_delivery when a Delivery exists."""
    pickup_address = (getattr(order, "pickup_address", None) or "").strip() or None
    pickup_lat = getattr(order, "pickup_lat", None)
    pickup_lng = getattr(order, "pickup_lng", None)
    if pickup_lat is not None and pickup_lng is not None:
        return (
            pickup_address or (account.business_location if account else None),
            float(pickup_lat),
            float(pickup_lng),
        )
    shop_lat = float(account.latitude) if account and account.latitude is not None else None
    shop_lng = float(account.longitude) if account and account.longitude is not None else None
    return (
        pickup_address or (account.business_location if account else None),
        shop_lat,
        shop_lng,
    )


class RiderTripService:
    def __init__(self, db: Session):
        self.db = db

    # --- Presence -----------------------------------------------------------

    def set_presence(
        self,
        rider: Rider,
        *,
        online: bool,
        lat: float | None = None,
        lng: float | None = None,
    ) -> Rider:
        now = _utc_now()
        if online and self._active_trip(rider) is not None:
            raise RiderServiceError("Finish your current delivery before going online for new offers.")
        rider.is_online = bool(online)
        rider.last_seen_at = now
        if lat is not None:
            rider.last_lat = lat
        if lng is not None:
            rider.last_lng = lng
        rider.updated_at = now
        self.db.commit()
        self.db.refresh(rider)
        # Catch ready orders that were waiting with no online rider (or whose
        # previous 45s offers expired before the rider opened the app).
        if online:
            self.sync_offers_for_online_rider(rider)
        return rider

    def heartbeat(
        self,
        rider: Rider,
        *,
        lat: float | None = None,
        lng: float | None = None,
    ) -> Rider:
        now = _utc_now()
        rider.last_seen_at = now
        if lat is not None:
            rider.last_lat = lat
        if lng is not None:
            rider.last_lng = lng
        rider.updated_at = now
        self.db.commit()
        self.db.refresh(rider)
        return rider

    def _rider_eligible_for_offers(self, rider: Rider, *, now: datetime | None = None) -> bool:
        if rider.status != "active" or not rider.is_online:
            return False
        now = now or _utc_now()
        last_seen = _as_aware(rider.last_seen_at)
        if last_seen is None:
            return False
        if (now - last_seen).total_seconds() > HEARTBEAT_STALE_SECONDS:
            return False
        return self._active_trip(rider) is None

    # --- Rider search timeout (standalone Tools → Delivery hails) ---------

    def _is_standalone_search(self, delivery: Delivery) -> bool:
        return delivery.order_id is None

    def _rider_search_deadline(self, delivery: Delivery) -> datetime | None:
        if not self._is_standalone_search(delivery):
            return None
        exp = _as_aware(delivery.rider_search_expires_at)
        if exp:
            return exp
        created = _as_aware(delivery.created_at)
        if not created:
            return None
        return created + timedelta(seconds=RIDER_SEARCH_TTL_SECONDS)

    def _ensure_rider_search_expires_at(
        self,
        delivery: Delivery,
        *,
        now: datetime | None = None,
    ) -> None:
        if delivery.rider_search_expires_at or not self._is_standalone_search(delivery):
            return
        if delivery.status != DELIVERY_SEARCHING:
            return
        deadline = self._rider_search_deadline(delivery)
        if not deadline:
            return
        stamp = _naive_utc(now or _utc_now())
        delivery.rider_search_expires_at = _naive_utc(deadline)
        delivery.updated_at = stamp

    def rider_search_expired(self, delivery: Delivery, *, now: datetime | None = None) -> bool:
        if not self._is_standalone_search(delivery):
            return False
        if delivery.status != DELIVERY_SEARCHING or delivery.assigned_rider_id:
            return False
        deadline = self._rider_search_deadline(delivery)
        if not deadline:
            return False
        return (now or _utc_now()) >= deadline

    def expire_rider_search(
        self,
        delivery: Delivery,
        *,
        now: datetime | None = None,
        changed_by_user_id: str | None = None,
        commit: bool = True,
    ) -> bool:
        now = now or _utc_now()
        self.db.refresh(delivery)
        if not self.rider_search_expired(delivery, now=now):
            return False

        stamp = _naive_utc(now)
        delivery.status = DELIVERY_CANCELLED
        delivery.cancelled_at = stamp
        delivery.rider_trip_phase = TRIP_CANCELLED
        delivery.updated_at = stamp

        pending = (
            self.db.query(DeliveryOffer)
            .filter(
                DeliveryOffer.delivery_id == delivery.id,
                DeliveryOffer.status == "pending",
            )
            .all()
        )
        for offer in pending:
            offer.status = "expired"
            offer.updated_at = stamp

        order = DeliveryService(self.db).linked_order(delivery)
        if order and order.status == READY:
            order.status = CANCELLED
            order.cancelled_at = stamp
            order.rider_trip_phase = TRIP_CANCELLED
            order.updated_at = stamp
            self.db.add(
                OrderStatusHistory(
                    order_id=order.id,
                    from_status=READY,
                    to_status=CANCELLED,
                    changed_by_user_id=changed_by_user_id,
                    note=f"No rider accepted within {rider_search_timeout_label()}.",
                    created_at=stamp,
                ),
            )

        if commit:
            self.db.commit()
            self.db.refresh(delivery)
        return True

    def expire_stale_rider_searches(self, account_id: str | None = None) -> int:
        now = _utc_now()
        q = self.db.query(Delivery).filter(
            Delivery.order_id.is_(None),
            Delivery.status == DELIVERY_SEARCHING,
            Delivery.assigned_rider_id.is_(None),
        )
        if account_id:
            q = q.filter(Delivery.account_id == account_id)
        rows = q.all()
        if not rows:
            return 0

        count = 0
        backfilled = False
        for stale in rows:
            delivery = self.db.get(Delivery, stale.id)
            if (
                not delivery
                or delivery.assigned_rider_id
                or delivery.status != DELIVERY_SEARCHING
            ):
                continue
            had_expires = bool(delivery.rider_search_expires_at)
            self._ensure_rider_search_expires_at(delivery, now=now)
            if not had_expires and delivery.rider_search_expires_at:
                backfilled = True
            if self.rider_search_expired(delivery, now=now) and self.expire_rider_search(
                delivery,
                now=now,
                commit=False,
            ):
                count += 1
        if count or backfilled:
            self.db.commit()
        return count

    def repair_cancelled_standalone_with_active_rider(
        self,
        account_id: str | None = None,
    ) -> int:
        q = self.db.query(Delivery).filter(
            Delivery.order_id.is_(None),
            Delivery.status == DELIVERY_CANCELLED,
            Delivery.assigned_rider_id.isnot(None),
            Delivery.rider_trip_phase.in_(tuple(ACTIVE_TRIP_PHASES)),
        )
        if account_id:
            q = q.filter(Delivery.account_id == account_id)
        rows = q.all()
        if not rows:
            return 0
        stamp = _naive_utc(_utc_now())
        for delivery in rows:
            delivery.status = DELIVERY_ACTIVE
            delivery.cancelled_at = None
            delivery.rider_search_expires_at = None
            delivery.updated_at = stamp
        self.db.commit()
        return len(rows)

    def repair_cancelled_hails_with_active_rider(
        self,
        account_id: str | None = None,
    ) -> int:
        return self.repair_cancelled_standalone_with_active_rider(account_id)

    # --- Offers -------------------------------------------------------------

    def _delivery_needs_details(self, delivery: Delivery) -> bool:
        order = DeliveryService(self.db).linked_order(delivery)
        if not order:
            return False
        return order_needs_delivery_details(order)

    def sync_offers_for_online_rider(self, rider: Rider) -> list[DeliveryOffer]:
        now = _utc_now()
        if not self._rider_eligible_for_offers(rider, now=now):
            return []

        self.expire_stale_rider_searches(rider.account_id)

        deliveries = (
            self.db.query(Delivery)
            .filter(
                Delivery.account_id == rider.account_id,
                Delivery.status == DELIVERY_SEARCHING,
                Delivery.assigned_rider_id.is_(None),
            )
            .order_by(Delivery.created_at.asc())
            .all()
        )
        created: list[DeliveryOffer] = []
        expires_at = now + timedelta(seconds=OFFER_TTL_SECONDS)
        for delivery in deliveries:
            if not DeliveryService(self.db).delivery_ready_for_offers(delivery):
                continue
            if self._delivery_needs_details(delivery):
                continue
            if self.rider_search_expired(delivery, now=now):
                continue
            declined = (
                self.db.query(DeliveryOffer)
                .filter(
                    DeliveryOffer.delivery_id == delivery.id,
                    DeliveryOffer.rider_id == rider.id,
                    DeliveryOffer.status == "declined",
                )
                .first()
            )
            if declined:
                continue
            existing = (
                self.db.query(DeliveryOffer)
                .filter(
                    DeliveryOffer.delivery_id == delivery.id,
                    DeliveryOffer.rider_id == rider.id,
                    DeliveryOffer.status == "pending",
                )
                .first()
            )
            if existing and _as_aware(existing.expires_at) and _as_aware(existing.expires_at) > now:
                continue
            if existing:
                existing.status = "expired"
                existing.updated_at = now
            offer = DeliveryOffer(
                account_id=delivery.account_id,
                delivery_id=delivery.id,
                order_id=delivery.order_id,
                rider_id=rider.id,
                status="pending",
                expires_at=expires_at,
                created_at=now,
                updated_at=now,
            )
            self.db.add(offer)
            created.append(offer)

        if created:
            self.db.commit()
            for offer in created:
                self.db.refresh(offer)
        return created

    def fan_out_offers_for_delivery(self, delivery: Delivery) -> list[DeliveryOffer]:
        ds = DeliveryService(self.db)
        if not ds.delivery_ready_for_offers(delivery):
            return []
        if delivery.assigned_rider_id:
            return []
        if self._delivery_needs_details(delivery):
            return []

        now = _utc_now()
        if self.rider_search_expired(delivery, now=now):
            self.expire_rider_search(delivery, now=now)
            return []

        pending = (
            self.db.query(DeliveryOffer)
            .filter(
                DeliveryOffer.delivery_id == delivery.id,
                DeliveryOffer.status == "pending",
            )
            .all()
        )
        for offer in pending:
            if _as_aware(offer.expires_at) and _as_aware(offer.expires_at) <= now:
                offer.status = "expired"
                offer.updated_at = now

        riders = (
            self.db.query(Rider)
            .filter(
                Rider.account_id == delivery.account_id,
                Rider.status == "active",
                Rider.is_online.is_(True),
            )
            .all()
        )
        created: list[DeliveryOffer] = []
        expires_at = now + timedelta(seconds=OFFER_TTL_SECONDS)
        for rider in riders:
            if not self._rider_eligible_for_offers(rider, now=now):
                continue
            declined = (
                self.db.query(DeliveryOffer)
                .filter(
                    DeliveryOffer.delivery_id == delivery.id,
                    DeliveryOffer.rider_id == rider.id,
                    DeliveryOffer.status == "declined",
                )
                .first()
            )
            if declined:
                continue
            existing = (
                self.db.query(DeliveryOffer)
                .filter(
                    DeliveryOffer.delivery_id == delivery.id,
                    DeliveryOffer.rider_id == rider.id,
                    DeliveryOffer.status == "pending",
                )
                .first()
            )
            if existing and _as_aware(existing.expires_at) and _as_aware(existing.expires_at) > now:
                continue
            offer = DeliveryOffer(
                account_id=delivery.account_id,
                delivery_id=delivery.id,
                order_id=delivery.order_id,
                rider_id=rider.id,
                status="pending",
                expires_at=expires_at,
                created_at=now,
                updated_at=now,
            )
            self.db.add(offer)
            created.append(offer)

        if created or pending:
            self.db.commit()
            for offer in created:
                self.db.refresh(offer)
        return created

    def fan_out_offers_for_ready_order(self, order: Order) -> list[DeliveryOffer]:
        """Ensure a delivery exists for the order, then fan out offers."""
        delivery = DeliveryService(self.db).ensure_for_order(order)
        return self.fan_out_offers_for_delivery(delivery)

    def expire_stale_offers(self, rider_id: str | None = None) -> int:
        now = _utc_now()
        q = self.db.query(DeliveryOffer).filter(DeliveryOffer.status == "pending")
        if rider_id:
            q = q.filter(DeliveryOffer.rider_id == rider_id)
        offers = q.all()
        count = 0
        for offer in offers:
            exp = _as_aware(offer.expires_at)
            if exp and exp <= now:
                offer.status = "expired"
                offer.updated_at = now
                count += 1
        if count:
            self.db.commit()
        return count

    def list_pending_offers(self, rider: Rider) -> list[dict[str, Any]]:
        self.expire_stale_offers(rider.id)
        self.sync_offers_for_online_rider(rider)
        now = _utc_now()
        offers = (
            self.db.query(DeliveryOffer)
            .options(
                selectinload(DeliveryOffer.delivery).selectinload(Delivery.order).selectinload(Order.items),
            )
            .filter(
                DeliveryOffer.rider_id == rider.id,
                DeliveryOffer.status == "pending",
            )
            .order_by(DeliveryOffer.created_at.desc())
            .all()
        )
        account = self.db.get(Account, rider.account_id)
        out: list[dict[str, Any]] = []
        for offer in offers:
            exp = _as_aware(offer.expires_at)
            if not exp or exp <= now:
                continue
            delivery = offer.delivery
            if (
                not delivery
                or delivery.assigned_rider_id
                or delivery.status != DELIVERY_SEARCHING
            ):
                offer.status = "cancelled"
                offer.updated_at = now
                continue
            out.append(self._offer_dict(offer, delivery, account))
        if any(o.status == "cancelled" for o in offers):
            self.db.commit()
        return out

    def accept_offer(self, rider: Rider, offer_id: str) -> Delivery:
        self.expire_stale_offers(rider.id)
        offer = (
            self.db.query(DeliveryOffer)
            .filter(DeliveryOffer.id == offer_id, DeliveryOffer.rider_id == rider.id)
            .first()
        )
        if not offer:
            raise RiderServiceError("Offer not found.")
        now = _utc_now()
        exp = _as_aware(offer.expires_at)
        if offer.status != "pending" or not exp or exp <= now:
            offer.status = "expired"
            offer.updated_at = now
            self.db.commit()
            raise RiderServiceError("This offer has expired.")
        if self._active_trip(rider) is not None:
            raise RiderServiceError("You already have an active delivery.")

        delivery = (
            self.db.query(Delivery)
            .filter(Delivery.id == offer.delivery_id)
            .with_for_update()
            .first()
        )
        if not delivery or delivery.status != DELIVERY_SEARCHING:
            offer.status = "cancelled"
            offer.updated_at = now
            self.db.commit()
            raise RiderServiceError("This delivery is no longer available.")
        if delivery.assigned_rider_id and delivery.assigned_rider_id != rider.id:
            offer.status = "cancelled"
            offer.updated_at = now
            self.db.commit()
            raise RiderServiceError("Another rider already claimed this delivery.")

        if not delivery.assigned_rider_id:
            claimed = claim_searching_delivery(
                self.db,
                delivery.id,
                rider.id,
                now=now,
            )
            if claimed != 1:
                offer.status = "cancelled"
                offer.updated_at = now
                self.db.commit()
                raise RiderServiceError("Another rider already claimed this delivery.")
            self.db.refresh(delivery)

        order = DeliveryService(self.db).linked_order(delivery)
        if order:
            order.assigned_rider_id = rider.id
            order.rider_assigned_at = delivery.rider_assigned_at
            order.rider_trip_phase = TRIP_EN_ROUTE_STORE
            order.rider_search_expires_at = None
            order.cancelled_at = None
            order.updated_at = delivery.updated_at

        offer.status = "accepted"
        offer.responded_at = now
        offer.updated_at = now

        siblings = (
            self.db.query(DeliveryOffer)
            .filter(
                DeliveryOffer.delivery_id == delivery.id,
                DeliveryOffer.id != offer.id,
                DeliveryOffer.status == "pending",
            )
            .all()
        )
        for sibling in siblings:
            sibling.status = "cancelled"
            sibling.updated_at = now
            sibling.responded_at = now

        rider.is_online = False
        rider.last_seen_at = now
        rider.updated_at = now

        self.db.commit()
        self.db.refresh(delivery, attribute_names=["order"])
        if delivery.order:
            self.db.refresh(delivery.order, attribute_names=["items"])
        return delivery

    def decline_offer(self, rider: Rider, offer_id: str) -> None:
        offer = (
            self.db.query(DeliveryOffer)
            .filter(DeliveryOffer.id == offer_id, DeliveryOffer.rider_id == rider.id)
            .first()
        )
        if not offer:
            raise RiderServiceError("Offer not found.")
        if offer.status != "pending":
            return
        now = _utc_now()
        offer.status = "declined"
        offer.responded_at = now
        offer.updated_at = now
        self.db.commit()

    def cancel_offers_for_delivery(self, delivery_id: str) -> None:
        now = _utc_now()
        offers = (
            self.db.query(DeliveryOffer)
            .filter(
                DeliveryOffer.delivery_id == delivery_id,
                DeliveryOffer.status == "pending",
            )
            .all()
        )
        for offer in offers:
            offer.status = "cancelled"
            offer.updated_at = now
        if offers:
            self.db.commit()

    def cancel_offers_for_order(self, order_id: str) -> None:
        delivery = (
            self.db.query(Delivery)
            .filter(Delivery.order_id == order_id)
            .first()
        )
        if delivery:
            self.cancel_offers_for_delivery(delivery.id)

    # --- Trip ---------------------------------------------------------------

    def _active_trip(self, rider: Rider) -> Delivery | None:
        delivery = (
            self.db.query(Delivery)
            .options(selectinload(Delivery.order).selectinload(Order.items))
            .filter(
                Delivery.assigned_rider_id == rider.id,
                Delivery.account_id == rider.account_id,
                Delivery.status == DELIVERY_ACTIVE,
            )
            .order_by(Delivery.updated_at.desc())
            .first()
        )
        if not delivery:
            return None
        phase = delivery.rider_trip_phase
        if phase == TRIP_COMPLETED or phase == TRIP_CANCELLED:
            return None
        if phase not in ACTIVE_TRIP_PHASES:
            order = DeliveryService(self.db).linked_order(delivery)
            if order and order.status in {READY, OUT_FOR_DELIVERY, "awaiting_delivery_confirmation"}:
                delivery.rider_trip_phase = (
                    TRIP_EN_ROUTE_CLIENT
                    if order.status in {OUT_FOR_DELIVERY, "awaiting_delivery_confirmation"}
                    else TRIP_EN_ROUTE_STORE
                )
                delivery.updated_at = _utc_now()
                self.db.commit()
                self.db.refresh(delivery)
            else:
                delivery.rider_trip_phase = TRIP_EN_ROUTE_STORE
                delivery.updated_at = _utc_now()
                self.db.commit()
                self.db.refresh(delivery)
        return delivery

    def get_active_trip(self, rider: Rider) -> Delivery | None:
        return self._active_trip(rider)

    def advance_trip(self, rider: Rider, delivery_id: str, *, to_phase: str) -> Delivery:
        delivery = (
            self.db.query(Delivery)
            .options(selectinload(Delivery.order).selectinload(Order.items))
            .filter(
                Delivery.id == delivery_id,
                Delivery.assigned_rider_id == rider.id,
                Delivery.account_id == rider.account_id,
            )
            .first()
        )
        if not delivery:
            raise RiderServiceError("Delivery not found.")

        current = delivery.rider_trip_phase or TRIP_EN_ROUTE_STORE
        expected = TRIP_TRANSITIONS.get(current)
        if to_phase != expected:
            raise RiderServiceError(
                f"Cannot move trip from {current} to {to_phase}.",
            )

        order = DeliveryService(self.db).linked_order(delivery)
        if to_phase == TRIP_EN_ROUTE_CLIENT and order:
            if order.status != READY and order.status not in (
                OUT_FOR_DELIVERY,
                "awaiting_delivery_confirmation",
            ):
                raise RiderServiceError("Order must be ready before leaving the store.")

        now = _utc_now()
        delivery.rider_trip_phase = to_phase
        delivery.updated_at = now
        if order:
            order.rider_trip_phase = to_phase
            order.updated_at = _naive_utc(now)
        self.db.commit()
        self.db.refresh(delivery)
        return delivery

    def mark_trip_completed(self, delivery: Delivery) -> None:
        now = _utc_now()
        delivery.rider_trip_phase = TRIP_COMPLETED
        delivery.status = DELIVERY_COMPLETED
        delivery.completed_at = _naive_utc(now)
        delivery.updated_at = _naive_utc(now)
        order = DeliveryService(self.db).linked_order(delivery)
        if order:
            order.rider_trip_phase = TRIP_COMPLETED
            order.updated_at = delivery.updated_at
        self.db.commit()

    def ensure_assigned_trip_phase(self, delivery: Delivery) -> None:
        if not delivery.assigned_rider_id:
            return
        if delivery.rider_trip_phase in ACTIVE_TRIP_PHASES or delivery.rider_trip_phase == TRIP_COMPLETED:
            return
        delivery.rider_trip_phase = TRIP_EN_ROUTE_STORE
        delivery.status = DELIVERY_ACTIVE
        delivery.updated_at = _utc_now()
        order = DeliveryService(self.db).linked_order(delivery)
        if order:
            order.rider_trip_phase = TRIP_EN_ROUTE_STORE
            order.updated_at = delivery.updated_at
        self.cancel_offers_for_delivery(delivery.id)
        self.db.commit()

    def ensure_assigned_trip_phase_for_order(self, order: Order) -> None:
        delivery = DeliveryService(self.db).ensure_for_order(order)
        if order.assigned_rider_id and not delivery.assigned_rider_id:
            delivery.assigned_rider_id = order.assigned_rider_id
            delivery.rider_assigned_at = order.rider_assigned_at
        self.ensure_assigned_trip_phase(delivery)

    # --- Login OTP ----------------------------------------------------------

    def _issue_login_code(self, rider: Rider, *, channel: str) -> tuple[str, RiderLoginCode]:
        code = "".join(secrets.choice("0123456789") for _ in range(LOGIN_CODE_LENGTH))
        now = _utc_now()
        prior = (
            self.db.query(RiderLoginCode)
            .filter(
                RiderLoginCode.rider_id == rider.id,
                RiderLoginCode.consumed_at.is_(None),
            )
            .all()
        )
        for row in prior:
            row.consumed_at = now

        row = RiderLoginCode(
            rider_id=rider.id,
            code_hash=hash_login_code(code),
            channel=channel,
            delivery_status="created",
            expires_at=now + timedelta(seconds=LOGIN_CODE_TTL_SECONDS),
            created_at=now,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return code, row

    def _verify_code_for_rider(self, rider: Rider, code: str) -> None:
        raw_code = (code or "").strip()
        if not raw_code:
            raise RiderServiceError("Login code is required.")

        now = _utc_now()
        rows = (
            self.db.query(RiderLoginCode)
            .filter(
                RiderLoginCode.rider_id == rider.id,
                RiderLoginCode.consumed_at.is_(None),
            )
            .order_by(RiderLoginCode.created_at.desc())
            .all()
        )
        target_hash = hash_login_code(raw_code)
        match = None
        for row in rows:
            exp = _as_aware(row.expires_at)
            if exp and exp < now:
                row.consumed_at = now
                continue
            if hmac_compare(row.code_hash, target_hash):
                match = row
                break

        if not match:
            self.db.commit()
            raise RiderServiceError("Invalid login details or code.")

        match.consumed_at = now
        rider.last_seen_at = now
        rider.updated_at = now
        self.db.commit()
        self.db.refresh(rider)

    def request_login_code(
        self,
        *,
        phone: str | None = None,
        email: str | None = None,
    ) -> dict[str, Any]:
        clean_phone = normalize_phone(phone or "")
        clean_email = (email or "").strip().lower()

        if not clean_phone and not clean_email:
            raise RiderServiceError("Phone number or email is required.")
        if clean_phone and clean_email:
            raise RiderServiceError("Use either phone or email, not both.")

        channel = "email" if clean_email else "phone"
        if channel == "phone" and not phone_otp_allowed():
            raise RiderServiceError(PHONE_OTP_UNAVAILABLE)

        generic = {
            "message": (
                "If this account is onboarded, a login code will be sent."
                if channel == "email"
                else "If this phone is onboarded, a login code is ready."
            ),
            "expires_in_seconds": LOGIN_CODE_TTL_SECONDS,
            "login_code": None,
            "phone_masked": None,
            "email_masked": None,
            "channel": channel,
            "code_sent": False,
        }

        if channel == "email":
            riders = (
                self.db.query(Rider)
                .filter(Rider.email == clean_email, Rider.status == "active")
                .order_by(Rider.activated_at.desc())
                .all()
            )
        else:
            riders = (
                self.db.query(Rider)
                .filter(Rider.phone == clean_phone, Rider.status == "active")
                .order_by(Rider.activated_at.desc())
                .all()
            )

        if not riders:
            # Match phone behaviour: do not reveal whether the email exists.
            return {
                **generic,
                "email_masked": (
                    f"{clean_email[:1]}***@{clean_email.split('@', 1)[-1]}"
                    if "@" in clean_email
                    else None
                ),
            }

        rider = riders[0]
        code, login_row = self._issue_login_code(rider, channel=channel)
        account = self.db.get(Account, rider.account_id)
        merchant_name = account.business_name if account else "Shop"

        if channel == "email":
            from app.services.rider_login_email import send_rider_login_otp_email

            sent = send_rider_login_otp_email(
                to_email=clean_email,
                rider_name=rider.name,
                merchant_name=merchant_name,
                code=code,
                expires_in_seconds=LOGIN_CODE_TTL_SECONDS,
            )
            local, _, domain = clean_email.partition("@")
            masked_email = (
                f"{local[:1]}***@{domain}" if domain else f"{clean_email[:2]}***"
            )
            if not sent:
                login_row.delivery_status = "failed"
                self.db.commit()
                if not allow_otp_echo():
                    raise RiderServiceError(MAIL_SEND_FAILED)
                return with_optional_login_code(
                    {
                        "message": (
                            "Could not send the email. Use the login code shown below."
                        ),
                        "expires_in_seconds": LOGIN_CODE_TTL_SECONDS,
                        "phone_masked": None,
                        "email_masked": masked_email,
                        "channel": "email",
                        "code_sent": False,
                    },
                    code,
                )
            login_row.delivery_status = "delivered"
            self.db.commit()
            return {
                "message": "Login code sent to your email.",
                "expires_in_seconds": LOGIN_CODE_TTL_SECONDS,
                "login_code": None,
                "phone_masked": None,
                "email_masked": masked_email,
                "channel": "email",
                "code_sent": True,
            }

        masked_phone = f"{'*' * max(0, len(clean_phone) - 4)}{clean_phone[-4:]}"
        return with_optional_login_code(
            {
                "message": "Login code created. Enter it to continue.",
                "expires_in_seconds": LOGIN_CODE_TTL_SECONDS,
                "phone_masked": masked_phone,
                "email_masked": None,
                "channel": "phone",
                "code_sent": False,
            },
            code,
        )

    def verify_login_code(
        self,
        *,
        code: str,
        phone: str | None = None,
        email: str | None = None,
    ) -> Rider:
        clean_phone = normalize_phone(phone or "")
        clean_email = (email or "").strip().lower()
        if not clean_phone and not clean_email:
            raise RiderServiceError("Phone or email is required.")
        if clean_phone and clean_email:
            raise RiderServiceError("Use either phone or email, not both.")

        if clean_email:
            rider = (
                self.db.query(Rider)
                .filter(Rider.email == clean_email, Rider.status == "active")
                .order_by(Rider.activated_at.desc())
                .first()
            )
        else:
            rider = (
                self.db.query(Rider)
                .filter(Rider.phone == clean_phone, Rider.status == "active")
                .order_by(Rider.activated_at.desc())
                .first()
            )
        if not rider:
            raise RiderServiceError("Invalid login details or code.")

        self._verify_code_for_rider(rider, code)
        return rider

    # --- Earnings / me ------------------------------------------------------

    def earnings(self, rider: Rider, *, period: str = "today") -> dict[str, Any]:
        now = _utc_now()
        if period == "week":
            start = now - timedelta(days=7)
        elif period == "all":
            start = None
        else:
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        naive_start = None
        if start is not None:
            naive_start = start.replace(tzinfo=None) if start.tzinfo else start

        from sqlalchemy import or_

        q = self.db.query(Delivery).filter(
            Delivery.assigned_rider_id == rider.id,
            Delivery.account_id == rider.account_id,
        )
        q = q.filter(
            or_(
                Delivery.rider_trip_phase == TRIP_COMPLETED,
                Delivery.status == DELIVERY_COMPLETED,
            ),
        )
        if naive_start is not None:
            q = q.filter(
                or_(
                    Delivery.completed_at >= naive_start,
                    Delivery.updated_at >= naive_start,
                ),
            )

        trips = sorted(
            q.all(),
            key=lambda d: d.completed_at or d.updated_at or now,
            reverse=True,
        )
        currency = trips[0].currency if trips else "KES"
        fee_total = sum(float(d.delivery_fee or 0) for d in trips)
        volume_total = fee_total
        return {
            "period": period,
            "trip_count": len(trips),
            "currency": currency,
            "earnings_total": fee_total,
            "handled_volume": volume_total,
            "trips": [
                {
                    "id": d.id,
                    "delivery_number": d.delivery_number,
                    "order_number": (
                        DeliveryService(self.db).linked_order(d).order_number
                        if DeliveryService(self.db).linked_order(d)
                        else None
                    ),
                    "completed_at": d.completed_at,
                    "delivery_fee": float(d.delivery_fee or 0),
                    "total": float(d.delivery_fee or 0),
                    "currency": d.currency or "KES",
                    "delivery_address": d.delivery_address,
                }
                for d in trips[:50]
            ],
        }

    def me_payload(self, rider: Rider) -> dict[str, Any]:
        account = self.db.get(Account, rider.account_id)
        trip = self.get_active_trip(rider)
        today = self.earnings(rider, period="today")
        return {
            "rider_id": rider.id,
            "rider_name": rider.name,
            "phone": rider.phone,
            "status": rider.status,
            "is_online": bool(rider.is_online),
            "last_seen_at": as_utc(rider.last_seen_at),
            "merchant_name": account.business_name if account else "Shop",
            "store_location": account.business_location if account else None,
            "store_lat": account.latitude if account else None,
            "store_lng": account.longitude if account else None,
            "active_trip_id": trip.id if trip else None,
            "active_trip_phase": trip.rider_trip_phase if trip else None,
            "active_trip_route": trip_route_for_phase(trip.rider_trip_phase) if trip else None,
            "today_trip_count": today["trip_count"],
            "today_earnings": today["earnings_total"],
            "currency": today["currency"],
        }

    def _offer_dict(
        self,
        offer: DeliveryOffer,
        delivery: Delivery,
        account: Account | None,
    ) -> dict[str, Any]:
        order = DeliveryService(self.db).linked_order(delivery)
        items = order.items if order else []
        item_count = sum(int(i.quantity or 0) for i in items)
        payout = float(delivery.delivery_fee or 0)
        store_location, store_lat, store_lng = trip_pickup_for_delivery(delivery, account)
        return {
            "id": offer.id,
            "delivery_id": delivery.id,
            "delivery_number": delivery.delivery_number,
            "order_id": delivery.order_id,
            "order_number": order.order_number if order else None,
            "has_order": order is not None,
            "expires_at": as_utc(offer.expires_at),
            "store_name": account.business_name if account else "Store",
            "store_location": store_location,
            "store_lat": store_lat,
            "store_lng": store_lng,
            "delivery_address": delivery.delivery_address,
            "item_count": item_count,
            "payout_estimate": payout,
            "currency": delivery.currency or "KES",
            "total": float(order.total or 0) if order else payout,
        }


def hmac_compare(a: str, b: str) -> bool:
    import hmac as _hmac

    return _hmac.compare_digest(a, b)
