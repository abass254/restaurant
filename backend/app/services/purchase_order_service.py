"""Restaurant purchase orders: buy supplies from a supplier and receive them into stock.

Supplies always come from the shop's core inventory (``InventoryItem``). A
line is bought in a purchase unit (e.g. "50kg bag") that converts to the
item's base unit (kg) with ``unit_factor``. Receiving writes ``receive``
ledger movements linked to the supplier, order and line, and updates the
item's average cost per base unit.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    InventoryItem,
    PurchaseOrder,
    PurchaseOrderLine,
    ShopSupplier,
    StockMovement,
)
from app.services.inventory_stock_service import (
    MONEY,
    QTY,
    InsufficientStockError,
    lock_item,
    record_movement,
)
from app.services.sell_units import buy_units_for_item

DRAFT = "draft"
ORDERED = "ordered"
PARTIALLY_RECEIVED = "partially_received"
RECEIVED = "received"
CANCELLED = "cancelled"
STATUSES = (DRAFT, ORDERED, PARTIALLY_RECEIVED, RECEIVED, CANCELLED)

UNPAID = "unpaid"
PARTIAL = "partial"
PAID = "paid"

NON_STOCK_TYPES = frozenset({"meal", "combo", "service"})

_REF_RE = re.compile(r"^PO-(\d+)$")


class PurchaseOrderError(ValueError):
    pass


class PurchaseOrderNotFound(PurchaseOrderError):
    pass


@dataclass
class LineInput:
    inventory_item_id: str
    quantity: Decimal
    unit_cost: Decimal
    purchase_unit: str | None = None


@dataclass
class ReceiveInput:
    line_id: str
    quantity: Decimal
    unit_cost: Decimal | None = None


def _dec(value: Any, places: Decimal = QTY) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(places)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise PurchaseOrderError("Enter a valid number.") from exc


def _now() -> datetime:
    return datetime.utcnow()


def supply_error(item: InventoryItem | None) -> str | None:
    """Why an inventory row can't be bought as a supply (None when it can)."""
    if item is None:
        return "Item not found in your inventory."
    product = item.product
    if product is None:
        return "Item has no catalogue product."
    if (product.product_type or "").strip().lower() in NON_STOCK_TYPES:
        return f"{product.name} is a menu item or service; buy its ingredients instead."
    return None


