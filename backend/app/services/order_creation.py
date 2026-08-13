"""Shared helper for building channel orders (Instagram DM + storefront).

Both the text-based sales autopilot and the web storefront create the same
shape of order — one ``Order`` with one or more ``OrderItem`` lines, an
initial ``placed`` history row, and a KES total. This module centralises that
so the two entry points can't drift apart.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Account, InventoryItem, Order, OrderItem, OrderStatusHistory
from app.services.catalog.catalog_types import CatalogItem, platform_inventory_item_id
from app.services.inventory_stock_service import InsufficientStockError, deduct_stock
from app.support.order_status import PAYMENT_MPESA, PLACED
from app.support.store_status import is_accepting_orders

# Mirror of the autopilot cap so a single line can't request an absurd qty.
MAX_QUANTITY = 999


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


def next_order_number(db: Session) -> str:
    """Return the next free ``ORD-000123`` style reference."""
    seq = int((db.query(func.count(Order.id)).scalar() or 0) + 1)
    while True:
        candidate = f"ORD-{seq:06d}"
        if not db.query(Order.id).filter(Order.order_number == candidate).first():
            return candidate
        seq += 1


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
) -> Order:
    """Create an ``Order`` (+ items + initial history) and flush it.

    The caller owns the transaction (commit) and any follow-up such as
    applying a saved customer profile, triggering M-PESA, or notifying.
    Totals are the sum of the line totals; delivery is the default
    fulfillment type and M-PESA the payment method, matching the channel flow.
    """
    if not line_items:
        raise ValueError("An order needs at least one line item.")

    _assert_accepting(db, account_id)

    now = datetime.utcnow()
    order = Order(
        account_id=str(account_id),
        order_number=next_order_number(db),
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
    db.add(order)
    db.flush()

    running = Decimal("0.00")
    stock_lines: list[tuple[str, int]] = []
    for item, raw_qty in line_items:
        quantity = max(1, min(int(raw_qty or 1), MAX_QUANTITY))
        unit_price = Decimal(str(item.selling_price or 0)).quantize(Decimal("0.01"))
        line_total = (unit_price * quantity).quantize(Decimal("0.01"))
        running += line_total
        stock_lines.append((str(item.id), quantity))
        db.add(
            OrderItem(
                order_id=order.id,
                inventory_item_id=item.id,
                product_id=item.product_id,
                product_name=(item.product.name if item.product else "Product"),
                product_sku=(item.product.sku if item.product else None),
                quantity=quantity,
                unit_price=unit_price,
                line_total=line_total,
                created_at=now,
                updated_at=now,
            ),
        )

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
        if deduct_stock(db, stock_lines, account_id=str(order.account_id)):
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
        )

    _assert_accepting(db, account_id)

    now = datetime.utcnow()
    order = Order(
        account_id=str(account_id),
        order_number=next_order_number(db),
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
    db.add(order)
    db.flush()

    running = Decimal("0.00")
    stock_lines: list[tuple[str, int]] = []
    for item, raw_qty in line_items:
        quantity = max(1, min(int(raw_qty or 1), MAX_QUANTITY))
        unit_price = Decimal(str(item.price or 0)).quantize(Decimal("0.01"))
        line_total = (unit_price * quantity).quantize(Decimal("0.01"))
        running += line_total
        inv_id = item.inventory_item_id or platform_inventory_item_id(item.ref)
        db.add(
            OrderItem(
                order_id=order.id,
                inventory_item_id=inv_id,
                product_id=item.platform_product_id,
                product_name=item.name,
                product_sku=item.external_sku,
                quantity=quantity,
                unit_price=unit_price,
                line_total=line_total,
                notes=item.ref,
                created_at=now,
                updated_at=now,
            ),
        )
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
        if stock_lines and deduct_stock(db, stock_lines, account_id=str(order.account_id)):
            order.stock_deducted = True
    except InsufficientStockError:
        db.rollback()
        raise
    db.flush()
    return order
