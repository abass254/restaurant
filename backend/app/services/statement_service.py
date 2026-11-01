"""Statements of Account & Cash Flow for Shop Customers and Shop Suppliers.

Provides:
- Chronological ledger entries (Opening Balance, Sales/Purchases, Payments, Returns)
  with Debit (Billed/Purchased), Credit (Paid/Collected), Cash Flow, and Running Balance.
- Cash flow summary cards (Total Billed/Purchased, Cash & M-PESA Paid, Pending Cheques,
  Net Cash Flow, Opening & Closing Balance).
- Account-wide statements overview across all customers and suppliers for Reports.
- CSV export generation for sharing statements with customers or suppliers.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    InventoryItem,
    MpesaTransaction,
    Order,
    OrderReturn,
    PurchaseOrder,
    PurchaseOrderLine,
    ShopCustomer,
    ShopSupplier,
    ShopSupplierPayment,
    StockMovement,
)
from app.services.customer_service import CustomerService, available_credit
from app.services.reports_service import DEFAULT_TZ_OFFSET_MINUTES, day_bounds
from app.services.supplier_service import SupplierService
from app.support.datetime_utils import as_utc, utc_now
from app.support.order_payments import payment_portion
from app.support.order_status import CANCELLED, PAYMENT_CREDIT, PAYMENT_SPLIT, REFUNDED

MONEY = Decimal("0.01")


def _dec(val: object | None) -> Decimal:
    if val is None or val == "":
        return Decimal("0.00")
    try:
        return Decimal(str(val)).quantize(MONEY)
    except Exception:
        return Decimal("0.00")


def _flt(val: object | None) -> float:
    return float(_dec(val))


def _iso(dt: datetime | date | None) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        aware = as_utc(dt)
        return aware.isoformat() if aware else None
    return dt.isoformat()


def _naive_utc(dt: datetime | None) -> datetime:
    if dt is None:
        return datetime(1970, 1, 1)
    if dt.tzinfo is not None:
        return as_utc(dt).replace(tzinfo=None)  # type: ignore[union-attr]
    return dt


def _parse_stock_movement_note(note: str | None) -> dict[str, str | None]:
    """Extract supplier, reference, status, pay_term, date from StockMovement.note."""
    result: dict[str, str | None] = {
        "supplier": None,
        "reference": None,
        "status": None,
        "pay_term": None,
        "date_str": None,
        "extra": None,
    }
    raw = (note or "").strip()
    if not raw:
        return result
    parts = [p.strip() for p in raw.split(" · ") if p.strip()]
    extras: list[str] = []
    for idx, part in enumerate(parts):
        if idx == 0 and not re.match(r"^(Ref|Status|Date|Pay|Loc|Doc)\b", part, re.I):
            result["supplier"] = part
        elif part.lower().startswith("ref "):
            result["reference"] = part[4:].strip()
        elif part.lower().startswith("status "):
            result["status"] = part[7:].strip().lower()
        elif part.lower().startswith("pay "):
            result["pay_term"] = part[4:].strip()
        elif part.lower().startswith("date "):
            result["date_str"] = part[5:].strip()
        elif part.lower().startswith(("loc ", "doc ")):
            continue
        else:
            extras.append(part)
    if extras:
        result["extra"] = ", ".join(extras)
    return result


def build_customer_statement(
    db: Session,
    account_id: str,
    customer_id: str,
    *,
    start: date | None = None,
    end: date | None = None,
    tz_offset_minutes: int = DEFAULT_TZ_OFFSET_MINUTES,
) -> dict[str, Any]:
    """Build a full chronological Statement of Account and Cash Flow for a customer."""
    customer = CustomerService(db).get_customer(account_id, customer_id)

    begin_dt: datetime | None = None
    finish_dt: datetime | None = None
    if start and end:
        s_date, e_date = (start, end) if start <= end else (end, start)
        begin_dt, finish_dt = day_bounds(s_date, e_date, tz_offset_minutes)
    elif start:
        begin_dt, _ = day_bounds(start, start, tz_offset_minutes)
    elif end:
        _, finish_dt = day_bounds(end, end, tz_offset_minutes)

    clean_name = (customer.name or "").strip().lower()
    if customer.phone:
        customer_match = or_(
            Order.customer_phone == customer.phone,
            and_(
                or_(Order.customer_phone.is_(None), Order.customer_phone == ""),
                func.lower(Order.customer_name) == clean_name,
            ),
        )
    else:
        customer_match = func.lower(Order.customer_name) == clean_name

    orders = (
        db.query(Order)
        .options(
            selectinload(Order.items),
            selectinload(Order.returns).selectinload(OrderReturn.items),
        )
        .filter(
            Order.account_id == account_id,
            Order.status != CANCELLED,
            customer_match,
        )
        .order_by(Order.created_at.asc(), Order.id.asc())
        .all()
    )

    payments = (
        db.query(MpesaTransaction)
        .filter(
            MpesaTransaction.account_id == account_id,
            MpesaTransaction.shop_customer_id == customer.id,
            MpesaTransaction.credit_collected_at.isnot(None),
        )
        .order_by(MpesaTransaction.credit_collected_at.asc(), MpesaTransaction.id.asc())
        .all()
    )

    raw_events: list[dict[str, Any]] = []

    for order in orders:
        when = _naive_utc(order.placed_at or order.created_at)
        total = _dec(order.total)
        pm = (order.payment_method or "cash").strip().lower()

        if pm == PAYMENT_CREDIT:
            credit_part = total
            paid_part = Decimal("0.00")
            cash_part = Decimal("0.00")
            mpesa_part = Decimal("0.00")
        elif pm == PAYMENT_SPLIT:
            credit_part = _dec(payment_portion(order, PAYMENT_CREDIT))
            cash_part = _dec(payment_portion(order, "cash"))
            mpesa_part = _dec(payment_portion(order, "mpesa"))
            paid_part = max(Decimal("0.00"), total - credit_part)
            if cash_part + mpesa_part == 0 and paid_part > 0:
                cash_part = paid_part
        else:
            credit_part = Decimal("0.00")
            paid_part = total
            mpesa_part = total if pm == "mpesa" else Decimal("0.00")
            cash_part = total - mpesa_part

        items_list = [
            {
                "id": item.id,
                "name": item.product_name,
                "quantity": float(item.quantity or 0),
                "unit": item.sell_unit,
                "unit_price": _flt(item.unit_price),
                "line_total": _flt(item.line_total),
            }
            for item in (order.items or [])
        ]
        item_summary = ", ".join(
            f"{int(i['quantity']) if float(i['quantity']).is_integer() else i['quantity']}× {i['name']}"
            for i in items_list[:3]
        )
        if len(items_list) > 3:
            item_summary += f" (+{len(items_list) - 3} more)"

        if pm == PAYMENT_CREDIT:
            desc = f"Credit sale · {item_summary}" if item_summary else "Credit sale"
            state = "unpaid"
        elif pm == PAYMENT_SPLIT:
            desc = f"Split sale · {item_summary}" if item_summary else "Split sale"
            state = "partial" if credit_part > 0 else "paid"
        else:
            method_label = "M-PESA" if pm == "mpesa" else "Cash"
            desc = f"{method_label} sale · {item_summary}" if item_summary else f"{method_label} sale"
            state = "paid"

        raw_events.append(
            {
                "id": f"sale-{order.id}",
                "when": when,
                "date": _iso(order.placed_at or order.created_at),
                "type": "sale",
                "reference": order.order_number,
                "description": desc,
                "payment_method": pm,
                "status": state,
                "debit": total,
                "credit": paid_part,
                "balance_delta": credit_part,
                "cash_in": paid_part,
                "cash_out": Decimal("0.00"),
                "paid_cash": cash_part,
                "paid_mpesa": mpesa_part,
                "tab_collected": Decimal("0.00"),
                "credit_billed": credit_part,
                "returns_amount": Decimal("0.00"),
                "items": items_list,
                "maturity_date": None,
                "is_pending_cheque": False,
            }
        )

        # Include any goods-on-return recorded against this order
        for ret in order.returns or []:
            if order.status == REFUNDED and not (order.returns or []):
                continue
            ret_when = _naive_utc(ret.created_at or when)
            refund_amt = _dec(ret.total_refunded)
            if refund_amt <= 0:
                continue
            ref_method = (ret.refund_payment_method or "cash").strip().lower()
            is_credit_return = ref_method == "credit" or (
                pm == PAYMENT_CREDIT and ref_method not in ("cash", "mpesa")
            )
            ret_items = [
                {
                    "id": ri.id,
                    "name": ri.product_name,
                    "quantity": float(ri.quantity or 0),
                    "unit": None,
                    "unit_price": _flt(ri.unit_price),
                    "line_total": _flt(ri.refund_amount),
                }
                for ri in (ret.items or [])
            ]
            raw_events.append(
                {
                    "id": f"return-{ret.id}",
                    "when": ret_when,
                    "date": _iso(ret.created_at or when),
                    "type": "return",
                    "reference": ret.return_number or f"RET-{order.order_number}",
                    "description": f"Goods returned ({ret.reason})" if ret.reason else "Goods returned",
                    "payment_method": ref_method,
                    "status": "completed",
                    "debit": Decimal("0.00"),
                    "credit": refund_amt if is_credit_return else Decimal("0.00"),
                    "balance_delta": -refund_amt if is_credit_return else Decimal("0.00"),
                    "cash_in": Decimal("0.00"),
                    "cash_out": Decimal("0.00") if is_credit_return else refund_amt,
                    "paid_cash": Decimal("0.00"),
                    "paid_mpesa": Decimal("0.00"),
                    "tab_collected": Decimal("0.00"),
                    "credit_billed": Decimal("0.00"),
                    "returns_amount": refund_amt,
                    "items": ret_items,
                    "maturity_date": None,
                    "is_pending_cheque": False,
                }
            )

    for txn in payments:
        payload = txn.callback_payload if isinstance(txn.callback_payload, dict) else {}
        amt = _dec(payload.get("payment_amount") or txn.credit_collect_amount or txn.amount)
        if amt <= 0:
            continue
        when = _naive_utc(txn.credit_collected_at or txn.completed_at or txn.created_at)
        is_manual = bool(payload.get("manual_credit_collection"))
        receipt = (txn.mpesa_receipt_number or "").strip() or None
        method = "mpesa" if (receipt or not is_manual) else "cash"
        desc = (
            f"Tab payment received · M-PESA ({receipt})"
            if receipt
            else ("Manual tab payment recorded" if is_manual else "Tab payment received · M-PESA")
        )
        raw_events.append(
            {
                "id": f"pay-{txn.id}",
                "when": when,
                "date": _iso(txn.credit_collected_at or txn.completed_at or txn.created_at),
                "type": "payment",
                "reference": receipt or f"TAB-{txn.id[:8].upper()}",
                "description": desc,
                "payment_method": method,
                "status": "paid",
                "debit": Decimal("0.00"),
                "credit": amt,
                "balance_delta": -amt,
                "cash_in": amt,
                "cash_out": Decimal("0.00"),
                "paid_cash": amt if method == "cash" else Decimal("0.00"),
                "paid_mpesa": amt if method == "mpesa" else Decimal("0.00"),
                "tab_collected": amt,
                "credit_billed": Decimal("0.00"),
                "returns_amount": Decimal("0.00"),
                "items": [],
                "maturity_date": None,
                "is_pending_cheque": False,
            }
        )

    raw_events.sort(key=lambda e: (e["when"], 0 if e["type"] == "sale" else 1, e["id"]))

    current_outstanding = _dec(customer.outstanding_balance)
    total_all_time_delta = sum((e["balance_delta"] for e in raw_events), Decimal("0.00"))
    initial_opening_balance = max(Decimal("0.00"), current_outstanding - total_all_time_delta)

    # Split events into before-range, in-range, after-range
    pre_delta = sum(
        (e["balance_delta"] for e in raw_events if begin_dt is not None and e["when"] < begin_dt),
        Decimal("0.00"),
    )
    opening_balance = initial_opening_balance + pre_delta

    in_range_events = [
        e
        for e in raw_events
        if (begin_dt is None or e["when"] >= begin_dt)
        and (finish_dt is None or e["when"] < finish_dt)
    ]

    entries: list[dict[str, Any]] = []
    running = opening_balance

    if opening_balance != 0 or begin_dt is not None:
        opening_dt = (
            begin_dt
            if begin_dt is not None
            else (
                raw_events[0]["when"]
                if raw_events
                else _naive_utc(customer.created_at or utc_now())
            )
        )
        entries.append(
            {
                "id": "opening-balance",
                "date": _iso(opening_dt),
                "type": "opening_balance",
                "reference": "OPENING",
                "description": (
                    f"Balance brought forward (as of {start.isoformat()})"
                    if start
                    else "Opening / carried-over balance"
                ),
                "payment_method": None,
                "status": "unpaid" if opening_balance > 0 else "paid",
                "debit": _flt(max(opening_balance, Decimal("0.00"))),
                "credit": _flt(max(-opening_balance, Decimal("0.00"))),
                "cash_flow": 0.0,
                "running_balance": _flt(running),
                "items": [],
                "maturity_date": None,
                "is_pending_cheque": False,
            }
        )

    total_billed = Decimal("0.00")
    total_paid = Decimal("0.00")
    cash_inflow = Decimal("0.00")
    cash_outflow = Decimal("0.00")
    paid_cash = Decimal("0.00")
    paid_mpesa = Decimal("0.00")
    tab_collected = Decimal("0.00")
    credit_billed = Decimal("0.00")
    returns_total = Decimal("0.00")

    for ev in in_range_events:
        running += ev["balance_delta"]
        total_billed += ev["debit"]
        total_paid += ev["credit"]
        cash_inflow += ev["cash_in"]
        cash_outflow += ev["cash_out"]
        paid_cash += ev["paid_cash"]
        paid_mpesa += ev["paid_mpesa"]
        tab_collected += ev["tab_collected"]
        credit_billed += ev["credit_billed"]
        returns_total += ev["returns_amount"]

        net_cf = ev["cash_in"] - ev["cash_out"]
        entries.append(
            {
                "id": ev["id"],
                "date": ev["date"],
                "type": ev["type"],
                "reference": ev["reference"],
                "description": ev["description"],
                "payment_method": ev["payment_method"],
                "status": ev["status"],
                "debit": _flt(ev["debit"]),
                "credit": _flt(ev["credit"]),
                "cash_flow": _flt(net_cf),
                "running_balance": _flt(running),
                "items": ev["items"],
                "maturity_date": None,
                "is_pending_cheque": False,
            }
        )

    limit = _dec(customer.credit_limit)
    avail = available_credit(limit, current_outstanding)

    return {
        "party_type": "customer",
        "party": {
            "id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "email": customer.email,
            "address": customer.physical_location or customer.address,
            "city": customer.city,
            "pin_number": None,
            "credit_limit": _flt(limit),
            "current_balance": _flt(current_outstanding),
            "available_credit": _flt(avail),
            "due_date": customer.date_to_pay.isoformat() if customer.date_to_pay else None,
        },
        "period": {
            "start": start.isoformat() if start else None,
            "end": end.isoformat() if end else None,
        },
        "summary": {
            "opening_balance": _flt(opening_balance),
            "total_billed": _flt(total_billed),
            "total_paid": _flt(total_paid),
            "cash_inflow": _flt(cash_inflow),
            "cash_outflow": _flt(cash_outflow),
            "net_cash_flow": _flt(cash_inflow - cash_outflow),
            "paid_cash": _flt(paid_cash),
            "paid_mpesa": _flt(paid_mpesa),
            "paid_cheque": 0.0,
            "pending_cheques": 0.0,
            "pending_cheques_count": 0,
            "tab_collected": _flt(tab_collected),
            "credit_Extended": _flt(credit_billed),
            "credit_extended": _flt(credit_billed),
            "returns_total": _flt(returns_total),
            "closing_balance": _flt(running),
            "current_balance": _flt(current_outstanding),
            "credit_limit": _flt(limit),
            "available_credit": _flt(avail),
            "transaction_count": len(in_range_events),
        },
        "entries": entries,
    }


def build_supplier_statement(
    db: Session,
    account_id: str,
    supplier_id: str,
    *,
    start: date | None = None,
    end: date | None = None,
    tz_offset_minutes: int = DEFAULT_TZ_OFFSET_MINUTES,
) -> dict[str, Any]:
    """Build a full chronological Statement of Account and Cash Flow for a supplier."""
    supplier = SupplierService(db).get_supplier(account_id, supplier_id)

    begin_dt: datetime | None = None
    finish_dt: datetime | None = None
    if start and end:
        s_date, e_date = (start, end) if start <= end else (end, start)
        begin_dt, finish_dt = day_bounds(s_date, e_date, tz_offset_minutes)
    elif start:
        begin_dt, _ = day_bounds(start, start, tz_offset_minutes)
    elif end:
        _, finish_dt = day_bounds(end, end, tz_offset_minutes)

    clean_name = (supplier.name or "").strip().lower()
    today = (utc_now() + timedelta(minutes=tz_offset_minutes)).date()

    # 1. Purchase Orders linked to supplier
    pos = (
        db.query(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines))
        .filter(
            PurchaseOrder.account_id == account_id,
            PurchaseOrder.status != "cancelled",
            or_(
                PurchaseOrder.supplier_id == supplier.id,
                and_(
                    PurchaseOrder.supplier_id.is_(None),
                    func.lower(PurchaseOrder.supplier_name) == clean_name,
                ),
            ),
        )
        .order_by(PurchaseOrder.created_at.asc(), PurchaseOrder.id.asc())
        .all()
    )

    # 2. Direct Stock Movements (receive) not tied to a PurchaseOrder
    movements = (
        db.query(StockMovement)
        .options(joinedload(StockMovement.inventory_item).joinedload(InventoryItem.product))
        .filter(
            StockMovement.account_id == account_id,
            StockMovement.direction == "in",
            StockMovement.reason == "receive",
            StockMovement.voided_at.is_(None),
            StockMovement.purchase_order_id.is_(None),
            or_(
                StockMovement.supplier_id == supplier.id,
                StockMovement.note.ilike(f"{supplier.name.strip()}%"),
            ),
        )
        .order_by(StockMovement.created_at.asc(), StockMovement.id.asc())
        .all()
    )

    # Filter movements to exact supplier name match when matched via note
    matched_movements: list[StockMovement] = []
    for m in movements:
        if m.supplier_id == supplier.id:
            matched_movements.append(m)
            continue
        parsed = _parse_stock_movement_note(m.note)
        if (parsed["supplier"] or "").strip().lower() == clean_name:
            matched_movements.append(m)

    # Group direct StockMovements into purchase bills by (minute bucket, reference, pay_term)
    grouped_batches: list[dict[str, Any]] = []
    batch_lookup: dict[tuple[str, str, str], dict[str, Any]] = {}
    for m in matched_movements:
        when = _naive_utc(m.created_at)
        parsed = _parse_stock_movement_note(m.note)
        minute_key = when.strftime("%Y-%m-%d %H:%M")
        ref_key = (parsed["reference"] or "").upper()
        pay_key = (parsed["pay_term"] or "").lower()
        key = (minute_key, ref_key, pay_key)

        unit_cost = (
            _dec(m.unit_cost)
            if m.unit_cost is not None
            else _dec(m.inventory_item.buying_price if m.inventory_item else 0)
        )
        qty = Decimal(str(m.quantity or 0))
        line_total = (unit_cost * qty).quantize(MONEY)
        prod_name = (
            m.inventory_item.product.name
            if m.inventory_item and m.inventory_item.product
            else "Supply item"
        )
        unit_label = (
            (m.inventory_item.product.unit if m.inventory_item and m.inventory_item.product else None)
            or parsed["extra"]
            or "unit"
        )

        if key not in batch_lookup:
            batch = {
                "id": m.id,
                "when": when,
                "date": _iso(m.created_at),
                "reference": parsed["reference"] or f"PUR-{m.id[:8].upper()}",
                "pay_term": parsed["pay_term"],
                "status_note": parsed["status"] or "received",
                "total": Decimal("0.00"),
                "items": [],
            }
            batch_lookup[key] = batch
            grouped_batches.append(batch)

        batch = batch_lookup[key]
        batch["total"] += line_total
        batch["items"].append(
            {
                "id": m.id,
                "name": prod_name,
                "quantity": float(qty),
                "unit": unit_label,
                "unit_price": _flt(unit_cost),
                "line_total": _flt(line_total),
            }
        )

    # 3. Recorded Supplier Payments (ShopSupplierPayment)
    payments = (
        db.query(ShopSupplierPayment)
        .filter(
            ShopSupplierPayment.account_id == account_id,
            ShopSupplierPayment.supplier_id == supplier.id,
        )
        .order_by(ShopSupplierPayment.paid_at.asc(), ShopSupplierPayment.created_at.asc())
        .all()
    )

    current_balance = _dec(supplier.balance)
    total_recorded_payments = sum((_dec(p.amount) for p in payments), Decimal("0.00"))
    # Total credit obligation before ShopSupplierPayments were applied:
    credit_obligation_pool = max(Decimal("0.00"), current_balance + total_recorded_payments)

    # Attribute unpaid credit obligation to PurchaseOrders (total - amount_paid) and
    # credit StockMovement batches (those with pay_term or pending status) newest first,
    # and if credit_obligation_pool still remains, attribute to remaining batches or opening balance.
    po_unpaid_map: dict[str, Decimal] = {}
    batch_unpaid_map: dict[str, Decimal] = {}

    remaining_pool = credit_obligation_pool
    for po in reversed(pos):
        po_total = _dec(po.total)
        po_paid = _dec(po.amount_paid)
        po_unpaid = max(Decimal("0.00"), po_total - po_paid)
        attributed = min(po_unpaid, remaining_pool) if remaining_pool > 0 else Decimal("0.00")
        po_unpaid_map[po.id] = attributed
        remaining_pool -= attributed

    # Credit purchase batches (explicit pay_term first)
    for batch in reversed(grouped_batches):
        if batch["pay_term"] or batch["status_note"] in ("pending", "ordered"):
            b_total = batch["total"]
            attributed = min(b_total, remaining_pool) if remaining_pool > 0 else Decimal("0.00")
            batch_unpaid_map[batch["id"]] = attributed
            remaining_pool -= attributed

    initial_opening_balance = (
        remaining_pool
        if current_balance >= 0
        else (current_balance + total_recorded_payments)
    )

    raw_events: list[dict[str, Any]] = []

    for po in pos:
        when = _naive_utc(po.received_at or po.created_at)
        po_total = _dec(po.total)
        credit_unpaid = po_unpaid_map.get(po.id, Decimal("0.00"))
        paid_immediately = max(Decimal("0.00"), po_total - credit_unpaid)
        items_list = [
            {
                "id": ln.id,
                "name": ln.item_name,
                "quantity": float(ln.quantity_ordered or 0),
                "unit": ln.purchase_unit,
                "unit_price": _flt(ln.unit_cost),
                "line_total": _flt(ln.line_total),
            }
            for ln in (po.lines or [])
        ]
        item_summary = ", ".join(
            f"{int(i['quantity']) if float(i['quantity']).is_integer() else i['quantity']}× {i['name']}"
            for i in items_list[:3]
        )
        if len(items_list) > 3:
            item_summary += f" (+{len(items_list) - 3} more)"
        ref_str = (
            f"{po.reference} ({po.supplier_invoice_no})"
            if po.supplier_invoice_no
            else po.reference
        )
        raw_events.append(
            {
                "id": f"po-{po.id}",
                "when": when,
                "date": _iso(po.received_at or po.created_at),
                "type": "purchase",
                "reference": ref_str,
                "description": f"Purchase Order · {item_summary}" if item_summary else "Purchase Order",
                "payment_method": "credit" if credit_unpaid > 0 else "cash",
                "status": "unpaid" if credit_unpaid == po_total and po_total > 0 else ("partial" if credit_unpaid > 0 else "paid"),
                "debit": po_total,
                "credit": paid_immediately,
                "balance_delta": credit_unpaid,
                "cash_in": Decimal("0.00"),
                "cash_out": paid_immediately,
                "paid_cash": paid_immediately,
                "paid_mpesa": Decimal("0.00"),
                "paid_cheque": Decimal("0.00"),
                "pending_cheque": Decimal("0.00"),
                "credit_purchased": credit_unpaid,
                "items": items_list,
                "maturity_date": None,
                "is_pending_cheque": False,
            }
        )

    for batch in grouped_batches:
        when = batch["when"]
        b_total = batch["total"]
        credit_unpaid = batch_unpaid_map.get(batch["id"], Decimal("0.00"))
        paid_immediately = max(Decimal("0.00"), b_total - credit_unpaid)
        items_list = batch["items"]
        item_summary = ", ".join(
            f"{int(i['quantity']) if float(i['quantity']).is_integer() else i['quantity']}× {i['name']}"
            for i in items_list[:3]
        )
        if len(items_list) > 3:
            item_summary += f" (+{len(items_list) - 3} more)"
        term_suffix = f" · Terms: {batch['pay_term']}" if batch["pay_term"] else ""
        raw_events.append(
            {
                "id": f"pur-{batch['id']}",
                "when": when,
                "date": batch["date"],
                "type": "purchase",
                "reference": batch["reference"],
                "description": f"Stock purchase · {item_summary}{term_suffix}" if item_summary else f"Stock purchase{term_suffix}",
                "payment_method": "credit" if credit_unpaid > 0 else "cash",
                "status": "unpaid" if credit_unpaid == b_total and b_total > 0 else ("partial" if credit_unpaid > 0 else "paid"),
                "debit": b_total,
                "credit": paid_immediately,
                "balance_delta": credit_unpaid,
                "cash_in": Decimal("0.00"),
                "cash_out": paid_immediately,
                "paid_cash": paid_immediately,
                "paid_mpesa": Decimal("0.00"),
                "paid_cheque": Decimal("0.00"),
                "pending_cheque": Decimal("0.00"),
                "credit_purchased": credit_unpaid,
                "items": items_list,
                "maturity_date": None,
                "is_pending_cheque": False,
            }
        )

    for pay in payments:
        when = _naive_utc(pay.paid_at or pay.created_at)
        amt = _dec(pay.amount)
        if amt <= 0:
            continue
        method = (pay.payment_method or "mpesa").strip().lower()
        maturity = pay.cheque_maturity_date
        is_pending_cheque = bool(method == "cheque" and maturity and maturity > today)
        method_label = (
            "Cheque" if method == "cheque" else ("Cash" if method == "cash" else "M-PESA")
        )
        desc_parts = [f"Payment sent · {method_label}"]
        if pay.reference:
            desc_parts.append(f"Ref {pay.reference}")
        if maturity:
            desc_parts.append(
                f"{'Matures' if is_pending_cheque else 'Matured'} {maturity.isoformat()}"
            )
        if pay.notes:
            desc_parts.append(pay.notes)

        raw_events.append(
            {
                "id": f"spay-{pay.id}",
                "when": when,
                "date": _iso(pay.paid_at or pay.created_at),
                "type": "payment",
                "reference": pay.reference or f"PAY-{pay.id[:8].upper()}",
                "description": " · ".join(desc_parts),
                "payment_method": method,
                "status": "pending" if is_pending_cheque else "paid",
                "debit": Decimal("0.00"),
                "credit": amt,
                "balance_delta": -amt,
                "cash_in": Decimal("0.00"),
                "cash_out": amt,
                "paid_cash": amt if method == "cash" else Decimal("0.00"),
                "paid_mpesa": amt if method == "mpesa" else Decimal("0.00"),
                "paid_cheque": amt if method == "cheque" else Decimal("0.00"),
                "pending_cheque": amt if is_pending_cheque else Decimal("0.00"),
                "credit_purchased": Decimal("0.00"),
                "items": [],
                "maturity_date": maturity.isoformat() if maturity else None,
                "is_pending_cheque": is_pending_cheque,
            }
        )

    raw_events.sort(key=lambda e: (e["when"], 0 if e["type"] == "purchase" else 1, e["id"]))

    pre_delta = sum(
        (e["balance_delta"] for e in raw_events if begin_dt is not None and e["when"] < begin_dt),
        Decimal("0.00"),
    )
    opening_balance = initial_opening_balance + pre_delta

    in_range_events = [
        e
        for e in raw_events
        if (begin_dt is None or e["when"] >= begin_dt)
        and (finish_dt is None or e["when"] < finish_dt)
    ]

    entries: list[dict[str, Any]] = []
    running = opening_balance

    if opening_balance != 0 or begin_dt is not None:
        opening_dt = (
            begin_dt
            if begin_dt is not None
            else (
                raw_events[0]["when"]
                if raw_events
                else _naive_utc(supplier.created_at or utc_now())
            )
        )
        entries.append(
            {
                "id": "opening-balance",
                "date": _iso(opening_dt),
                "type": "opening_balance",
                "reference": "OPENING",
                "description": (
                    f"Balance brought forward (as of {start.isoformat()})"
                    if start
                    else "Opening / carried-over balance"
                ),
                "payment_method": None,
                "status": "unpaid" if opening_balance > 0 else "paid",
                "debit": _flt(max(opening_balance, Decimal("0.00"))),
                "credit": _flt(max(-opening_balance, Decimal("0.00"))),
                "cash_flow": 0.0,
                "running_balance": _flt(running),
                "items": [],
                "maturity_date": None,
                "is_pending_cheque": False,
            }
        )

    total_billed = Decimal("0.00")
    total_paid = Decimal("0.00")
    cash_outflow = Decimal("0.00")
    paid_cash = Decimal("0.00")
    paid_mpesa = Decimal("0.00")
    paid_cheque = Decimal("0.00")
    pending_cheques = Decimal("0.00")
    pending_cheques_count = 0
    credit_extended = Decimal("0.00")

    for ev in in_range_events:
        running += ev["balance_delta"]
        total_billed += ev["debit"]
        total_paid += ev["credit"]
        cash_outflow += ev["cash_out"]
        paid_cash += ev["paid_cash"]
        paid_mpesa += ev["paid_mpesa"]
        paid_cheque += ev["paid_cheque"]
        if ev["is_pending_cheque"]:
            pending_cheques += ev["pending_cheque"]
            pending_cheques_count += 1
        credit_extended += ev["credit_purchased"]

        entries.append(
            {
                "id": ev["id"],
                "date": ev["date"],
                "type": ev["type"],
                "reference": ev["reference"],
                "description": ev["description"],
                "payment_method": ev["payment_method"],
                "status": ev["status"],
                "debit": _flt(ev["debit"]),
                "credit": _flt(ev["credit"]),
                "cash_flow": _flt(-ev["cash_out"]),
                "running_balance": _flt(running),
                "items": ev["items"],
                "maturity_date": ev["maturity_date"],
                "is_pending_cheque": ev["is_pending_cheque"],
            }
        )

    limit = _dec(supplier.credit_limit)
    avail = max(Decimal("0.00"), limit - max(Decimal("0.00"), current_balance)) if limit > 0 else Decimal("0.00")

    return {
        "party_type": "supplier",
        "party": {
            "id": supplier.id,
            "name": supplier.name,
            "phone": supplier.phone,
            "email": supplier.email,
            "address": supplier.address,
            "city": supplier.city,
            "pin_number": supplier.pin_number,
            "credit_limit": _flt(limit),
            "current_balance": _flt(current_balance),
            "available_credit": _flt(avail),
            "due_date": supplier.balance_due_date.isoformat() if supplier.balance_due_date else None,
        },
        "period": {
            "start": start.isoformat() if start else None,
            "end": end.isoformat() if end else None,
        },
        "summary": {
            "opening_balance": _flt(opening_balance),
            "total_billed": _flt(total_billed),
            "total_paid": _flt(total_paid),
            "cash_inflow": 0.0,
            "cash_outflow": _flt(cash_outflow),
            "net_cash_flow": _flt(-cash_outflow),
            "paid_cash": _flt(paid_cash),
            "paid_mpesa": _flt(paid_mpesa),
            "paid_cheque": _flt(paid_cheque),
            "pending_cheques": _flt(pending_cheques),
            "pending_cheques_count": pending_cheques_count,
            "tab_collected": _flt(total_recorded_payments),
            "credit_extended": _flt(credit_extended),
            "returns_total": 0.0,
            "closing_balance": _flt(running),
            "current_balance": _flt(current_balance),
            "credit_limit": _flt(limit),
            "available_credit": _flt(avail),
            "transaction_count": len(in_range_events),
        },
        "entries": entries,
    }


def build_statements_overview(
    db: Session,
    account_id: str,
    *,
    start: date | None = None,
    end: date | None = None,
    tz_offset_minutes: int = DEFAULT_TZ_OFFSET_MINUTES,
) -> dict[str, Any]:
    """Build an account-wide Statement of Accounting & Cash Flow summary for all customers and suppliers."""
    customers = CustomerService(db).list_customers(account_id)
    suppliers = SupplierService(db).list_suppliers(account_id)

    customer_rows: list[dict[str, Any]] = []
    total_customer_billed = Decimal("0.00")
    total_customer_paid = Decimal("0.00")
    total_customer_inflow = Decimal("0.00")
    total_receivables = Decimal("0.00")

    for cust in customers:
        stmt = build_customer_statement(
            db,
            account_id,
            cust.id,
            start=start,
            end=end,
            tz_offset_minutes=tz_offset_minutes,
        )
        s = stmt["summary"]
        total_customer_billed += _dec(s["total_billed"])
        total_customer_paid += _dec(s["total_paid"])
        total_customer_inflow += _dec(s["cash_inflow"])
        total_receivables += _dec(s["current_balance"])
        customer_rows.append(
            {
                "id": cust.id,
                "name": cust.name,
                "phone": cust.phone,
                "city": cust.city or cust.physical_location or cust.address,
                "opening_balance": s["opening_balance"],
                "total_billed": s["total_billed"],
                "total_paid": s["total_paid"],
                "cash_flow": s["net_cash_flow"],
                "paid_cash": s["paid_cash"],
                "paid_mpesa": s["paid_mpesa"],
                "closing_balance": s["closing_balance"],
                "current_balance": s["current_balance"],
                "credit_limit": s["credit_limit"],
                "due_date": stmt["party"]["due_date"],
                "transaction_count": s["transaction_count"],
            }
        )

    supplier_rows: list[dict[str, Any]] = []
    total_supplier_billed = Decimal("0.00")
    total_supplier_paid = Decimal("0.00")
    total_supplier_outflow = Decimal("0.00")
    total_payables = Decimal("0.00")
    total_pending_cheques = Decimal("0.00")
    total_pending_cheques_count = 0

    for sup in suppliers:
        stmt = build_supplier_statement(
            db,
            account_id,
            sup.id,
            start=start,
            end=end,
            tz_offset_minutes=tz_offset_minutes,
        )
        s = stmt["summary"]
        total_supplier_billed += _dec(s["total_billed"])
        total_supplier_paid += _dec(s["total_paid"])
        total_supplier_outflow += _dec(s["cash_outflow"])
        total_payables += max(Decimal("0.00"), _dec(s["current_balance"]))
        total_pending_cheques += _dec(s["pending_cheques"])
        total_pending_cheques_count += int(s["pending_cheques_count"] or 0)
        supplier_rows.append(
            {
                "id": sup.id,
                "name": sup.name,
                "phone": sup.phone,
                "city": sup.city or sup.address,
                "pin_number": sup.pin_number,
                "opening_balance": s["opening_balance"],
                "total_billed": s["total_billed"],
                "total_paid": s["total_paid"],
                "cash_flow": s["net_cash_flow"],
                "paid_cash": s["paid_cash"],
                "paid_mpesa": s["paid_mpesa"],
                "paid_cheque": s["paid_cheque"],
                "pending_cheques": s["pending_cheques"],
                "pending_cheques_count": s["pending_cheques_count"],
                "closing_balance": s["closing_balance"],
                "current_balance": s["current_balance"],
                "credit_limit": s["credit_limit"],
                "due_date": stmt["party"]["due_date"],
                "transaction_count": s["transaction_count"],
            }
        )

    # Sort highest balance / highest activity first
    customer_rows.sort(
        key=lambda r: (abs(r["current_balance"]), r["total_billed"], r["total_paid"]),
        reverse=True,
    )
    supplier_rows.sort(
        key=lambda r: (abs(r["current_balance"]), r["total_billed"], r["total_paid"]),
        reverse=True,
    )

    return {
        "period": {
            "start": start.isoformat() if start else None,
            "end": end.isoformat() if end else None,
        },
        "cash_flow_summary": {
            "customer_inflow": _flt(total_customer_inflow),
            "supplier_outflow": _flt(total_supplier_outflow),
            "net_cash_flow": _flt(total_customer_inflow - total_supplier_outflow),
            "total_receivables": _flt(total_receivables),
            "total_payables": _flt(total_payables),
            "net_working_position": _flt(total_receivables - total_payables),
            "customer_total_billed": _flt(total_customer_billed),
            "customer_total_paid": _flt(total_customer_paid),
            "supplier_total_billed": _flt(total_supplier_billed),
            "supplier_total_paid": _flt(total_supplier_paid),
            "pending_cheques": _flt(total_pending_cheques),
            "pending_cheques_count": total_pending_cheques_count,
        },
        "customers": customer_rows,
        "suppliers": supplier_rows,
    }


def export_statement_csv(statement: dict[str, Any]) -> tuple[bytes, str]:
    """Serialize a Customer or Supplier Statement of Account into CSV bytes and filename."""
    party = statement["party"]
    summary = statement["summary"]
    party_type: Literal["customer", "supplier"] = statement["party_type"]
    role_title = "CUSTOMER" if party_type == "customer" else "SUPPLIER"

    buf = io.StringIO()
    writer = csv.writer(buf)

    writer.writerow([f"{role_title} STATEMENT OF ACCOUNT & CASH FLOW"])
    writer.writerow(["Name", party.get("name") or ""])
    writer.writerow(["Phone", party.get("phone") or ""])
    if party.get("pin_number"):
        writer.writerow(["KRA PIN", party.get("pin_number")])
    if party.get("address") or party.get("city"):
        writer.writerow(
            ["Location", ", ".join(filter(None, [party.get("address"), party.get("city")]))]
        )
    period_start = statement["period"].get("start") or "Beginning"
    period_end = statement["period"].get("end") or "Present"
    writer.writerow(["Period", f"{period_start} to {period_end}"])
    writer.writerow([])

    writer.writerow(["CASH FLOW & ACCOUNT SUMMARY"])
    writer.writerow(["Opening Balance (KES)", f"{summary['opening_balance']:.2f}"])
    writer.writerow(
        [
            "Total Billed / Invoiced (KES)" if party_type == "customer" else "Total Purchased / Billed (KES)",
            f"{summary['total_billed']:.2f}",
        ]
    )
    writer.writerow(
        [
            "Total Received / Credited (KES)" if party_type == "customer" else "Total Paid to Supplier (KES)",
            f"{summary['total_paid']:.2f}",
        ]
    )
    writer.writerow(["Paid via Cash (KES)", f"{summary['paid_cash']:.2f}"])
    writer.writerow(["Paid via M-PESA (KES)", f"{summary['paid_mpesa']:.2f}"])
    if party_type == "supplier":
        writer.writerow(["Paid via Cheque (KES)", f"{summary['paid_cheque']:.2f}"])
        writer.writerow(["Pending Post-Dated Cheques (KES)", f"{summary['pending_cheques']:.2f}"])
    writer.writerow(["Net Cash Flow (KES)", f"{summary['net_cash_flow']:.2f}"])
    writer.writerow(["Closing Balance (KES)", f"{summary['closing_balance']:.2f}"])
    writer.writerow([])

    writer.writerow(
        [
            "Date",
            "Reference",
            "Type",
            "Description",
            "Payment Method",
            "Status",
            "Debit / Billed (KES)",
            "Credit / Paid (KES)",
            "Cash Flow (KES)",
            "Running Balance (KES)",
        ]
    )
    for entry in statement.get("entries", []):
        writer.writerow(
            [
                entry.get("date") or "",
                entry.get("reference") or "",
                (entry.get("type") or "").replace("_", " ").title(),
                entry.get("description") or "",
                (entry.get("payment_method") or "—").upper(),
                (entry.get("status") or "—").title(),
                f"{float(entry.get('debit') or 0):.2f}",
                f"{float(entry.get('credit') or 0):.2f}",
                f"{float(entry.get('cash_flow') or 0):.2f}",
                f"{float(entry.get('running_balance') or 0):.2f}",
            ]
        )

    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", (party.get("name") or party_type).strip()).strip("_")
    filename = f"{party_type}_statement_{safe_name.lower() or 'account'}.csv"
    return buf.getvalue().encode("utf-8-sig"), filename