class PurchaseOrderService:
    def __init__(self, db: Session):
        self.db = db

    # --- Queries -----------------------------------------------------------

    def _query(self, account_id: str):
        return (
            self.db.query(PurchaseOrder)
            .options(
                selectinload(PurchaseOrder.lines)
                .joinedload(PurchaseOrderLine.inventory_item)
                .joinedload(InventoryItem.product),
                joinedload(PurchaseOrder.supplier),
            )
            .filter(PurchaseOrder.account_id == account_id)
        )

    def get(self, account_id: str, po_id: str, *, lock: bool = False) -> PurchaseOrder:
        query = self._query(account_id).filter(PurchaseOrder.id == po_id)
        if lock:
            query = query.with_for_update(of=PurchaseOrder)
        po = query.first()
        if po is None:
            raise PurchaseOrderNotFound("Purchase order not found.")
        return po

    def list(
        self,
        account_id: str,
        *,
        status: str | None = None,
        supplier_id: str | None = None,
        q: str | None = None,
        limit: int = 200,
    ) -> list[PurchaseOrder]:
        query = self._query(account_id)
        if status:
            query = query.filter(PurchaseOrder.status == status)
        if supplier_id:
            query = query.filter(PurchaseOrder.supplier_id == supplier_id)
        term = (q or "").strip()
        if term:
            like = f"%{term}%"
            query = query.filter(
                PurchaseOrder.reference.ilike(like)
                | PurchaseOrder.supplier_name.ilike(like)
                | PurchaseOrder.supplier_invoice_no.ilike(like)
            )
        return query.order_by(PurchaseOrder.created_at.desc()).limit(limit).all()

    def supplier_summary(self, account_id: str, supplier_id: str) -> dict[str, float | int]:
        rows = (
            self.db.query(
                func.count(PurchaseOrder.id),
                func.coalesce(func.sum(PurchaseOrder.total), 0),
                func.coalesce(func.sum(PurchaseOrder.amount_paid), 0),
            )
            .filter(
                PurchaseOrder.account_id == account_id,
                PurchaseOrder.supplier_id == supplier_id,
                PurchaseOrder.status != CANCELLED,
            )
            .one()
        )
        count, total, paid = rows
        return {
            "purchase_orders": int(count or 0),
            "total": float(total or 0),
            "paid": float(paid or 0),
            "unpaid": float((Decimal(str(total or 0)) - Decimal(str(paid or 0)))),
        }

    def receipts(self, account_id: str, po_id: str) -> list[StockMovement]:
        return (
            self.db.query(StockMovement)
            .options(joinedload(StockMovement.inventory_item).joinedload(InventoryItem.product))
            .filter(
                StockMovement.account_id == account_id,
                StockMovement.purchase_order_id == po_id,
                StockMovement.reason == "receive",
            )
            .order_by(StockMovement.created_at.asc())
            .all()
        )

    def supply_items(self, account_id: str, q: str | None = None) -> list[InventoryItem]:
        """Inventory rows that can go on a purchase order (no menu items / services)."""
        from app.models import Catalogue

        query = (
            self.db.query(InventoryItem)
            .join(Catalogue, Catalogue.id == InventoryItem.product_id)
            .options(joinedload(InventoryItem.product))
            .filter(
                InventoryItem.account_id == account_id,
                ~func.lower(func.coalesce(Catalogue.product_type, "retail")).in_(NON_STOCK_TYPES),
            )
        )
        term = (q or "").strip()
        if term:
            query = query.filter(Catalogue.name.ilike(f"%{term}%"))
        return query.order_by(Catalogue.name.asc()).limit(500).all()

    # --- Writes ------------------------------------------------------------

    def _next_reference(self, account_id: str) -> str:
        refs = (
            self.db.query(PurchaseOrder.reference)
            .filter(PurchaseOrder.account_id == account_id)
            .all()
        )
        highest = 0
        for (ref,) in refs:
            match = _REF_RE.match(ref or "")
            if match:
                highest = max(highest, int(match.group(1)))
        return f"PO-{highest + 1:05d}"

    def _supplier(self, account_id: str, supplier_id: str | None) -> ShopSupplier | None:
        if not supplier_id:
            return None
        supplier = (
            self.db.query(ShopSupplier)
            .filter(ShopSupplier.id == supplier_id, ShopSupplier.account_id == account_id)
            .first()
        )
        if supplier is None:
            raise PurchaseOrderError("Supplier not found.")
        return supplier

    def _build_lines(self, account_id: str, lines: list[LineInput]) -> list[PurchaseOrderLine]:
        if not lines:
            raise PurchaseOrderError("Add at least one supply.")
        built: list[PurchaseOrderLine] = []
        for index, line in enumerate(lines):
            item = (
                self.db.query(InventoryItem)
                .options(joinedload(InventoryItem.product))
                .filter(
                    InventoryItem.id == line.inventory_item_id,
                    InventoryItem.account_id == account_id,
                )
                .first()
            )
            problem = supply_error(item)
            if problem:
                raise PurchaseOrderError(problem)
            quantity = _dec(line.quantity)
            if quantity <= 0:
                raise PurchaseOrderError(f"{item.product.name}: quantity must be more than zero.")
            unit_cost = _dec(line.unit_cost, MONEY)
            if unit_cost < 0:
                raise PurchaseOrderError(f"{item.product.name}: cost can't be negative.")
            units = buy_units_for_item(item)
            wanted = (line.purchase_unit or "").strip().lower()
            unit = next((u for u in units if u["name"].strip().lower() == wanted), None) if wanted else units[0]
            if unit is None:
                raise PurchaseOrderError(
                    f"{item.product.name}: unknown unit “{line.purchase_unit}”."
                )
            built.append(
                PurchaseOrderLine(
                    inventory_item_id=item.id,
                    item_name=item.product.name,
                    purchase_unit=unit["name"],
                    unit_factor=Decimal(str(unit["factor"])).quantize(Decimal("0.0001")),
                    quantity_ordered=quantity,
                    quantity_received=Decimal("0"),
                    unit_cost=unit_cost,
                    line_total=(quantity * unit_cost).quantize(MONEY),
                    sort_order=index,
                )
            )
        return built

    def _recalc(self, po: PurchaseOrder) -> None:
        subtotal = sum((Decimal(str(line.line_total or 0)) for line in po.lines), Decimal("0"))
        discount = Decimal(str(po.discount or 0))
        po.subtotal = subtotal.quantize(MONEY)
        po.total = max(subtotal - discount, Decimal("0")).quantize(MONEY)
        self._update_payment_status(po)

    @staticmethod
    def _update_payment_status(po: PurchaseOrder) -> None:
        paid = Decimal(str(po.amount_paid or 0))
        total = Decimal(str(po.total or 0))
        if paid <= 0:
            po.payment_status = UNPAID
        elif paid >= total:
            po.payment_status = PAID
        else:
            po.payment_status = PARTIAL

    @staticmethod
    def _received_anything(po: PurchaseOrder) -> bool:
        return any(Decimal(str(line.quantity_received or 0)) > 0 for line in po.lines)

    def create(
        self,
        account_id: str,
        *,
        user_id: str | None,
        supplier_id: str | None,
        lines: list[LineInput],
        status: str = DRAFT,
        order_date: date | None = None,
        expected_date: date | None = None,
        supplier_invoice_no: str | None = None,
        discount: Decimal | None = None,
        notes: str | None = None,
    ) -> PurchaseOrder:
        if status not in (DRAFT, ORDERED):
            raise PurchaseOrderError("New purchase orders start as draft or ordered.")
        supplier = self._supplier(account_id, supplier_id)
        now = _now()
        po = PurchaseOrder(
            account_id=account_id,
            supplier_id=supplier.id if supplier else None,
            supplier_name=supplier.name if supplier else None,
            reference=self._next_reference(account_id),
            supplier_invoice_no=(supplier_invoice_no or "").strip() or None,
            status=status,
            order_date=order_date or now.date(),
            expected_date=expected_date,
            discount=_dec(discount, MONEY),
            amount_paid=Decimal("0"),
            payment_status=UNPAID,
            notes=(notes or "").strip() or None,
            created_by=user_id,
            created_at=now,
            updated_at=now,
        )
        po.lines = self._build_lines(account_id, lines)
        self._recalc(po)
        self.db.add(po)
        self.db.flush()
        return po

    def update(
        self,
        account_id: str,
        po_id: str,
        *,
        supplier_id: str | None = None,
        lines: list[LineInput] | None = None,
        order_date: date | None = None,
        expected_date: date | None = None,
        supplier_invoice_no: str | None = None,
        discount: Decimal | None = None,
        notes: str | None = None,
        fields: set[str] | None = None,
    ) -> PurchaseOrder:
        po = self.get(account_id, po_id, lock=True)
        fields = fields or set()
        if po.status in (RECEIVED, CANCELLED):
            raise PurchaseOrderError(f"A {po.status} purchase order can't be edited.")
        if lines is not None:
            if self._received_anything(po):
                raise PurchaseOrderError("Supplies were already received; lines can't change.")
            po.lines.clear()
            self.db.flush()
            po.lines.extend(self._build_lines(account_id, lines))
        if "supplier_id" in fields:
            supplier = self._supplier(account_id, supplier_id)
            po.supplier_id = supplier.id if supplier else None
            po.supplier_name = supplier.name if supplier else None
        if "order_date" in fields:
            po.order_date = order_date
        if "expected_date" in fields:
            po.expected_date = expected_date
        if "supplier_invoice_no" in fields:
            po.supplier_invoice_no = (supplier_invoice_no or "").strip() or None
        if "discount" in fields:
            po.discount = _dec(discount, MONEY)
        if "notes" in fields:
            po.notes = (notes or "").strip() or None
        self._recalc(po)
        po.updated_at = _now()
        return po

    def mark_ordered(self, account_id: str, po_id: str) -> PurchaseOrder:
        po = self.get(account_id, po_id, lock=True)
        if po.status != DRAFT:
            raise PurchaseOrderError("Only a draft can be marked as ordered.")
        po.status = ORDERED
        po.updated_at = _now()
        return po

    def cancel(self, account_id: str, po_id: str, reason: str) -> PurchaseOrder:
        po = self.get(account_id, po_id, lock=True)
        if po.status in (RECEIVED, CANCELLED):
            raise PurchaseOrderError(f"A {po.status} purchase order can't be cancelled.")
        if self._received_anything(po):
            raise PurchaseOrderError(
                "Supplies were already received. Void those receipts first, or keep the order open."
            )
        po.status = CANCELLED
        po.cancelled_reason = (reason or "").strip()[:1000] or None
        po.updated_at = _now()
        return po

    def _refresh_status(self, po: PurchaseOrder) -> None:
        if po.status == CANCELLED:
            return
        received_any = False
        all_done = True
        for line in po.lines:
            received = Decimal(str(line.quantity_received or 0))
            if received > 0:
                received_any = True
            if received < Decimal(str(line.quantity_ordered or 0)):
                all_done = False
        if all_done and received_any:
            po.status = RECEIVED
            po.received_at = po.received_at or _now()
        elif received_any:
            po.status = PARTIALLY_RECEIVED
            po.received_at = None
        elif po.status in (PARTIALLY_RECEIVED, RECEIVED):
            po.status = ORDERED
            po.received_at = None

    def receive(
        self,
        account_id: str,
        po_id: str,
        receipts: list[ReceiveInput],
        *,
        user_id: str | None = None,
        note: str | None = None,
    ) -> tuple[PurchaseOrder, list[StockMovement]]:
        """Take delivered supplies into stock (partial deliveries allowed)."""
        po = self.get(account_id, po_id, lock=True)
        if po.status in (RECEIVED, CANCELLED):
            raise PurchaseOrderError(f"This purchase order is already {po.status}.")
        lines_by_id = {line.id: line for line in po.lines}
        wanted = [r for r in receipts if _dec(r.quantity) > 0]
        if not wanted:
            raise PurchaseOrderError("Enter how much of at least one supply arrived.")

        now = _now()
        movements: list[StockMovement] = []
        for receipt in wanted:
            line = lines_by_id.get(receipt.line_id)
            if line is None:
                raise PurchaseOrderError("That line isn't on this purchase order.")
            qty = _dec(receipt.quantity)
            if receipt.unit_cost is not None:
                cost = _dec(receipt.unit_cost, MONEY)
                if cost < 0:
                    raise PurchaseOrderError(f"{line.item_name}: cost can't be negative.")
                line.unit_cost = cost
            item = lock_item(self.db, line.inventory_item_id, account_id=account_id)
            if item is None:
                raise PurchaseOrderError(f"{line.item_name} is no longer in your inventory.")
            if item.stock_quantity is None:
                item.stock_quantity = Decimal("0")  # receiving a supply starts tracking it
            factor = Decimal(str(line.unit_factor or 1))
            base_qty = (qty * factor).quantize(QTY)
            base_cost = (Decimal(str(line.unit_cost or 0)) / factor).quantize(MONEY)
            movement = record_movement(
                self.db,
                item,
                account_id=account_id,
                direction="in",
                quantity=base_qty,
                reason="receive",
                unit_cost=base_cost,
                update_average_cost=True,
                note=note or f"{po.reference} · {po.supplier_name or 'No supplier'}",
                user_id=user_id,
                links={
                    "supplier_id": po.supplier_id,
                    "purchase_order_id": po.id,
                    "purchase_order_line_id": line.id,
                },
                now=now,
            )
            movements.append(movement)
            if po.supplier_id and not item.preferred_supplier_id:
                item.preferred_supplier_id = po.supplier_id
            line.quantity_received = (Decimal(str(line.quantity_received or 0)) + qty).quantize(QTY)
            billed = max(Decimal(str(line.quantity_ordered or 0)), line.quantity_received)
            line.line_total = (billed * Decimal(str(line.unit_cost or 0))).quantize(MONEY)

        self._recalc(po)
        self._refresh_status(po)
        po.updated_at = now
        return po, movements

    def record_payment(self, account_id: str, po_id: str, amount: Decimal) -> PurchaseOrder:
        po = self.get(account_id, po_id, lock=True)
        if po.status == CANCELLED:
            raise PurchaseOrderError("A cancelled purchase order can't take payments.")
        value = _dec(amount, MONEY)
        if value == 0:
            raise PurchaseOrderError("Enter an amount.")
        paid = Decimal(str(po.amount_paid or 0)) + value
        if paid < 0:
            raise PurchaseOrderError("Payments can't go below zero.")
        if paid > Decimal(str(po.total or 0)):
            raise PurchaseOrderError("That is more than the purchase order total.")
        po.amount_paid = paid
        self._update_payment_status(po)
        po.updated_at = _now()
        return po

    def void_receipt(
        self,
        account_id: str,
        movement_id: str,
        *,
        reason: str,
        user_id: str | None = None,
    ) -> PurchaseOrder:
        """Undo one delivery: take the stock back out and reopen the line."""
        movement = (
            self.db.query(StockMovement)
            .filter(
                StockMovement.id == movement_id,
                StockMovement.account_id == account_id,
            )
            .with_for_update()
            .first()
        )
        if movement is None or not movement.purchase_order_id or movement.reason != "receive":
            raise PurchaseOrderNotFound("Receipt not found.")
        if movement.voided_at is not None:
            raise PurchaseOrderError("This receipt is already voided.")
        po = self.get(account_id, movement.purchase_order_id, lock=True)
        line = next((ln for ln in po.lines if ln.id == movement.purchase_order_line_id), None)

        item = lock_item(self.db, movement.inventory_item_id, account_id=account_id)
        qty = Decimal(str(movement.quantity)).quantize(QTY)
        if item is not None and item.stock_quantity is not None:
            if qty > Decimal(str(item.stock_quantity)):
                raise InsufficientStockError(
                    item.product.name if item.product else line.item_name if line else "Item",
                    qty,
                    Decimal(str(item.stock_quantity)),
                )
            record_movement(
                self.db,
                item,
                account_id=account_id,
                direction="out",
                quantity=qty,
                reason="adjustment",
                unit_cost=Decimal(str(movement.unit_cost)) if movement.unit_cost is not None else None,
                note=f"Voided receipt {po.reference} · {reason.strip()}",
                user_id=user_id,
                links={
                    "supplier_id": movement.supplier_id,
                    "purchase_order_id": po.id,
                    "purchase_order_line_id": movement.purchase_order_line_id,
                },
            )
        now = _now()
        movement.voided_at = now
        movement.voided_by = user_id
        movement.void_reason = reason.strip()[:1000]
        if line is not None:
            factor = Decimal(str(line.unit_factor or 1))
            undone = (qty / factor).quantize(QTY)
            line.quantity_received = max(
                Decimal(str(line.quantity_received or 0)) - undone, Decimal("0"),
            )
            billed = max(Decimal(str(line.quantity_ordered or 0)), line.quantity_received)
            line.line_total = (billed * Decimal(str(line.unit_cost or 0))).quantize(MONEY)
        self._recalc(po)
        self._refresh_status(po)
        po.updated_at = now
        return po


