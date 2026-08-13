"""Rider PWA — presence, hybrid offers, trip phases, login OTP, earnings."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session, selectinload

from app.models import Account, DeliveryOffer, Order, Rider, RiderLoginCode
from app.services.rider_service import ACTIVE_DELIVERY_STATUSES, RiderServiceError, normalize_phone
from app.support.order_delivery_details import order_needs_delivery_details
from app.support.order_status import READY
from app.support.datetime_utils import as_utc

OFFER_TTL_SECONDS = 45
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


def _as_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def hash_login_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def trip_route_for_phase(phase: str | None) -> str:
    mapping = {
        TRIP_EN_ROUTE_STORE: "/r/trip/go-to-store",
        TRIP_AT_STORE: "/r/trip/arrived-at-store",
        TRIP_PICKING_UP: "/r/trip/picking-up",
        TRIP_EN_ROUTE_CLIENT: "/r/trip/go-to-client",
        TRIP_AT_CLIENT: "/r/trip/delivery",
    }
    return mapping.get(phase or "", "/r/home")


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

    # --- Offers -------------------------------------------------------------

    def sync_offers_for_online_rider(self, rider: Rider) -> list[DeliveryOffer]:
        """Offer every ready, unassigned delivery to an eligible online rider.

        Fan-out is normally event-driven (order → ready). That misses the case
        where the rider comes online later, or the 45s offer TTL expires while
        the order is still waiting. Heartbeat / go-online call this to catch up.
        """
        now = _utc_now()
        if not self._rider_eligible_for_offers(rider, now=now):
            return []

        orders = (
            self.db.query(Order)
            .filter(
                Order.account_id == rider.account_id,
                Order.fulfillment_type == "delivery",
                Order.status == READY,
                Order.assigned_rider_id.is_(None),
            )
            .order_by(Order.ready_at.asc(), Order.created_at.asc())
            .all()
        )
        created: list[DeliveryOffer] = []
        expires_at = now + timedelta(seconds=OFFER_TTL_SECONDS)
        for order in orders:
            if order_needs_delivery_details(order):
                continue
            declined = (
                self.db.query(DeliveryOffer)
                .filter(
                    DeliveryOffer.order_id == order.id,
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
                    DeliveryOffer.order_id == order.id,
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
                account_id=order.account_id,
                order_id=order.id,
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

    def fan_out_offers_for_ready_order(self, order: Order) -> list[DeliveryOffer]:
        """Offer a ready delivery to all online fleet riders for the merchant."""
        if order.fulfillment_type != "delivery":
            return []
        if order.status != READY:
            return []
        if order.assigned_rider_id:
            return []
        if order_needs_delivery_details(order):
            return []

        now = _utc_now()
        # Expire any lingering pending offers for this order first.
        pending = (
            self.db.query(DeliveryOffer)
            .filter(
                DeliveryOffer.order_id == order.id,
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
                Rider.account_id == order.account_id,
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
                    DeliveryOffer.order_id == order.id,
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
                    DeliveryOffer.order_id == order.id,
                    DeliveryOffer.rider_id == rider.id,
                    DeliveryOffer.status == "pending",
                )
                .first()
            )
            if existing and _as_aware(existing.expires_at) and _as_aware(existing.expires_at) > now:
                continue
            offer = DeliveryOffer(
                account_id=order.account_id,
                order_id=order.id,
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
        # Refresh offers for ready orders still waiting (TTL expired, or rider
        # came online after the order was marked ready).
        self.sync_offers_for_online_rider(rider)
        now = _utc_now()
        offers = (
            self.db.query(DeliveryOffer)
            .options(selectinload(DeliveryOffer.order).selectinload(Order.items))
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
            order = offer.order
            if not order or order.assigned_rider_id or order.status != READY:
                offer.status = "cancelled"
                offer.updated_at = now
                continue
            out.append(self._offer_dict(offer, order, account))
        if any(o.status == "cancelled" for o in offers):
            self.db.commit()
        return out

    def accept_offer(self, rider: Rider, offer_id: str) -> Order:
        self.expire_stale_offers(rider.id)
        offer = (
            self.db.query(DeliveryOffer)
            .options(selectinload(DeliveryOffer.order).selectinload(Order.items))
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

        order = offer.order
        if not order or order.status != READY:
            offer.status = "cancelled"
            offer.updated_at = now
            self.db.commit()
            raise RiderServiceError("This order is no longer available.")
        if order.assigned_rider_id and order.assigned_rider_id != rider.id:
            offer.status = "cancelled"
            offer.updated_at = now
            self.db.commit()
            raise RiderServiceError("Another rider already claimed this order.")
        if self._active_trip(rider) is not None:
            raise RiderServiceError("You already have an active delivery.")

        order.assigned_rider_id = rider.id
        order.rider_assigned_at = now
        order.rider_trip_phase = TRIP_EN_ROUTE_STORE
        order.updated_at = now

        offer.status = "accepted"
        offer.responded_at = now
        offer.updated_at = now

        siblings = (
            self.db.query(DeliveryOffer)
            .filter(
                DeliveryOffer.order_id == order.id,
                DeliveryOffer.id != offer.id,
                DeliveryOffer.status == "pending",
            )
            .all()
        )
        for sibling in siblings:
            sibling.status = "cancelled"
            sibling.updated_at = now
            sibling.responded_at = now

        # Rider is on a trip — stop receiving new offers.
        rider.is_online = False
        rider.last_seen_at = now
        rider.updated_at = now

        self.db.commit()
        self.db.refresh(order)
        return order

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

    def cancel_offers_for_order(self, order_id: str) -> None:
        now = _utc_now()
        offers = (
            self.db.query(DeliveryOffer)
            .filter(DeliveryOffer.order_id == order_id, DeliveryOffer.status == "pending")
            .all()
        )
        for offer in offers:
            offer.status = "cancelled"
            offer.updated_at = now
        if offers:
            self.db.commit()

    # --- Trip ---------------------------------------------------------------

    def _active_trip(self, rider: Rider) -> Order | None:
        order = (
            self.db.query(Order)
            .options(selectinload(Order.items))
            .filter(
                Order.assigned_rider_id == rider.id,
                Order.account_id == rider.account_id,
                Order.status.in_(tuple(ACTIVE_DELIVERY_STATUSES)),
            )
            .order_by(Order.updated_at.desc())
            .first()
        )
        if not order:
            return None
        phase = order.rider_trip_phase
        if phase == TRIP_COMPLETED or phase == TRIP_CANCELLED:
            return None
        if phase not in ACTIVE_TRIP_PHASES:
            # Legacy assignment without a phase — resume at store leg.
            if order.status in ACTIVE_DELIVERY_STATUSES:
                order.rider_trip_phase = (
                    TRIP_EN_ROUTE_CLIENT
                    if order.status in {"out_for_delivery", "awaiting_delivery_confirmation"}
                    else TRIP_EN_ROUTE_STORE
                )
                order.updated_at = _utc_now()
                self.db.commit()
                self.db.refresh(order)
            else:
                return None
        return order

    def get_active_trip(self, rider: Rider) -> Order | None:
        return self._active_trip(rider)

    def advance_trip(self, rider: Rider, order_id: str, *, to_phase: str) -> Order:
        order = (
            self.db.query(Order)
            .options(selectinload(Order.items))
            .filter(
                Order.id == order_id,
                Order.assigned_rider_id == rider.id,
                Order.account_id == rider.account_id,
            )
            .first()
        )
        if not order:
            raise RiderServiceError("Delivery not found.")

        current = order.rider_trip_phase or TRIP_EN_ROUTE_STORE
        expected = TRIP_TRANSITIONS.get(current)
        if to_phase != expected:
            raise RiderServiceError(
                f"Cannot move trip from {current} to {to_phase}.",
            )

        # Picked up → must dispatch order to out_for_delivery via caller.
        if to_phase == TRIP_EN_ROUTE_CLIENT and order.status != READY and order.status not in (
            "out_for_delivery",
            "awaiting_delivery_confirmation",
        ):
            raise RiderServiceError("Order must be ready before leaving the store.")

        now = _utc_now()
        order.rider_trip_phase = to_phase
        order.updated_at = now
        self.db.commit()
        self.db.refresh(order)
        return order

    def mark_trip_completed(self, order: Order) -> None:
        order.rider_trip_phase = TRIP_COMPLETED
        order.updated_at = _utc_now()
        self.db.commit()

    def ensure_assigned_trip_phase(self, order: Order) -> None:
        """When merchant assigns manually, start the store-bound trip."""
        if not order.assigned_rider_id:
            return
        if order.rider_trip_phase in ACTIVE_TRIP_PHASES or order.rider_trip_phase == TRIP_COMPLETED:
            return
        order.rider_trip_phase = TRIP_EN_ROUTE_STORE
        order.updated_at = _utc_now()
        self.cancel_offers_for_order(order.id)
        self.db.commit()

    # --- Login OTP ----------------------------------------------------------

    def _issue_login_code(self, rider: Rider) -> str:
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
            expires_at=now + timedelta(seconds=LOGIN_CODE_TTL_SECONDS),
            created_at=now,
        )
        self.db.add(row)
        self.db.commit()
        return code

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
        code = self._issue_login_code(rider)
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
                # Keep OTP usable even when mail delivery fails.
                return {
                    "message": (
                        "Could not send the email. Use the login code shown below."
                    ),
                    "expires_in_seconds": LOGIN_CODE_TTL_SECONDS,
                    "login_code": code,
                    "phone_masked": None,
                    "email_masked": masked_email,
                    "channel": "email",
                    "code_sent": False,
                }
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
        return {
            "message": "Login code created. Enter it to continue.",
            "expires_in_seconds": LOGIN_CODE_TTL_SECONDS,
            # No SMS provider yet — echo code so phone login stays usable.
            "login_code": code,
            "phone_masked": masked_phone,
            "email_masked": None,
            "channel": "phone",
            "code_sent": False,
        }

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

        q = self.db.query(Order).filter(
            Order.assigned_rider_id == rider.id,
            Order.account_id == rider.account_id,
        )
        # Completed via trip phase or delivered status.
        from sqlalchemy import or_

        q = q.filter(
            or_(
                Order.rider_trip_phase == TRIP_COMPLETED,
                Order.status == "delivered",
            ),
        )
        if naive_start is not None:
            q = q.filter(
                or_(
                    Order.completed_at >= naive_start,
                    Order.updated_at >= naive_start,
                ),
            )

        trips = sorted(
            q.all(),
            key=lambda o: o.completed_at or o.updated_at or now,
            reverse=True,
        )
        currency = trips[0].currency if trips else "KES"
        fee_total = sum(float(o.delivery_fee or 0) for o in trips)
        volume_total = sum(float(o.total or 0) for o in trips)
        return {
            "period": period,
            "trip_count": len(trips),
            "currency": currency,
            "earnings_total": fee_total,
            "handled_volume": volume_total,
            "trips": [
                {
                    "id": o.id,
                    "order_number": o.order_number,
                    "completed_at": o.completed_at,
                    "delivery_fee": float(o.delivery_fee or 0),
                    "total": float(o.total or 0),
                    "currency": o.currency or "KES",
                    "delivery_address": o.delivery_address,
                }
                for o in trips[:50]
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
        order: Order,
        account: Account | None,
    ) -> dict[str, Any]:
        item_count = sum(int(i.quantity or 0) for i in (order.items or []))
        payout = float(order.delivery_fee or 0)
        return {
            "id": offer.id,
            "order_id": order.id,
            "order_number": order.order_number,
            "expires_at": as_utc(offer.expires_at),
            "store_name": account.business_name if account else "Store",
            "store_location": account.business_location if account else None,
            "delivery_address": order.delivery_address,
            "item_count": item_count,
            "payout_estimate": payout,
            "currency": order.currency or "KES",
            "total": float(order.total or 0),
        }


def hmac_compare(a: str, b: str) -> bool:
    import hmac as _hmac

    return _hmac.compare_digest(a, b)
