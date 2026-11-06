"""Shared helper for building channel orders (Instagram DM + storefront).

Both the text-based sales autopilot and the web storefront create the same
shape of order — one ``Order`` with one or more ``OrderItem`` lines, an
initial ``placed`` history row, and a KES total. This module centralises that
so the two entry points can't drift apart.
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Account, InventoryItem, Order, OrderItem, OrderStatusHistory
from app.services.catalog.catalog_types import CatalogItem, platform_inventory_item_id
from app.services.inventory_stock_service import InsufficientStockError, deduct_stock
from app.services.order_stock_service import restaurant_line_usage
from app.support.order_status import PAYMENT_MPESA, PLACED
from app.support.store_type import is_restaurant_account
from app.support.store_status import is_accepting_orders
from app.support.unique_insert import insert_unique

# Mirror of the autopilot cap so a single line can't request an absurd qty.
MAX_QUANTITY = 999

_INITIALS_SKIP = frozenset({"the", "and", "of", "for", "&"})
_WORD_RE = re.compile(r"[A-Za-z0-9]+")


class StorePausedError(Exception):
    """Raised when channel/storefront orders are blocked by store pause."""

    def __init__(self, message: str = "This shop is temporarily not accepting orders."):
        super().__init__(message)
        self.message = message


def _assert_accepting(db: Session, account_id: str) -> None:
    account = db.query(Account).filter(Account.id == str(account_id)).first()
    if account is None:
        return
    if not is_accepting_orders(account):
        db.flush()
        raise StorePausedError()


def merchant_order_initials(business_name: str | None) -> str:
    """Three-letter merchant code used in order references.

    ``Spice House`` → SPH, ``Java House Nairobi`` → JHN, ``Kiosk`` → KIO.
    """
    words = [
        match.group(0)
        for match in _WORD_RE.finditer(business_name or "")
        if match.group(0).lower() not in _INITIALS_SKIP
    ]
    if not words:
        return "XXX"
    if len(words) >= 3:
        return "".join(word[0] for word in words[:3]).upper()
    if len(words) == 2:
        first, second = words[0].upper(), words[1].upper()
        if len(first) >= 2:
            return first[:2] + second[0]
        return (first + (second + "XX")[:2])[:3]
    return (words[0].upper() + "XXX")[:3]


def format_merchant_order_number(initials: str, seq: int) -> str:
    """``ORD`` + 3 merchant initials + 5-digit increment, e.g. ``ORDSPH00001``."""
    code = (initials or "XXX").upper()[:3].ljust(3, "X")
    return f"ORD{code}{max(1, int(seq)):05d}"


def next_order_number(db: Session, account_id: str, *, at_least: int = 1) -> str:
    """Next free ``ORDSPH00001``-style reference for this shop.

    Sequence is per merchant (and per initials prefix). The unique index on
    ``order_number`` keeps concurrent inserts from colliding; :func:`insert_order`
    retries with a later number when that happens.
    """
    account = db.query(Account).filter(Account.id == str(account_id)).first()
    initials = merchant_order_initials(
        account.business_name if account is not None else None
    )
    prefix = f"ORD{initials}"
    seq = int(
        (
            db.query(func.count(Order.id))
            .filter(
                Order.account_id == str(account_id),
                Order.order_number.like(f"{prefix}_____"),
            )
            .scalar()
            or 0
        )
        + 1
    )
    seq = max(seq, at_least)
    while True:
        candidate = format_merchant_order_number(initials, seq)
        if not db.query(Order.id).filter(Order.order_number == candidate).first():
            return candidate
        seq += 1


def insert_order(db: Session, order: Order) -> None:
    """Add and flush a new order, moving to a later number if another sale took this one.

    Under MySQL REPEATABLE READ the losing transaction can't see the winner's
    row, so the retry starts past the number that failed.
    """

    def renumber() -> None:
        failed = order.order_number or ""
        seq = int(failed[-5:]) if failed[-5:].isdigit() else 0
        order.order_number = next_order_number(db, order.account_id, at_least=seq + 1)

    insert_unique(db, order, renumber)


def build_instagram_order(
    db: Session,
    *,
    account_id: str,
    conversation_id: str | None,
    line_items: list[tuple[InventoryItem, int]],
    phone: str | None,
    note: str | None,
    customer_name: str | None = None,
    source: str = "instagram",
    enforce_store_open: bool = True,
) -> Order:
    """Create an ``Order`` (+ items + initial history) and flush it.

    The caller owns the transaction (commit) and any follow-up such as
    applying a saved customer profile, triggering M-PESA, or notifying.
    Totals are the sum of the line totals; delivery is the default
    fulfillment type and M-PESA the payment method, matching the channel flow.
    """
    if not line_items:
        raise ValueError("An order needs at least one line item.")

    if enforce_store_open:
        _assert_accepting(db, account_id)

    now = datetime.utcnow()
    order = Order(
        account_id=str(account_id),
        order_number=next_order_number(db, account_id),
        source=source,
        fulfillment_type="delivery",
        status=PLACED,
        source_conversation_id=conversation_id,
        customer_name=customer_name,
        customer_phone=phone,
        subtotal=Decimal("0.00"),
        delivery_fee=Decimal("0.00"),
        discount=Decimal("0.00"),
        total=Decimal("0.00"),
        currency="KES",
        payment_method=PAYMENT_MPESA,
        notes=(f"Auto-sales: {note[:300]}" if note else None),
        created_at=now,
        updated_at=now,
        placed_at=now,
    )
    insert_order(db, order)

    restaurant = is_restaurant_account(db, account_id)
    running = Decimal("0.00")
    stock_lines: list[tuple[str, int]] = []
    order_items: list[OrderItem] = []
    for item, raw_qty in line_items:
        quantity = max(1, min(int(raw_qty or 1), MAX_QUANTITY))
        unit_price = Decimal(str(item.selling_price or 0)).quantize(Decimal("0.01"))
        line_total = (unit_price * quantity).quantize(Decimal("0.01"))
        running += line_total
        stock_lines.append((str(item.id), quantity))
        order_item = OrderItem(
            order_id=order.id,
            inventory_item_id=item.id,
            product_id=item.product_id,
            product_name=(item.product.name if item.product else "Product"),
            product_sku=(item.product.sku if item.product else None),
            quantity=quantity,
            unit_price=unit_price,
            line_total=line_total,
            stock_usage=restaurant_line_usage(db, account_id, item) if restaurant else None,
            created_at=now,
            updated_at=now,
        )
        db.add(order_item)
        order_items.append(order_item)

    order.subtotal = running
    order.total = running
    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=None,
            to_status=PLACED,
            note="Order placed via sales autopilot.",
            created_at=now,
        ),
    )
    try:
        if not restaurant and deduct_stock(db, stock_lines, account_id=str(order.account_id), allow_negative=True):
            order.stock_deducted = True
    except InsufficientStockError:
        db.rollback()
        raise
    db.flush()
    return order


def build_catalog_order(
    db: Session,
    *,
    account_id: str,
    conversation_id: str | None,
    line_items: list[tuple[CatalogItem, int]],
    phone: str | None,
    note: str | None,
    customer_name: str | None = None,
    source: str = "instagram",
    enforce_store_open: bool = True,
) -> Order:
    """Create an order from normalized catalogue rows (platform or external)."""
    if not line_items:
        raise ValueError("An order needs at least one line item.")

    platform_lines: list[tuple[InventoryItem, int]] = []
    external_only: list[tuple[CatalogItem, int]] = []
    for item, quantity in line_items:
        inv_id = item.inventory_item_id or platform_inventory_item_id(item.ref)
        if inv_id:
            row = (
                db.query(InventoryItem)
                .filter(InventoryItem.id == inv_id, InventoryItem.account_id == account_id)
                .first()
            )
            if row is not None:
                platform_lines.append((row, quantity))
                continue
        external_only.append((item, quantity))

    if platform_lines and not external_only:
        return build_instagram_order(
            db,
            account_id=account_id,
            conversation_id=conversation_id,
            line_items=platform_lines,
            phone=phone,
            note=note,
            customer_name=customer_name,
            source=source,
            enforce_store_open=enforce_store_open,
        )

    if enforce_store_open:
        _assert_accepting(db, account_id)

    now = datetime.utcnow()
    order = Order(
        account_id=str(account_id),
        order_number=next_order_number(db, account_id),
        source=source,
        fulfillment_type="delivery",
        status=PLACED,
        source_conversation_id=conversation_id,
        customer_name=customer_name,
        customer_phone=phone,
        subtotal=Decimal("0.00"),
        delivery_fee=Decimal("0.00"),
        discount=Decimal("0.00"),
        total=Decimal("0.00"),
        currency="KES",
        payment_method=PAYMENT_MPESA,
        notes=(f"Auto-sales: {note[:300]}" if note else None),
        created_at=now,
        updated_at=now,
        placed_at=now,
    )
    insert_order(db, order)

    restaurant = is_restaurant_account(db, account_id)
    running = Decimal("0.00")
    stock_lines: list[tuple[str, int]] = []
    order_items: list[OrderItem] = []
    for item, raw_qty in line_items:
        quantity = max(1, min(int(raw_qty or 1), MAX_QUANTITY))
        unit_price = Decimal(str(item.price or 0)).quantize(Decimal("0.01"))
        line_total = (unit_price * quantity).quantize(Decimal("0.01"))
        running += line_total
        inv_id = item.inventory_item_id or platform_inventory_item_id(item.ref)
        inv_row = (
            db.query(InventoryItem)
            .filter(InventoryItem.id == str(inv_id), InventoryItem.account_id == str(account_id))
            .first()
            if inv_id
            else None
        )
        inv_id = inv_row.id if inv_row else None
        usage = None
        if restaurant and inv_row:
            usage = restaurant_line_usage(db, account_id, inv_row)
        order_item = OrderItem(
            order_id=order.id,
            inventory_item_id=inv_id,
            product_id=item.platform_product_id,
            product_name=item.name,
            product_sku=item.external_sku,
            quantity=quantity,
            unit_price=unit_price,
            line_total=line_total,
            stock_usage=usage,
            notes=item.ref,
            created_at=now,
            updated_at=now,
        )
        db.add(order_item)
        order_items.append(order_item)
        if inv_id:
            stock_lines.append((str(inv_id), quantity))

    order.subtotal = running
    order.total = running
    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=None,
            to_status=PLACED,
            note="Order placed via sales autopilot.",
            created_at=now,
        ),
    )
    try:
        if not restaurant and stock_lines and deduct_stock(db, stock_lines, account_id=str(order.account_id)):
            order.stock_deducted = True
    except InsufficientStockError:
        db.rollback()
        raise
    db.flush()
    return order