# --- Serialisation -----------------------------------------------------------


def _iso(value) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def line_out(line: PurchaseOrderLine) -> dict[str, Any]:
    item = line.inventory_item
    product = item.product if item is not None else None
    return {
        "id": line.id,
        "inventory_item_id": line.inventory_item_id,
        "item_name": line.item_name,
        "base_unit": (product.unit if product is not None else None) or "Piece",
        "purchase_unit": line.purchase_unit,
        "unit_factor": float(line.unit_factor or 1),
        "quantity_ordered": float(line.quantity_ordered or 0),
        "quantity_received": float(line.quantity_received or 0),
        "quantity_outstanding": float(
            max(
                Decimal(str(line.quantity_ordered or 0)) - Decimal(str(line.quantity_received or 0)),
                Decimal("0"),
            )
        ),
        "unit_cost": float(line.unit_cost or 0),
        "line_total": float(line.line_total or 0),
        "stock_quantity": (
            float(item.stock_quantity) if item is not None and item.stock_quantity is not None else None
        ),
    }


def purchase_order_out(po: PurchaseOrder, *, receipts: list[StockMovement] | None = None) -> dict[str, Any]:
    total = Decimal(str(po.total or 0))
    paid = Decimal(str(po.amount_paid or 0))
    out: dict[str, Any] = {
        "id": po.id,
        "reference": po.reference,
        "supplier_id": po.supplier_id,
        "supplier_name": po.supplier.name if po.supplier is not None else po.supplier_name,
        "supplier_phone": po.supplier.phone if po.supplier is not None else None,
        "supplier_invoice_no": po.supplier_invoice_no,
        "status": po.status,
        "order_date": _iso(po.order_date),
        "expected_date": _iso(po.expected_date),
        "received_at": _iso(po.received_at),
        "subtotal": float(po.subtotal or 0),
        "discount": float(po.discount or 0),
        "total": float(total),
        "amount_paid": float(paid),
        "balance": float(max(total - paid, Decimal("0"))),
        "payment_status": po.payment_status,
        "notes": po.notes,
        "cancelled_reason": po.cancelled_reason,
        "created_at": _iso(po.created_at),
        "updated_at": _iso(po.updated_at),
        "lines": [line_out(line) for line in po.lines],
    }
    if receipts is not None:
        out["receipts"] = [
            {
                "id": m.id,
                "line_id": m.purchase_order_line_id,
                "item_name": (
                    m.inventory_item.product.name
                    if m.inventory_item is not None and m.inventory_item.product is not None
                    else None
                ),
                "quantity": float(m.quantity),
                "unit_cost": float(m.unit_cost) if m.unit_cost is not None else None,
                "total_cost": float(m.total_cost) if m.total_cost is not None else None,
                "created_at": _iso(m.created_at),
                "voided_at": _iso(m.voided_at),
                "void_reason": m.void_reason,
            }
            for m in receipts
        ]
    return out


def supply_item_out(item: InventoryItem) -> dict[str, Any]:
    product = item.product
    return {
        "id": item.id,
        "name": product.name if product is not None else "Item",
        "base_unit": (product.unit if product is not None else None) or "Piece",
        "inventory_role": item.normalized_role(),
        "stock_quantity": float(item.stock_quantity) if item.stock_quantity is not None else None,
        "kitchen_quantity": float(item.kitchen_quantity) if item.kitchen_quantity is not None else None,
        "low_stock_threshold": (
            float(item.low_stock_threshold) if item.low_stock_threshold is not None else None
        ),
        "is_low_stock": item.is_low_stock(),
        "average_cost": float(item.buying_price) if item.buying_price is not None else None,
        "preferred_supplier_id": item.preferred_supplier_id,
        "buy_units": buy_units_for_item(item),
    }
