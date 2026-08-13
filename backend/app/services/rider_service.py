"""Merchant fleet riders — invite, onboard, and assign deliveries."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.rider_invite_tokens import (
    RiderInviteTokenInvalid,
    mint_rider_invite_token,
    read_rider_invite_token,
)
from app.models import Account, Order, Rider, RiderInvite
from app.support.datetime_utils import as_utc

ACTIVE_DELIVERY_STATUSES = frozenset(
    {"ready", "out_for_delivery", "awaiting_delivery_confirmation"},
)


class RiderServiceError(ValueError):
    """Business rule violation for rider operations."""


def normalize_phone(phone: str) -> str:
    """Normalize to a compact E.164-ish form for Kenya-friendly rider login.

    Accepts ``+2547…``, ``2547…``, ``07…``, or 9-digit local ``7…`` and stores/looks
    up as ``+2547…``. Non-Kenya numbers keep digits with a leading ``+``.
    """
    raw = re.sub(r"\s+", "", (phone or "").strip())
    if not raw:
        return ""
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return ""
    if digits.startswith("254") and len(digits) >= 12:
        return f"+{digits}"
    if digits.startswith("0") and len(digits) >= 10:
        return f"+254{digits[1:]}"
    if len(digits) == 9 and digits.startswith(("7", "1")):
        return f"+254{digits}"
    if raw.startswith("+"):
        return f"+{digits}"
    return f"+{digits}"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _is_expired(expires_at: datetime) -> bool:
    exp = expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    return exp < _utc_now()


def rider_first_name(name: str | None) -> str:
    raw = (name or "").strip()
    if not raw:
        return "Your rider"
    return raw.split()[0]


class RiderService:
    def __init__(self, db: Session, settings: Settings | None = None):
        self.db = db
        self.settings = settings or get_settings()

    def _invite_url(self, token: str) -> str:
        base = (self.settings.frontend_url or "").rstrip("/")
        return f"{base}/rider/join/{token}"

    def _deliveries_url(self) -> str:
        base = (self.settings.frontend_url or "").rstrip("/")
        return f"{base}/r/home"

    def list_riders(self, account_id: str) -> list[dict]:
        riders = (
            self.db.query(Rider)
            .filter(
                Rider.account_id == account_id,
                Rider.status != "removed",
            )
            .order_by(Rider.created_at.desc())
            .all()
        )
        counts: dict[str, int] = {}
        if riders:
            rider_ids = [r.id for r in riders]
            rows = (
                self.db.query(Order.assigned_rider_id, func.count(Order.id))
                .filter(
                    Order.account_id == account_id,
                    Order.assigned_rider_id.in_(rider_ids),
                    Order.status.in_(tuple(ACTIVE_DELIVERY_STATUSES)),
                )
                .group_by(Order.assigned_rider_id)
                .all()
            )
            counts = {str(rider_id): int(count) for rider_id, count in rows}

        return [
            {
                "id": rider.id,
                "name": rider.name,
                "phone": rider.phone,
                "email": rider.email,
                "status": rider.status,
                "vehicle_type": rider.vehicle_type,
                "notes": rider.notes,
                "invited_at": as_utc(rider.invited_at),
                "activated_at": as_utc(rider.activated_at),
                "active_deliveries_count": counts.get(rider.id, 0),
                "is_online": bool(rider.is_online),
                "last_seen_at": as_utc(rider.last_seen_at),
                "last_lat": rider.last_lat,
                "last_lng": rider.last_lng,
            }
            for rider in riders
        ]

    def _find_duplicate_phone(self, account_id: str, phone: str) -> Rider | None:
        normalized = normalize_phone(phone)
        return (
            self.db.query(Rider)
            .filter(
                Rider.account_id == account_id,
                Rider.phone == normalized,
                Rider.status != "removed",
            )
            .first()
        )

    def create_invite(
        self,
        account_id: str,
        *,
        name: str,
        phone: str,
        vehicle_type: str | None = None,
        notes: str | None = None,
        email: str | None = None,
    ) -> dict:
        clean_name = (name or "").strip()
        clean_phone = normalize_phone(phone)
        clean_email = (email or "").strip().lower() or None
        if not clean_name:
            raise RiderServiceError("Rider name is required.")
        if not clean_phone:
            raise RiderServiceError("Rider phone is required.")

        if self._find_duplicate_phone(account_id, clean_phone):
            raise RiderServiceError("A rider with this phone number already exists.")

        now = datetime.now(timezone.utc)
        rider = Rider(
            account_id=account_id,
            name=clean_name,
            phone=clean_phone,
            email=clean_email,
            status="invited",
            vehicle_type=(vehicle_type or "").strip() or None,
            notes=(notes or "").strip() or None,
            invited_at=now,
            created_at=now,
            updated_at=now,
        )
        self.db.add(rider)
        self.db.flush()

        jti = str(uuid.uuid4())
        expires_at = now + timedelta(days=7)
        invite = RiderInvite(
            rider_id=rider.id,
            token_jti=jti,
            expires_at=expires_at,
            created_at=now,
        )
        self.db.add(invite)
        self.db.flush()

        token = mint_rider_invite_token(rider.id, invite.id, jti=jti)
        invite_url = self._invite_url(token)
        self.db.commit()
        self.db.refresh(rider)

        return {
            "rider": rider,
            "invite_url": invite_url,
            "token": token,
            "expires_at": expires_at,
        }

    def suspend_rider(self, account_id: str, rider_id: str) -> Rider:
        rider = self._get_owned_rider(account_id, rider_id)
        if rider.status == "removed":
            raise RiderServiceError("This rider has been removed.")
        rider.status = "suspended"
        rider.is_online = False
        rider.updated_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(rider)
        return rider

    def set_rider_email(self, account_id: str, rider_id: str, email: str) -> Rider:
        return self.update_rider(account_id, rider_id, email=email)

    def update_rider(
        self,
        account_id: str,
        rider_id: str,
        *,
        name: str | None = None,
        phone: str | None = None,
        email: str | None = None,
        vehicle_type: str | None = None,
        notes: str | None = None,
        clear_vehicle_type: bool = False,
        clear_notes: bool = False,
    ) -> Rider:
        rider = self._get_owned_rider(account_id, rider_id)
        now = datetime.now(timezone.utc)

        if name is not None:
            clean_name = name.strip()
            if not clean_name:
                raise RiderServiceError("Rider name is required.")
            rider.name = clean_name

        if phone is not None:
            clean_phone = normalize_phone(phone)
            if not clean_phone:
                raise RiderServiceError("Rider phone is required.")
            duplicate = self._find_duplicate_phone(account_id, clean_phone)
            if duplicate and duplicate.id != rider.id:
                raise RiderServiceError("A rider with this phone number already exists.")
            rider.phone = clean_phone

        if email is not None:
            clean_email = email.strip().lower()
            if not clean_email or "@" not in clean_email:
                raise RiderServiceError("A valid email address is required.")
            rider.email = clean_email

        if clear_vehicle_type:
            rider.vehicle_type = None
        elif vehicle_type is not None:
            rider.vehicle_type = vehicle_type.strip() or None

        if clear_notes:
            rider.notes = None
        elif notes is not None:
            rider.notes = notes.strip() or None

        rider.updated_at = now
        self.db.commit()
        self.db.refresh(rider)
        return rider

    def _get_owned_rider(self, account_id: str, rider_id: str) -> Rider:
        rider = (
            self.db.query(Rider)
            .filter(Rider.id == rider_id, Rider.account_id == account_id)
            .first()
        )
        if not rider or rider.status == "removed":
            raise RiderServiceError("Rider not found.")
        return rider

    def get_join_info(self, token: str) -> dict:
        try:
            payload = read_rider_invite_token(token)
        except RiderInviteTokenInvalid as exc:
            raise RiderServiceError(str(exc)) from exc

        rider = self.db.get(Rider, str(payload["rid"]))
        if not rider or rider.status == "removed":
            raise RiderServiceError("This invite is no longer valid.")

        invite = (
            self.db.query(RiderInvite)
            .filter(
                RiderInvite.rider_id == rider.id,
                RiderInvite.token_jti == str(payload["jti"]),
            )
            .first()
        )
        if not invite:
            raise RiderServiceError("Invite link is invalid.")
        if invite.accepted_at is not None and rider.status == "active":
            account = self.db.get(Account, rider.account_id)
            return {
                "rider_name": rider.name,
                "merchant_name": account.business_name if account else "Shop",
                "phone": rider.phone,
                "email": rider.email,
                "already_active": True,
                "needs_email": not bool((rider.email or "").strip()),
                "deliveries_url": self._deliveries_url(),
            }
        if _is_expired(invite.expires_at):
            raise RiderServiceError("Invite link has expired.")

        account = self.db.get(Account, rider.account_id)
        return {
            "rider_name": rider.name,
            "merchant_name": account.business_name if account else "Shop",
            "phone": rider.phone,
            "email": rider.email,
            "already_active": False,
            "needs_email": not bool((rider.email or "").strip()),
            "deliveries_url": self._deliveries_url(),
        }

    def accept_invite(
        self,
        token: str,
        *,
        name: str | None = None,
        email: str | None = None,
    ) -> Rider:
        try:
            payload = read_rider_invite_token(token)
        except RiderInviteTokenInvalid as exc:
            raise RiderServiceError(str(exc)) from exc

        rider = self.db.get(Rider, str(payload["rid"]))
        if not rider or rider.status == "removed":
            raise RiderServiceError("This invite is no longer valid.")

        invite = (
            self.db.query(RiderInvite)
            .filter(
                RiderInvite.rider_id == rider.id,
                RiderInvite.token_jti == str(payload["jti"]),
            )
            .first()
        )
        if not invite:
            raise RiderServiceError("Invite link is invalid.")
        # Active riders may reopen the invite link to finish missing profile fields.
        if rider.status != "active" and _is_expired(invite.expires_at):
            raise RiderServiceError("Invite link has expired.")

        clean_email = (email or "").strip().lower()
        if not clean_email or "@" not in clean_email:
            raise RiderServiceError("Email is required so you can sign back in later.")

        now = datetime.now(timezone.utc)
        if name and name.strip():
            rider.name = name.strip()
        rider.email = clean_email
        if rider.status != "active":
            rider.status = "active"
            rider.activated_at = now
        if not invite.accepted_at:
            invite.accepted_at = now
        rider.updated_at = now
        self.db.commit()
        self.db.refresh(rider)
        return rider

    def assign_order(
        self,
        account_id: str,
        order: Order,
        rider_id: str,
    ) -> Order:
        rider = self._get_owned_rider(account_id, rider_id)
        if rider.status != "active":
            raise RiderServiceError("Only active riders can be assigned deliveries.")
        if order.fulfillment_type != "delivery":
            raise RiderServiceError("Riders can only be assigned to delivery orders.")

        now = datetime.now(timezone.utc)
        order.assigned_rider_id = rider.id
        order.rider_assigned_at = now
        if not order.rider_trip_phase:
            order.rider_trip_phase = "en_route_to_store"
        order.updated_at = now
        self.db.commit()
        self.db.refresh(order)

        from app.services.rider_trip_service import RiderTripService

        RiderTripService(self.db).cancel_offers_for_order(order.id)
        return order
