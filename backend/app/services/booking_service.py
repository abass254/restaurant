"""Salon / appointment booking helpers."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.models import (
    SERVICE_BUSINESS_CATEGORIES,
    Account,
    Booking,
    BookingProvider,
    BookingProviderService,
    BookingSettings,
    BookingWeeklyHours,
    InventoryItem,
    Product,
    _new_uuid,
)

_SLUG_RE = re.compile(r"[^a-z0-9]+")

ACTIVE_SLOT_STATUSES = ("pending", "confirmed")
TERMINAL_STATUSES = frozenset({"cancelled", "completed", "no_show"})
PATCHABLE_STATUSES = frozenset({"cancelled", "completed", "no_show", "confirmed"})


def is_service_business(category: str | None) -> bool:
    return (category or "").strip() in SERVICE_BUSINESS_CATEGORIES


def slugify_booking(value: str) -> str:
    slug = _SLUG_RE.sub("-", (value or "").lower()).strip("-")
    return slug[:80] or "shop"


def ensure_booking_settings(db: Session, account: Account) -> BookingSettings:
    row = (
        db.query(BookingSettings)
        .filter(BookingSettings.account_id == account.id)
        .first()
    )
    if row is not None:
        return row
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    suggested = slugify_booking(account.business_name or "shop")
    # Avoid colliding with an existing slug on first seed.
    base = suggested
    n = 1
    while db.query(BookingSettings.id).filter(BookingSettings.booking_slug == suggested).first():
        n += 1
        suggested = f"{base}-{n}"[:80]
    row = BookingSettings(
        account_id=account.id,
        booking_slug=suggested,
        header_text=account.business_name,
        brand_color="#1a1410",
        deposit_type="none",
        min_notice_minutes=60,
        timezone="Africa/Nairobi",
        go_live=False,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    return row


def _parse_hhmm(value: str) -> tuple[int, int]:
    parts = (value or "09:00").split(":")
    return int(parts[0]), int(parts[1]) if len(parts) > 1 else 0


def duration_minutes_for_item(item: InventoryItem) -> int:
    product = item.product
    attrs = product.attributes if product and isinstance(product.attributes, dict) else {}
    raw = attrs.get("duration_minutes") if isinstance(attrs, dict) else None
    try:
        mins = int(raw)
    except (TypeError, ValueError):
        mins = 60
    return max(15, min(mins, 8 * 60))


def compute_deposit(
    settings: BookingSettings,
    service_price: float | Decimal | None,
) -> Decimal | None:
    dtype = (settings.deposit_type or "none").lower()
    if dtype == "none":
        return None
    price = Decimal(str(service_price or 0))
    if dtype == "full":
        return price
    if dtype == "fixed":
        if settings.deposit_amount is None:
            return None
        return Decimal(str(settings.deposit_amount))
    if dtype == "percent":
        pct = Decimal(str(settings.deposit_percent or 0))
        return (price * pct / Decimal("100")).quantize(Decimal("0.01"))
    return None


def count_active_services(db: Session, account_id: str) -> int:
    return (
        db.query(InventoryItem)
        .join(Product, Product.id == InventoryItem.product_id)
        .filter(
            InventoryItem.account_id == account_id,
            InventoryItem.is_active.is_(True),
            Product.product_type == "service",
        )
        .count()
    )


def count_weekly_hours(db: Session, account_id: str) -> int:
    return (
        db.query(BookingWeeklyHours)
        .filter(BookingWeeklyHours.account_id == account_id)
        .count()
    )


def booking_readiness(
    db: Session,
    row: BookingSettings,
    *,
    slug_override: str | None = None,
) -> dict[str, Any]:
    """What must be true before a shop can publish its public booking page."""
    slug = (slug_override if slug_override is not None else row.booking_slug) or ""
    slug = slug.strip()
    service_count = count_active_services(db, row.account_id)
    hours_count = count_weekly_hours(db, row.account_id)

    missing: list[str] = []
    if not slug:
        missing.append("Set a booking link slug")
    if service_count < 1:
        missing.append("Add at least one active service")
    if hours_count < 1:
        missing.append("Set weekly opening hours")

    return {
        "ready": len(missing) == 0,
        "missing": missing,
        "service_count": service_count,
        "hours_count": hours_count,
        "has_slug": bool(slug),
    }


def settings_out(
    row: BookingSettings,
    *,
    readiness: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": row.id,
        "account_id": row.account_id,
        "booking_slug": row.booking_slug,
        "header_text": row.header_text,
        "brand_color": row.brand_color,
        "deposit_type": row.deposit_type,
        "deposit_amount": float(row.deposit_amount) if row.deposit_amount is not None else None,
        "deposit_percent": float(row.deposit_percent) if row.deposit_percent is not None else None,
        "min_notice_minutes": row.min_notice_minutes,
        "timezone": row.timezone,
        "go_live": bool(row.go_live),
        "public_url": f"/book/{row.booking_slug}" if row.booking_slug else None,
    }
    if readiness is not None:
        out["readiness"] = readiness
    return out


def provider_out(row: BookingProvider, service_ids: list[str] | None = None) -> dict[str, Any]:
    return {
        "id": row.id,
        "account_id": row.account_id,
        "display_name": row.display_name,
        "role": row.role,
        "bio": row.bio,
        "photo_url": row.photo_url,
        "is_active": bool(row.is_active),
        "sort_order": row.sort_order,
        "inventory_item_ids": service_ids or [],
    }


def hours_out(row: BookingWeeklyHours) -> dict[str, Any]:
    return {
        "id": row.id,
        "account_id": row.account_id,
        "provider_id": row.provider_id,
        "weekday": row.weekday,
        "open_time": row.open_time,
        "close_time": row.close_time,
        "is_closed": bool(row.is_closed),
    }


def booking_out(
    row: Booking,
    *,
    service_name: str | None = None,
    provider_name: str | None = None,
    mpesa_status: str | None = None,
) -> dict[str, Any]:
    deposit = float(row.deposit_amount) if row.deposit_amount is not None else None
    return {
        "id": row.id,
        "account_id": row.account_id,
        "provider_id": row.provider_id,
        "inventory_item_id": row.inventory_item_id,
        "starts_at": row.starts_at.isoformat() if row.starts_at else None,
        "ends_at": row.ends_at.isoformat() if row.ends_at else None,
        "customer_name": row.customer_name,
        "customer_phone": row.customer_phone,
        "status": row.status,
        "deposit_amount": deposit,
        "deposit_required": bool(deposit and deposit > 0 and row.status == "pending"),
        "deposit_mpesa_txn_id": row.deposit_mpesa_txn_id,
        "mpesa_status": mpesa_status,
        "public_token": row.public_token,
        "notes": row.notes,
        "service_name": service_name,
        "provider_name": provider_name,
    }


def enrich_booking_out(db: Session, row: Booking) -> dict[str, Any]:
    service_name = None
    item = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .filter(InventoryItem.id == row.inventory_item_id)
        .first()
    )
    if item and item.product:
        service_name = item.product.name
    provider_name = None
    if row.provider_id:
        provider = db.get(BookingProvider, row.provider_id)
        if provider:
            provider_name = provider.display_name
    mpesa_status = None
    if row.deposit_mpesa_txn_id:
        from app.models import MpesaTransaction

        txn = db.get(MpesaTransaction, row.deposit_mpesa_txn_id)
        if txn:
            mpesa_status = txn.status
    return booking_out(
        row,
        service_name=service_name,
        provider_name=provider_name,
        mpesa_status=mpesa_status,
    )


def service_card(item: InventoryItem) -> dict[str, Any]:
    product: Product | None = item.product
    attrs = product.attributes if product and isinstance(product.attributes, dict) else {}
    return {
        "inventory_item_id": item.id,
        "product_id": item.product_id,
        "name": product.name if product else "Service",
        "category": product.category if product else None,
        "description": product.description if product else None,
        "duration_minutes": duration_minutes_for_item(item),
        "price": float(item.selling_price) if item.selling_price is not None else None,
        "attributes": attrs or {},
    }


def list_provider_service_ids(db: Session, provider_id: str) -> list[str]:
    rows = (
        db.query(BookingProviderService.inventory_item_id)
        .filter(BookingProviderService.provider_id == provider_id)
        .all()
    )
    return [r[0] for r in rows]


def set_provider_services(
    db: Session,
    provider_id: str,
    inventory_item_ids: list[str],
) -> None:
    db.query(BookingProviderService).filter(
        BookingProviderService.provider_id == provider_id,
    ).delete()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for item_id in inventory_item_ids:
        db.add(
            BookingProviderService(
                provider_id=provider_id,
                inventory_item_id=item_id,
                created_at=now,
            )
        )
    db.flush()


def hours_for_day(
    db: Session,
    account_id: str,
    day: date,
    provider_id: str | None,
) -> BookingWeeklyHours | None:
    weekday = day.weekday()  # Mon=0
    q = db.query(BookingWeeklyHours).filter(
        BookingWeeklyHours.account_id == account_id,
        BookingWeeklyHours.weekday == weekday,
    )
    if provider_id:
        row = q.filter(BookingWeeklyHours.provider_id == provider_id).first()
        if row is not None:
            return row
    return q.filter(BookingWeeklyHours.provider_id.is_(None)).first()


def available_slots(
    db: Session,
    *,
    account_id: str,
    settings: BookingSettings,
    inventory_item_id: str,
    provider_id: str | None,
    day: date,
    exclude_booking_id: str | None = None,
) -> list[str]:
    item = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .filter(
            InventoryItem.id == inventory_item_id,
            InventoryItem.account_id == account_id,
            InventoryItem.is_active.is_(True),
        )
        .first()
    )
    if item is None:
        return []

    hours = hours_for_day(db, account_id, day, provider_id)
    if hours is None or hours.is_closed:
        return []

    duration = duration_minutes_for_item(item)
    open_h, open_m = _parse_hhmm(hours.open_time)
    close_h, close_m = _parse_hhmm(hours.close_time)
    start_cursor = datetime(day.year, day.month, day.day, open_h, open_m)
    day_end = datetime(day.year, day.month, day.day, close_h, close_m)
    notice = timedelta(minutes=max(0, settings.min_notice_minutes or 0))
    earliest = datetime.utcnow() + notice

    q = db.query(Booking).filter(
        Booking.account_id == account_id,
        Booking.status.in_(ACTIVE_SLOT_STATUSES),
        Booking.starts_at < day_end,
        Booking.ends_at > start_cursor,
    )
    if exclude_booking_id:
        q = q.filter(Booking.id != exclude_booking_id)
    existing = q.all()
    if provider_id:
        existing = [b for b in existing if b.provider_id in (None, provider_id)]

    slots: list[str] = []
    cursor = start_cursor
    step = timedelta(minutes=duration)
    while cursor + step <= day_end:
        end = cursor + step
        if cursor >= earliest:
            conflict = any(
                not (end <= b.starts_at or cursor >= b.ends_at) for b in existing
            )
            if not conflict:
                slots.append(cursor.strftime("%Y-%m-%dT%H:%M:%S"))
        cursor += step
    return slots


def _slot_is_available(
    db: Session,
    *,
    account_id: str,
    settings: BookingSettings,
    inventory_item_id: str,
    provider_id: str | None,
    starts_at: datetime,
    exclude_booking_id: str | None = None,
) -> bool:
    day = starts_at.date()
    wanted = starts_at.strftime("%Y-%m-%dT%H:%M:%S")
    slots = available_slots(
        db,
        account_id=account_id,
        settings=settings,
        inventory_item_id=inventory_item_id,
        provider_id=provider_id,
        day=day,
        exclude_booking_id=exclude_booking_id,
    )
    return wanted in slots


def create_booking(
    db: Session,
    *,
    account_id: str,
    settings: BookingSettings,
    inventory_item_id: str,
    provider_id: str | None,
    starts_at: datetime,
    customer_name: str,
    customer_phone: str,
    notes: str | None = None,
    skip_slot_check: bool = False,
) -> Booking:
    item = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .filter(
            InventoryItem.id == inventory_item_id,
            InventoryItem.account_id == account_id,
            InventoryItem.is_active.is_(True),
        )
        .first()
    )
    if item is None:
        raise ValueError("Service not found.")

    if provider_id:
        provider = (
            db.query(BookingProvider)
            .filter(
                BookingProvider.id == provider_id,
                BookingProvider.account_id == account_id,
                BookingProvider.is_active.is_(True),
            )
            .first()
        )
        if provider is None:
            raise ValueError("Staff member not found.")

    if not skip_slot_check and not _slot_is_available(
        db,
        account_id=account_id,
        settings=settings,
        inventory_item_id=inventory_item_id,
        provider_id=provider_id,
        starts_at=starts_at,
    ):
        raise ValueError("That time slot is no longer available.")

    duration = duration_minutes_for_item(item)
    ends_at = starts_at + timedelta(minutes=duration)
    deposit = compute_deposit(settings, item.selling_price)
    needs_deposit = deposit is not None and deposit > 0
    now = datetime.utcnow()
    row = Booking(
        id=_new_uuid(),
        account_id=account_id,
        provider_id=provider_id,
        inventory_item_id=inventory_item_id,
        starts_at=starts_at,
        ends_at=ends_at,
        customer_name=customer_name.strip(),
        customer_phone=customer_phone.strip(),
        status="pending" if needs_deposit else "confirmed",
        deposit_amount=deposit,
        public_token=_new_uuid(),
        notes=notes,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    return row


def update_booking_status(
    db: Session,
    booking: Booking,
    *,
    status_value: str | None = None,
    notes: str | None = None,
) -> Booking:
    if status_value is not None:
        status_value = status_value.strip().lower()
        if status_value not in PATCHABLE_STATUSES:
            raise ValueError("Invalid status.")
        if booking.status in TERMINAL_STATUSES and status_value != booking.status:
            raise ValueError("This appointment is already closed.")
        booking.status = status_value
    if notes is not None:
        booking.notes = notes.strip() or None
    booking.updated_at = datetime.utcnow()
    db.flush()
    return booking


def reschedule_booking(
    db: Session,
    booking: Booking,
    settings: BookingSettings,
    *,
    starts_at: datetime,
    provider_id: str | None = None,
) -> Booking:
    if booking.status in TERMINAL_STATUSES:
        raise ValueError("Cannot reschedule a closed appointment.")
    if booking.status not in ACTIVE_SLOT_STATUSES:
        raise ValueError("Only pending or confirmed appointments can be rescheduled.")

    next_provider = provider_id if provider_id is not None else booking.provider_id
    if not _slot_is_available(
        db,
        account_id=booking.account_id,
        settings=settings,
        inventory_item_id=booking.inventory_item_id,
        provider_id=next_provider,
        starts_at=starts_at,
        exclude_booking_id=booking.id,
    ):
        raise ValueError("That time slot is no longer available.")

    item = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .filter(InventoryItem.id == booking.inventory_item_id)
        .first()
    )
    if item is None:
        raise ValueError("Service not found.")

    duration = duration_minutes_for_item(item)
    booking.starts_at = starts_at
    booking.ends_at = starts_at + timedelta(minutes=duration)
    booking.provider_id = next_provider
    booking.updated_at = datetime.utcnow()
    db.flush()
    return booking


def confirm_booking_deposit(db: Session, booking: Booking) -> Booking:
    if booking.status == "pending":
        booking.status = "confirmed"
        booking.updated_at = datetime.utcnow()
        db.flush()
    return booking
