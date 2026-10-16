"""Restaurant store-to-kitchen issuing.

When a restaurant turns on kitchen issuing, deliveries land in the store and
the storekeeper releases supplies to the kitchen (an *issue*). Sales then use
recipe ingredients from the kitchen, so each side answers for its own stock:
the store for deliveries minus issues, the kitchen for issues minus what the
menu used.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import ROUND_CEILING, Decimal
from typing import Any

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    Account,
    Catalogue,
    InventoryItem,
    KitchenIssue,
    KitchenIssueLine,
    StockMovement,
)
from app.services.inventory_stock_service import (
    MONEY,
    QTY,
    InsufficientStockError,
    lock_item,
    record_movement,
    transfer,
)
from app.services.order_stock_service import kitchen_issuing_on
from app.support.store_type import is_restaurant

NON_STOCK_TYPES = ("meal", "combo", "service")


ISSUABLE_ROLES = ("raw_material", "both")


class KitchenIssueError(ValueError):
    pass


class KitchenIssueNotFound(KitchenIssueError):
    pass


def _f(value: Any) -> float | None:
    return float(value) if value is not None else None


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _qty(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(QTY)


def _name(item: InventoryItem) -> str:
    return item.product.name if item.product else "Item"


def _unit(item: InventoryItem) -> str:
    return (item.product.unit if item.product else None) or "Piece"


def _require_enabled(account: Account | None) -> None:
    if not kitchen_issuing_on(account):
        raise KitchenIssueError("Turn on store and kitchen in Settings first.")


# --- Kitchen supplies ------------------------------------------------------------


def kitchen_supplies(db: Session, account_id: str) -> list[InventoryItem]:
    """Stock-tracked raw materials the kitchen can hold: ingredients for meal preparation."""
    return (
        db.query(InventoryItem)
        .join(Catalogue, Catalogue.id == InventoryItem.product_id)
        .options(joinedload(InventoryItem.product))
        .filter(
            InventoryItem.account_id == account_id,
            InventoryItem.stock_quantity.isnot(None),
            ~func.lower(func.coalesce(Catalogue.product_type, "retail")).in_(NON_STOCK_TYPES),
            or_(
                InventoryItem.inventory_role.in_(ISSUABLE_ROLES),
                InventoryItem.kitchen_quantity.isnot(None),
            ),
        )
        .order_by(Catalogue.name.asc())
        .all()
    )


def _daily_kitchen_usage(
    db: Session,
    account_id: str,
    item_ids: list[str],
    *,
    days: int,
    now: datetime,
) -> dict[str, Decimal]:
    """Average daily sale usage per item over the last ``days`` days.

    Uses kitchen sales; items with no kitchen history yet (just switched on)
    fall back to their recipe sales from the store.
    """
    if not item_ids:
        return {}
    since = now - timedelta(days=days)
    rows = (
        db.query(StockMovement)
        .filter(
            StockMovement.account_id == account_id,
            StockMovement.inventory_item_id.in_(item_ids),
            StockMovement.reason.in_(("sale", "sale_reversal")),
            StockMovement.created_at >= since,
        )
        .all()
    )
    kitchen: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    store: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for m in rows:
        used = Decimal(str(m.quantity)) * (1 if m.direction == "out" else -1)
        (kitchen if m.location == "kitchen" else store)[m.inventory_item_id] += used
    out: dict[str, Decimal] = {}
    for item_id in item_ids:
        total = kitchen[item_id] if item_id in kitchen else store.get(item_id, Decimal("0"))
        if total > 0:
            out[item_id] = total / days
    return out


def suggest_issue(
    db: Session,
    account_id: str,
    *,
    days: int = 7,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """What to issue today: average daily usage minus what the kitchen already holds."""
    now = now or datetime.utcnow()
    items = [item for item in kitchen_supplies(db, account_id) if item.inventory_role in ISSUABLE_ROLES]
    usage = _daily_kitchen_usage(db, account_id, [item.id for item in items], days=days, now=now)
    out: list[dict[str, Any]] = []
    for item in items:
        daily = usage.get(item.id, Decimal("0"))
        kitchen = _qty(item.kitchen_quantity)
        need = max(daily - max(kitchen, Decimal("0")), Decimal("0"))
        out.append(
            {
                **kitchen_item_out(item),
                "daily_usage": float(daily.quantize(QTY)),
                "suggested_qty": float(need.quantize(QTY, rounding=ROUND_CEILING)),
            }
        )
    return out


def kitchen_item_out(item: InventoryItem) -> dict[str, Any]:
    store = _qty(item.stock_quantity)
    kitchen = _qty(item.kitchen_quantity)
    cost = Decimal(str(item.buying_price)) if item.buying_price is not None else None
    return {
        "inventory_item_id": item.id,
        "name": _name(item),
        "unit": _unit(item),
        "inventory_role": item.normalized_role(),
        "store_quantity": float(store),
        "kitchen_quantity": float(kitchen),
        "average_cost": _f(cost),
        "kitchen_value": float((kitchen * cost).quantize(MONEY)) if cost is not None else None,
        "store_value": float((store * cost).quantize(MONEY)) if cost is not None else None,
    }


# --- Issues ------------------------------------------------------------------------


def get_issue(db: Session, account_id: str, issue_id: str, *, lock: bool = False) -> KitchenIssue:
    query = (
        db.query(KitchenIssue)
        .options(
            selectinload(KitchenIssue.lines)
            .joinedload(KitchenIssueLine.inventory_item)
            .joinedload(InventoryItem.product)
        )
        .filter(KitchenIssue.id == issue_id, KitchenIssue.account_id == account_id)
    )
    if lock:
        query = query.with_for_update(of=KitchenIssue)
    issue = query.first()
    if issue is None:
        raise KitchenIssueNotFound("Kitchen issue not found.")
    return issue


def list_issues(
    db: Session,
    account_id: str,
    *,
    status: str | None = None,
    limit: int = 100,
) -> list[KitchenIssue]:
    query = (
        db.query(KitchenIssue)
        .options(selectinload(KitchenIssue.lines))
        .filter(KitchenIssue.account_id == account_id)
    )
    if status:
        query = query.filter(KitchenIssue.status == status)
    return query.order_by(KitchenIssue.created_at.desc()).limit(limit).all()


def create_issue(
    db: Session,
    account: Account,
    lines: list[tuple[str, Decimal]],
    *,
    user_id: str | None,
    issue_date: date | None = None,
    notes: str | None = None,
    issue_now: bool = False,
) -> KitchenIssue:
    """Record a kitchen request; with ``issue_now`` the store releases it straight away."""
    _require_enabled(account)
    wanted: dict[str, Decimal] = {}
    for item_id, qty in lines:
        q = _qty(qty)
        if q < 0:
            raise KitchenIssueError("Quantities can't be negative.")
        if q > 0:
            wanted[str(item_id)] = wanted.get(str(item_id), Decimal("0")) + q
    if not wanted:
        raise KitchenIssueError("Add at least one supply with a quantity.")
    allowed = {item.id: item for item in kitchen_supplies(db, account.id)}
    missing = [item_id for item_id in wanted if item_id not in allowed]
    if missing:
        raise KitchenIssueError("Only stock-tracked supplies can be issued to the kitchen.")
    non_raw = [
        item.product.name
        for item_id, item in allowed.items()
        if item_id in wanted and item.inventory_role not in ISSUABLE_ROLES
    ]
    if non_raw:
        raise KitchenIssueError(
            "Only raw materials and items used in cooking can be released to the kitchen. "
            f"Buy & sell items are sold as they are: {', '.join(non_raw)}"
        )

    now = datetime.utcnow()
    issue = KitchenIssue(
        account_id=account.id,
        status="requested",
        issue_date=issue_date or now.date(),
        notes=(notes or "").strip() or None,
        requested_by=user_id,
        created_at=now,
        updated_at=now,
    )
    issue.lines = [
        KitchenIssueLine(
            inventory_item_id=item_id,
            item_name=_name(allowed[item_id]),
            requested_qty=qty,
        )
        for item_id, qty in wanted.items()
    ]
    db.add(issue)
    db.flush()
    if issue_now:
        release_issue(db, account, issue.id, None, user_id=user_id)
    return issue


def release_issue(
    db: Session,
    account: Account,
    issue_id: str,
    quantities: dict[str, Decimal | None] | None,
    *,
    user_id: str | None,
) -> KitchenIssue:
    """Move the issued quantities from store to kitchen.

    ``quantities`` maps line id to what was actually handed over; missing lines
    use the requested amount. The store can't go below zero.
    """
    _require_enabled(account)
    issue = get_issue(db, account.id, issue_id, lock=True)
    if issue.status != "requested":
        raise KitchenIssueError("This issue has already been handled.")
    quantities = quantities or {}
    unknown = set(quantities) - {line.id for line in issue.lines}
    if unknown:
        raise KitchenIssueError("That line isn't on this issue.")

    now = datetime.utcnow()
    moved = False
    for line in issue.lines:
        given = quantities.get(line.id, line.requested_qty)
        qty = _qty(given)
        if qty < 0:
            raise KitchenIssueError(f"{line.item_name}: quantity can't be negative.")
        line.issued_qty = qty
        if qty == 0:
            continue
        item = lock_item(db, line.inventory_item_id, account_id=account.id)
        if item is None or item.stock_quantity is None:
            raise KitchenIssueError(f"{line.item_name} is no longer stock-tracked.")
        line.unit_cost = item.buying_price
        try:
            transfer(
                db,
                item,
                qty,
                account_id=account.id,
                from_location="store",
                to_location="kitchen",
                reason="issue",
                user_id=user_id,
                note="Issued to kitchen",
                links={"kitchen_issue_id": issue.id},
                now=now,
            )
        except InsufficientStockError as exc:
            raise KitchenIssueError(
                f"Only {exc.available.normalize():f} {_unit(item)} of {line.item_name} in the store."
            ) from exc
        moved = True
    if not moved:
        raise KitchenIssueError("Enter at least one quantity to issue.")
    issue.status = "issued"
    issue.issued_by = user_id
    issue.issued_at = now
    issue.updated_at = now
    return issue


def cancel_issue(db: Session, account_id: str, issue_id: str) -> KitchenIssue:
    issue = get_issue(db, account_id, issue_id, lock=True)
    if issue.status != "requested":
        raise KitchenIssueError("Only a pending request can be cancelled.")
    issue.status = "cancelled"
    issue.updated_at = datetime.utcnow()
    return issue


def return_to_store(
    db: Session,
    account: Account,
    lines: list[tuple[str, Decimal]],
    *,
    user_id: str | None,
    note: str | None = None,
) -> list[StockMovement]:
    """Send unused kitchen stock back to the store."""
    _require_enabled(account)
    now = datetime.utcnow()
    rows: list[StockMovement] = []
    for item_id, qty in lines:
        q = _qty(qty)
        if q <= 0:
            continue
        item = lock_item(db, str(item_id), account_id=account.id)
        if item is None or item.stock_quantity is None:
            raise KitchenIssueError("That supply isn't stock-tracked.")
        try:
            out_row, in_row = transfer(
                db,
                item,
                q,
                account_id=account.id,
                from_location="kitchen",
                to_location="store",
                reason="kitchen_return",
                user_id=user_id,
                note=(note or "").strip() or "Returned to store",
                now=now,
            )
        except InsufficientStockError as exc:
            raise KitchenIssueError(
                f"The kitchen only has {exc.available.normalize():f} {_unit(item)} of {_name(item)}."
            ) from exc
        rows += [out_row, in_row]
    if not rows:
        raise KitchenIssueError("Enter at least one quantity to return.")
    return rows


def record_kitchen_used(
    db: Session,
    account: Account,
    lines: list[tuple[str, Decimal]],
    *,
    user_id: str | None,
    note: str | None = None,
    reason: str = "adjustment",
) -> list[StockMovement]:
    """Record supplies consumed or used in the kitchen."""
    _require_enabled(account)
    now = datetime.utcnow()
    rows: list[StockMovement] = []
    trimmed_note = (note or "").strip() or "Used in kitchen"
    for item_id, qty in lines:
        q = _qty(qty)
        if q <= 0:
            continue
        item = lock_item(db, str(item_id), account_id=account.id)
        if item is None or item.stock_quantity is None:
            raise KitchenIssueError("That supply isn't stock-tracked.")
        available = _qty(item.kitchen_quantity)
        if q > available:
            raise KitchenIssueError(
                f"The kitchen only has {available.normalize():f} {_unit(item)} of {_name(item)}."
            )
        movement = record_movement(
            db,
            item,
            account_id=account.id,
            direction="out",
            quantity=q,
            reason=reason if reason in ("adjustment", "wastage") else "adjustment",  # type: ignore[arg-type]
            location="kitchen",
            user_id=user_id,
            note=trimmed_note,
            now=now,
        )
        rows.append(movement)
    if not rows:
        raise KitchenIssueError("Enter at least one quantity used.")
    return rows


# --- Switching on / off ------------------------------------------------------------


def enable_kitchen_issuing(
    db: Session,
    account: Account,
    opening_counts: dict[str, Decimal],
    *,
    user_id: str | None,
) -> list[StockMovement]:
    """Turn on store/kitchen split, moving what is already in the kitchen out of store stock."""
    if not is_restaurant(account):
        raise KitchenIssueError("Store and kitchen is only available for restaurants.")
    if kitchen_issuing_on(account):
        raise KitchenIssueError("Store and kitchen is already on.")
    allowed = {item.id for item in kitchen_supplies(db, account.id)}
    now = datetime.utcnow()
    rows: list[StockMovement] = []
    for item_id in allowed:
        item = lock_item(db, item_id, account_id=account.id)
        if item is not None and item.kitchen_quantity is None:
            item.kitchen_quantity = Decimal("0")
    for item_id, qty in opening_counts.items():
        q = _qty(qty)
        if q < 0:
            raise KitchenIssueError("Counts can't be negative.")
        if q == 0:
            continue
        if item_id not in allowed:
            raise KitchenIssueError("Only stock-tracked supplies can be in the kitchen.")
        item = lock_item(db, item_id, account_id=account.id)
        rows += transfer(
            db,
            item,
            q,
            account_id=account.id,
            from_location="store",
            to_location="kitchen",
            reason="issue",
            allow_negative=True,
            user_id=user_id,
            note="Opening kitchen stock",
            now=now,
        )
    account.kitchen_issuing_enabled = True
    return rows


def disable_kitchen_issuing(db: Session, account: Account, *, user_id: str | None) -> list[StockMovement]:
    """Turn the split off, returning all kitchen stock to the single store figure."""
    if not kitchen_issuing_on(account):
        raise KitchenIssueError("Store and kitchen is already off.")
    now = datetime.utcnow()
    rows: list[StockMovement] = []
    for item in kitchen_supplies(db, account.id):
        locked = lock_item(db, item.id, account_id=account.id)
        if locked is None:
            continue
        kitchen = _qty(locked.kitchen_quantity)
        if kitchen != 0:
            rows += transfer(
                db,
                locked,
                abs(kitchen),
                account_id=account.id,
                from_location="kitchen" if kitchen > 0 else "store",
                to_location="store" if kitchen > 0 else "kitchen",
                reason="kitchen_return",
                allow_negative=True,
                user_id=user_id,
                note="Store and kitchen turned off",
                now=now,
            )
        locked.kitchen_quantity = None
    for issue in list_issues(db, account.id, status="requested"):
        issue.status = "cancelled"
        issue.updated_at = now
    account.kitchen_issuing_enabled = False
    return rows


# --- Serialisers -------------------------------------------------------------------


def issue_out(issue: KitchenIssue, *, with_lines: bool = True) -> dict[str, Any]:
    value = Decimal("0")
    for line in issue.lines:
        if line.issued_qty is not None and line.unit_cost is not None:
            value += Decimal(str(line.issued_qty)) * Decimal(str(line.unit_cost))
    out: dict[str, Any] = {
        "id": issue.id,
        "status": issue.status,
        "issue_date": issue.issue_date.isoformat() if issue.issue_date else None,
        "notes": issue.notes,
        "requested_by": issue.requested_by,
        "issued_by": issue.issued_by,
        "issued_at": _iso(issue.issued_at),
        "created_at": _iso(issue.created_at),
        "line_count": len(issue.lines),
        "issued_value": float(value.quantize(MONEY)),
    }
    if with_lines:
        out["lines"] = [
            {
                "id": line.id,
                "inventory_item_id": line.inventory_item_id,
                "item_name": line.item_name,
                "unit": _unit(line.inventory_item) if line.inventory_item is not None else "Piece",
                "requested_qty": _f(line.requested_qty),
                "issued_qty": _f(line.issued_qty),
                "unit_cost": _f(line.unit_cost),
                "store_quantity": (
                    _f(line.inventory_item.stock_quantity) if line.inventory_item is not None else None
                ),
                "kitchen_quantity": (
                    float(_qty(line.inventory_item.kitchen_quantity)) if line.inventory_item is not None else None
                ),
            }
            for line in issue.lines
        ]
    return out
