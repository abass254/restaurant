"""Reports service: Fast server-side aggregation for merchant dashboards and analytics."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    InventoryItem,
    Order,
    OrderItem,
    ShopCustomer,
    ShopExpense,
    StockMovement,
)
from app.support.order_status import CANCELLED, REFUNDED

DEFAULT_TZ_OFFSET_MINUTES = 180  # Africa/Nairobi (UTC+3)


def day_bounds(start: date, end: date, tz_offset_minutes: int) -> tuple[datetime, datetime]:
    """Local calendar days [start, end] converted to naive-UTC datetimes."""
    offset = timedelta(minutes=tz_offset_minutes)
    begin = datetime.combine(start, datetime.min.time()) - offset
    finish = datetime.combine(end + timedelta(days=1), datetime.min.time()) - offset
    return begin, finish


def _hour_label(hour: int) -> str:
    if hour == 0:
        return "12am"
    if hour == 12:
        return "12pm"
    return f"{hour}am" if hour < 12 else f"{hour - 12}pm"


def _day_label(d: date) -> str:
    return d.strftime("%a, %-d %b")


def _month_label(d: date) -> str:
    return d.strftime("%b %Y")


import re
from app.services.sell_units import pack_units_from_attributes


def resolve_order_line_cost(
    line: OrderItem,
    product_buying_prices: dict[str, Decimal] | None = None,
) -> tuple[Decimal, Decimal, str]:
    """Resolve (item_cogs, effective_unit_factor, effective_sell_unit) for an order line."""
    qty = Decimal(str(line.quantity or 0))
    line_sell = Decimal(str(line.unit_price or 0))
    existing_factor = Decimal(str(getattr(line, "unit_factor", None) or 1))
    sell_unit_name = str(getattr(line, "sell_unit", None) or "").strip()
    inv_item = getattr(line, "inventory_item", None)

    # 1. Historical explicit cost
    if line.cost_total is not None:
        return Decimal(str(line.cost_total)), existing_factor, sell_unit_name

    # 2. Line already marked with explicit bulk factor > 1
    if existing_factor > 1:
        base_buy = None
        if inv_item and inv_item.buying_price is not None:
            base_buy = Decimal(str(inv_item.buying_price))
        elif line.product_id and product_buying_prices and line.product_id in product_buying_prices:
            base_buy = product_buying_prices[line.product_id]
        if base_buy is not None:
            item_cogs = base_buy * (qty * existing_factor)
        else:
            item_cogs = Decimal("0.00")
        return item_cogs, existing_factor, sell_unit_name or "Bulk"

    # 3. Factor <= 1: check if item was sold as a pack / bulk unit
    if inv_item and inv_item.buying_price is not None:
        base_buy = Decimal(str(inv_item.buying_price))
        packs = pack_units_from_attributes(inv_item.attributes)

        # 3A. Explicit sell_unit matching
        matched_pack: dict[str, Any] | None = None
        if sell_unit_name:
            for p in packs:
                if str(p.get("name") or "").strip().lower() == sell_unit_name.lower():
                    matched_pack = p
                    break

        # 3B. Infer pack if sold at pack price (e.g. 25KG bag at 3400 vs base buy 120.80)
        if not matched_pack and packs and base_buy > 0:
            for p in packs:
                p_factor = Decimal(str(p.get("factor") or 1))
                if p_factor <= 1:
                    continue
                p_buy = Decimal(str(p.get("buying_price") or (base_buy * p_factor)))
                p_sell = Decimal(str(p.get("selling_price") or (Decimal(str(inv_item.selling_price or 0)) if Decimal(str(inv_item.selling_price or 0)) > base_buy * 2 else (base_buy * p_factor * Decimal("1.1")))))

                is_match = False
                if line_sell >= p_buy * Decimal("0.7"):
                    if line_sell >= base_buy * Decimal("2.0"):
                        is_match = True
                    elif p_sell > 0 and abs(line_sell - p_sell) < abs(line_sell - base_buy):
                        is_match = True

                if is_match:
                    matched_pack = p
                    break

        # 3C. Infer pack from product packaging in name if packs not configured
        if not matched_pack and base_buy > 0 and inv_item.product and inv_item.product.unit:
            unit_str = inv_item.product.unit.strip().lower()
            if unit_str in {"kg", "kgs", "l", "ltr", "litres", "liters"}:
                m = re.search(r"\b(\d+)\s*" + re.escape(unit_str) + r"\b", line.product_name or "", re.I)
                if m:
                    inferred_factor = Decimal(m.group(1))
                    if inferred_factor > 1 and line_sell >= (base_buy * inferred_factor) * Decimal("0.7"):
                        matched_pack = {
                            "name": f"{m.group(1)}{inv_item.product.unit.upper()} BAG",
                            "factor": int(inferred_factor),
                            "buying_price": float(base_buy * inferred_factor),
                        }

        if matched_pack:
            pack_factor = Decimal(str(matched_pack.get("factor") or 1))
            pack_buy = Decimal(str(matched_pack.get("buying_price") or (base_buy * pack_factor)))
            pack_name = str(matched_pack.get("name") or f"Pack ({pack_factor} pcs)")
            item_cogs = pack_buy * qty
            return item_cogs, pack_factor, pack_name

        # 3D. Standard base piece
        item_cogs = base_buy * qty
        return item_cogs, Decimal("1"), sell_unit_name

    # 4. Fallback from product_buying_prices
    if line.product_id and product_buying_prices and line.product_id in product_buying_prices:
        base_buy = product_buying_prices[line.product_id]
        item_cogs = base_buy * qty
        return item_cogs, Decimal("1"), sell_unit_name

    return Decimal("0.00"), Decimal("1"), sell_unit_name


def reports_summary(
    db: Session,
    account_id: str,
    start: date,
    end: date,
    tz_offset_minutes: int = DEFAULT_TZ_OFFSET_MINUTES,
    source: str | None = None,
) -> dict[str, Any]:
    """Aggregate sales, purchases, payment methods, chart buckets, COGS, and customer debt."""
    begin, finish = day_bounds(start, end, tz_offset_minutes)
    local_offset = timedelta(minutes=tz_offset_minutes)

    # 1. Sales (Orders)
    orders_query = (
        db.query(Order)
        .options(
            selectinload(Order.items).joinedload(OrderItem.inventory_item).joinedload(InventoryItem.product)
        )
        .filter(
            Order.account_id == account_id,
            Order.created_at >= begin,
            Order.created_at < finish,
            ~Order.status.in_((CANCELLED, REFUNDED)),
        )
    )
    if source:
        orders_query = orders_query.filter(Order.source == source)

    orders = orders_query.all()

    # Fallback lookup: active inventory items for this account with buying price
    inv_items = (
        db.query(InventoryItem.product_id, InventoryItem.buying_price)
        .filter(InventoryItem.account_id == account_id, InventoryItem.buying_price.isnot(None))
        .all()
    )
    product_buying_prices = {
        row[0]: Decimal(str(row[1])) for row in inv_items if row[0] and row[1] is not None
    }

    sales_total = Decimal("0.00")
    sales_count = len(orders)
    units_total = 0
    cogs_total = Decimal("0.00")

    mpesa_total = Decimal("0.00")
    cash_total = Decimal("0.00")
    credit_total = Decimal("0.00")
    other_total = Decimal("0.00")

    products_map: dict[str, dict[str, Any]] = {}
    sales_by_time: list[tuple[datetime, Decimal]] = []
    markup_by_time: list[tuple[datetime, Decimal]] = []

    for order in orders:
        order_total = Decimal(str(order.total or 0))
        sales_total += order_total

        if order.created_at:
            sales_by_time.append((order.created_at + local_offset, order_total))

        if order.payment_method == "split" and order.payment_splits:
            for split in order.payment_splits:
                m = str(split.get("method") or "").lower()
                amt = Decimal(str(split.get("amount") or 0))
                if m == "mpesa":
                    mpesa_total += amt
                elif m == "credit":
                    credit_total += amt
                elif m == "cash":
                    cash_total += amt
                else:
                    other_total += amt
        else:
            m = str(order.payment_method or "cash").lower()
            if m == "mpesa":
                mpesa_total += order_total
            elif m == "credit":
                credit_total += order_total
            elif m == "cash":
                cash_total += order_total
            else:
                other_total += order_total

        order_markup = Decimal("0.00")
        for line in order.items:
            qty = int(line.quantity or 0)
            units_total += qty
            name = (line.product_name or "Item").strip()
            line_tot = Decimal(str(line.line_total if line.line_total is not None else (line.unit_price or 0) * qty))

            item_cogs, unit_factor, sell_unit_name = resolve_order_line_cost(line, product_buying_prices)
            total_pcs = Decimal(str(qty)) * unit_factor

            prod_entry = products_map.setdefault(
                name,
                {
                    "name": name,
                    "sku": line.product_sku or "",
                    "qty": 0,
                    "total_pcs": Decimal("0"),
                    "amount": Decimal("0.00"),
                    "cogs": Decimal("0.00"),
                    "markup": Decimal("0.00"),
                    "sell_unit": sell_unit_name,
                    "unit_factor": unit_factor,
                },
            )
            if sell_unit_name and not prod_entry.get("sell_unit"):
                prod_entry["sell_unit"] = sell_unit_name
            if unit_factor > 1:
                prod_entry["unit_factor"] = unit_factor

            prod_entry["qty"] += qty
            prod_entry["total_pcs"] += total_pcs
            prod_entry["amount"] += line_tot

            cogs_total += item_cogs
            item_markup = line_tot - item_cogs
            order_markup += item_markup

            prod_entry["cogs"] += item_cogs
            prod_entry["markup"] += item_markup

        if order.created_at:
            markup_by_time.append((order.created_at + local_offset, order_markup))


    # 2. Purchases (Stock Movements - direction=in, reason=receive, voided_at=None)
    movements_query = (
        db.query(StockMovement)
        .options(joinedload(StockMovement.inventory_item))
        .filter(
            StockMovement.account_id == account_id,
            StockMovement.direction == "in",
            StockMovement.reason == "receive",
            StockMovement.voided_at.is_(None),
            StockMovement.created_at >= begin,
            StockMovement.created_at < finish,
        )
    )
    movements = movements_query.all()

    purchase_total = Decimal("0.00")
    purchase_count = len(movements)
    purchases_by_time: list[tuple[datetime, Decimal]] = []

    for mov in movements:
        cost = Decimal(str(mov.unit_cost)) if mov.unit_cost is not None else (
            Decimal(str(mov.inventory_item.buying_price)) if mov.inventory_item and mov.inventory_item.buying_price is not None else Decimal("0.00")
        )
        qty = Decimal(str(mov.quantity or 0))
        line_total = cost * qty
        purchase_total += line_total
        if mov.created_at:
            purchases_by_time.append((mov.created_at + local_offset, line_total))

    # 3. Expenses / Daily Errands
    expenses_query = (
        db.query(ShopExpense)
        .filter(
            ShopExpense.account_id == account_id,
            ShopExpense.spent_at >= begin,
            ShopExpense.spent_at < finish,
        )
    )
    expenses = expenses_query.all()
    expense_total = Decimal("0.00")
    expense_count = len(expenses)
    expenses_by_time: list[tuple[datetime, Decimal]] = []

    for exp in expenses:
        exp_amt = Decimal(str(exp.amount or 0))
        expense_total += exp_amt
        if exp.spent_at:
            expenses_by_time.append((exp.spent_at + local_offset, exp_amt))

    # 4. Chart Bucketing
    buckets: list[dict[str, Any]] = []
    if start == end:
        hours = (
            [dt.hour for dt, _ in sales_by_time]
            + [dt.hour for dt, _ in purchases_by_time]
            + [dt.hour for dt, _ in expenses_by_time]
        )
        start_hour = min([8] + hours)
        end_hour = max([18] + hours)

        hourly_sales: dict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))
        hourly_purchases: dict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))
        hourly_expenses: dict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))
        hourly_markup: dict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))

        for dt, amt in sales_by_time:
            hourly_sales[dt.hour] += amt
        for dt, amt in purchases_by_time:
            hourly_purchases[dt.hour] += amt
        for dt, amt in expenses_by_time:
            hourly_expenses[dt.hour] += amt
        for dt, amt in markup_by_time:
            hourly_markup[dt.hour] += amt

        for h in range(start_hour, end_hour + 1):
            buckets.append({
                "key": str(h),
                "label": _hour_label(h),
                "sales": float(hourly_sales[h]),
                "purchases": float(hourly_purchases[h]),
                "expenses": float(hourly_expenses[h]),
                "markup": float(hourly_markup[h]),
            })
    else:
        days_span = (end - start).days
        monthly = days_span > 62

        daily_buckets: dict[str, dict[str, Any]] = {}
        curr = start
        while curr <= end:
            k = curr.strftime("%Y-%m") if monthly else curr.strftime("%Y-%m-%d")
            if k not in daily_buckets:
                daily_buckets[k] = {
                    "key": k,
                    "label": _month_label(curr) if monthly else _day_label(curr),
                    "sales": Decimal("0.00"),
                    "purchases": Decimal("0.00"),
                    "expenses": Decimal("0.00"),
                    "markup": Decimal("0.00"),
                }
            curr += timedelta(days=1)

        for dt, amt in sales_by_time:
            d_key = dt.strftime("%Y-%m") if monthly else dt.strftime("%Y-%m-%d")
            if d_key in daily_buckets:
                daily_buckets[d_key]["sales"] += amt

        for dt, amt in purchases_by_time:
            d_key = dt.strftime("%Y-%m") if monthly else dt.strftime("%Y-%m-%d")
            if d_key in daily_buckets:
                daily_buckets[d_key]["purchases"] += amt

        for dt, amt in expenses_by_time:
            d_key = dt.strftime("%Y-%m") if monthly else dt.strftime("%Y-%m-%d")
            if d_key in daily_buckets:
                daily_buckets[d_key]["expenses"] += amt

        for dt, amt in markup_by_time:
            d_key = dt.strftime("%Y-%m") if monthly else dt.strftime("%Y-%m-%d")
            if d_key in daily_buckets:
                daily_buckets[d_key]["markup"] += amt

        buckets = [
            {
                "key": b["key"],
                "label": b["label"],
                "sales": float(b["sales"]),
                "purchases": float(b["purchases"]),
                "expenses": float(b["expenses"]),
                "markup": float(b["markup"]),
            }
            for b in daily_buckets.values()
        ]

    # 5. Debts / Outstanding balance
    owing_rows = (
        db.query(ShopCustomer)
        .filter(
            ShopCustomer.account_id == account_id,
            ShopCustomer.outstanding_balance > 0,
        )
        .all()
    )
    owing_total = float(sum((Decimal(str(r.outstanding_balance or 0)) for r in owing_rows), Decimal("0.00")))
    owing_count = len(owing_rows)

    sorted_by_markup = sorted(
        products_map.values(),
        key=lambda p: float(p["markup"]),
        reverse=True,
    )
    products_sold = [
        {
            "name": p["name"],
            "sku": p.get("sku") or "",
            "qty": p["qty"],
            "total_pcs": float(p.get("total_pcs", Decimal(str(p["qty"])))),
            "sell_unit": p.get("sell_unit") or "",
            "unit_factor": float(p.get("unit_factor", Decimal("1"))),
            "selling_amount": float(p["amount"]),
            "buying_amount": float(p["cogs"]),
            "markup": float(p["markup"]),
            "selling_price": round(float(p["amount"] / p["qty"]), 2) if p["qty"] > 0 else 0.0,
            "buying_price": (
                round(float(p["cogs"] / p["total_pcs"]), 2)
                if p.get("total_pcs", Decimal("0")) > 0
                else 0.0
            ),
            "unit_buying_price": (
                round(float(p["cogs"] / p["qty"]), 2)
                if p["qty"] > 0
                else 0.0
            ),
            "markup_percent": round(float(p["markup"] / p["cogs"] * 100), 1) if p["cogs"] > 0 else 0.0,
        }
        for p in sorted_by_markup
    ]
    top_products = [
        {"name": p["name"], "qty": p["qty"], "amount": float(p["amount"])}
        for p in sorted(products_map.values(), key=lambda p: float(p["amount"]), reverse=True)
    ]

    net_profit = float(sales_total - purchase_total)
    gross_profit = float(sales_total - cogs_total)
    gross_markup_percent = (
        round(float((sales_total - cogs_total) / cogs_total * 100), 1)
        if cogs_total > 0
        else 0.0
    )
    gross_margin_percent = (
        round(float((sales_total - cogs_total) / sales_total * 100), 1)
        if sales_total > 0
        else 0.0
    )

    return {
        "sales_total": float(sales_total),
        "sales_count": sales_count,
        "units": units_total,
        "purchase_total": float(purchase_total),
        "purchase_count": purchase_count,
        "expense_total": float(expense_total),
        "expense_count": expense_count,
        "net_profit": net_profit,
        "net_profit_after_expenses": float(sales_total - expense_total),
        "cogs": float(cogs_total),
        "gross_profit": gross_profit,
        "markup_total": gross_profit,
        "gross_markup_percent": gross_markup_percent,
        "gross_margin_percent": gross_margin_percent,
        "payment_methods": {
            "mpesa": float(mpesa_total),
            "cash": float(cash_total),
            "credit": float(credit_total),
            "other": float(other_total),
        },
        "buckets": buckets,
        "top_products": top_products,
        "products_sold": products_sold,
        "owing_total": owing_total,
        "owing_count": owing_count,
    }

