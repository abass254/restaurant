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
            selectinload(Order.items).joinedload(OrderItem.inventory_item)
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

    for order in orders:
        order_total = Decimal(str(order.total or 0))
        sales_total += order_total

        order_time = order.paid_at or order.created_at
        if order_time:
            sales_by_time.append((order_time + local_offset, order_total))

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

        for line in order.items:
            qty = int(line.quantity or 0)
            units_total += qty
            name = (line.product_name or "Item").strip()
            line_tot = Decimal(str(line.line_total or 0))

            prod_entry = products_map.setdefault(name, {"name": name, "qty": 0, "amount": Decimal("0.00")})
            prod_entry["qty"] += qty
            prod_entry["amount"] += line_tot

            if line.cost_total is not None:
                cogs_total += Decimal(str(line.cost_total))
            elif line.inventory_item and line.inventory_item.buying_price is not None:
                cogs_total += Decimal(str(line.inventory_item.buying_price)) * Decimal(str(qty))

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

    # 3. Chart Bucketing
    buckets: list[dict[str, Any]] = []
    if start == end:
        hours = [dt.hour for dt, _ in sales_by_time] + [dt.hour for dt, _ in purchases_by_time]
        start_hour = min([8] + hours)
        end_hour = max([18] + hours)

        hourly_sales: dict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))
        hourly_purchases: dict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))

        for dt, amt in sales_by_time:
            hourly_sales[dt.hour] += amt
        for dt, amt in purchases_by_time:
            hourly_purchases[dt.hour] += amt

        for h in range(start_hour, end_hour + 1):
            buckets.append({
                "key": str(h),
                "label": _hour_label(h),
                "sales": float(hourly_sales[h]),
                "purchases": float(hourly_purchases[h]),
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

        buckets = [
            {
                "key": b["key"],
                "label": b["label"],
                "sales": float(b["sales"]),
                "purchases": float(b["purchases"]),
            }
            for b in daily_buckets.values()
        ]

    # 4. Debts / Outstanding balance
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

    sorted_products = sorted(
        products_map.values(),
        key=lambda p: float(p["amount"]),
        reverse=True,
    )
    top_products = [
        {"name": p["name"], "qty": p["qty"], "amount": float(p["amount"])}
        for p in sorted_products
    ]

    net_profit = float(sales_total - purchase_total)
    gross_profit = float(sales_total - cogs_total)

    return {
        "sales_total": float(sales_total),
        "sales_count": sales_count,
        "units": units_total,
        "purchase_total": float(purchase_total),
        "purchase_count": purchase_count,
        "net_profit": net_profit,
        "cogs": float(cogs_total),
        "gross_profit": gross_profit,
        "payment_methods": {
            "mpesa": float(mpesa_total),
            "cash": float(cash_total),
            "credit": float(credit_total),
            "other": float(other_total),
        },
        "buckets": buckets,
        "top_products": top_products,
        "owing_total": owing_total,
        "owing_count": owing_count,
    }
