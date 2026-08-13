"""Proactive shop + conversation context for the DM sales agent."""

from __future__ import annotations

from collections import Counter
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    Account,
    GoogleMapsConfiguration,
    InstagramAccount,
    InstagramConversation,
    InventoryItem,
    Order,
    Product,
)
from app.services.catalog.catalog_types import CatalogItem, normalize_ref
from app.services.dm_catalog_service import DmCatalogService
from app.services.dm_order_service import DmOrderService
from app.support.order_status import STATUS_LABELS, TERMINAL_STATUSES
from app.support.sales_session import (
    STEP_AWAITING_ORDER_CONFIRM,
    STEP_AWAITING_QUANTITY,
    STEP_HANDOFF,
    STEP_IDLE,
    STEP_TRACKING,
    read_session,
)
from app.support.store_status import store_status_payload

_STEP_LABELS = {
    STEP_IDLE: "browsing",
    STEP_AWAITING_QUANTITY: "awaiting quantity",
    STEP_AWAITING_ORDER_CONFIRM: "awaiting order confirmation",
    STEP_TRACKING: "order placed — tracking",
    STEP_HANDOFF: "handed off to human agent",
}


def _status_label(status: str | None) -> str:
    raw = str(status or "").strip()
    if not raw:
        return "unknown"
    return STATUS_LABELS.get(raw, raw.replace("_", " ").title())


def _order_line_summary(order: Order) -> str:
    items = list(order.items or [])
    if not items:
        return "no line items"
    parts = []
    for line in items[:3]:
        qty = int(line.quantity or 1)
        name = str(line.product_name or "item").strip()
        parts.append(f"{qty}× {name}")
    if len(items) > 3:
        parts.append(f"+{len(items) - 3} more")
    return ", ".join(parts)


def order_to_agent_dict(order: Order, *, include_timeline: bool = False) -> dict[str, Any]:
    """Compact order payload for tools and live context."""
    payload: dict[str, Any] = {
        "order_id": order.id,
        "order_number": order.order_number,
        "status": order.status,
        "status_label": _status_label(order.status),
        "total_kes": int(round(float(order.total or 0))),
        "items_summary": _order_line_summary(order),
        "is_active": str(order.status or "") not in TERMINAL_STATUSES,
        "created_at": order.created_at.isoformat() if order.created_at else None,
    }
    if include_timeline and order.status_history:
        payload["recent_statuses"] = [
            _status_label(entry.to_status)
            for entry in list(order.status_history)[-3:]
        ]
    return payload


def build_shop_info_dict(db: Session, merchant_id: str) -> dict[str, Any]:
    """Shop profile facts the sales agent may use without calling tools."""
    merchant = db.get(Account, merchant_id) if merchant_id else None
    if merchant is None:
        return {
            "business_name": None,
            "business_location": None,
            "business_category": None,
            "accepting_orders": True,
            "store_status": "unknown",
            "orders_paused_reason": None,
            "default_prep_minutes": None,
            "delivery_fee_per_km": None,
        }

    status = store_status_payload(merchant)
    maps = (
        db.query(GoogleMapsConfiguration)
        .filter(GoogleMapsConfiguration.is_active.is_(True))
        .order_by(GoogleMapsConfiguration.id.desc())
        .first()
    )
    delivery_fee = None
    if maps is not None and maps.delivery_fee_per_km is not None:
        delivery_fee = float(maps.delivery_fee_per_km)

    return {
        "business_name": (merchant.business_name or "").strip() or None,
        "business_location": (merchant.business_location or "").strip() or None,
        "business_category": (merchant.business_category or "").strip() or None,
        "accepting_orders": bool(status.get("accepting_orders")),
        "store_status": str(status.get("status") or "open"),
        "orders_paused_reason": status.get("orders_paused_reason"),
        "orders_paused_until": status.get("orders_paused_until"),
        "default_prep_minutes": status.get("default_prep_minutes"),
        "effective_prep_minutes": status.get("effective_prep_minutes"),
        "delivery_fee_per_km": delivery_fee,
    }


def _product_type_counts(db: Session, merchant_id: str) -> dict[str, int]:
    rows = (
        db.query(Product.product_type, func.count())
        .join(InventoryItem, InventoryItem.product_id == Product.id)
        .filter(
            InventoryItem.account_id == merchant_id,
            InventoryItem.is_active.is_(True),
            InventoryItem.selling_price.isnot(None),
        )
        .group_by(Product.product_type)
        .all()
    )
    counts = {"product": 0, "service": 0}
    for product_type, count in rows:
        key = str(product_type or "product").strip().lower()
        if key not in counts:
            key = "product"
        counts[key] = int(count or 0)
    return counts


def build_inventory_summary_dict(
    db: Session,
    merchant_id: str,
    catalog: DmCatalogService,
    account: InstagramAccount,
    *,
    sample_limit: int = 25,
) -> dict[str, Any]:
    total_active = (
        db.query(InventoryItem)
        .filter(
            InventoryItem.account_id == merchant_id,
            InventoryItem.is_active.is_(True),
            InventoryItem.selling_price.isnot(None),
        )
        .count()
    )
    type_counts = _product_type_counts(db, merchant_id)
    items = catalog.list_catalog_items(merchant_id, limit=sample_limit, account=account)
    categories = Counter(
        (item.category or "uncategorised").strip() or "uncategorised" for item in items
    )
    low_stock: list[dict[str, Any]] = []
    out_of_stock: list[dict[str, Any]] = []
    for item in items:
        if item.stock is not None and item.stock <= 0:
            out_of_stock.append({"name": item.name, "inventory_item_id": item.inventory_item_id})
            continue
        row = _inventory_row(db, merchant_id, item)
        if row is not None and row.is_low_stock():
            low_stock.append(
                {
                    "name": item.name,
                    "stock": item.stock,
                    "inventory_item_id": item.inventory_item_id,
                },
            )
        elif item.stock is not None and item.stock <= 3:
            low_stock.append(
                {
                    "name": item.name,
                    "stock": item.stock,
                    "inventory_item_id": item.inventory_item_id,
                },
            )

    return {
        "total_active_products": total_active,
        "product_count": type_counts.get("product", 0),
        "service_count": type_counts.get("service", 0),
        "sampled_products": len(items),
        "categories": [
            {"name": name, "count": count}
            for name, count in categories.most_common(8)
        ],
        "low_stock": low_stock[:8],
        "out_of_stock_count": len(out_of_stock),
        "out_of_stock_sample": out_of_stock[:5],
    }


def _inventory_row(db: Session, merchant_id: str, item: CatalogItem) -> InventoryItem | None:
    item_id = item.inventory_item_id
    if not item_id:
        return None
    return (
        db.query(InventoryItem)
        .filter(InventoryItem.id == item_id, InventoryItem.account_id == merchant_id)
        .first()
    )


def _resolve_item_name(
    catalog: DmCatalogService,
    merchant_id: str,
    account: InstagramAccount,
    item_ref: str | None,
    item_id: str | None,
) -> str | None:
    ref = str(item_ref or "").strip()
    if not ref and item_id:
        ref = normalize_ref(str(item_id))
    if not ref:
        return None
    item = catalog.get_catalog_item(ref, merchant_id, account=account)
    return item.name if item else None


def build_session_context_dict(
    conversation: InstagramConversation,
    catalog: DmCatalogService,
    account: InstagramAccount,
    merchant_id: str,
) -> dict[str, Any]:
    session = read_session(conversation.sales_session)
    step = str(session.get("step") or STEP_IDLE)
    pending_name = _resolve_item_name(
        catalog,
        merchant_id,
        account,
        str(session.get("catalog_pending_item_ref") or ""),
        str(session.get("catalog_pending_item_id") or ""),
    )
    discussed_name = _resolve_item_name(
        catalog,
        merchant_id,
        account,
        str(session.get("last_discussed_item_ref") or ""),
        str(session.get("last_discussed_item_id") or ""),
    )
    return {
        "step": step,
        "step_label": _STEP_LABELS.get(step, step.replace("_", " ")),
        "pending_product": pending_name,
        "pending_quantity": session.get("catalog_pending_quantity"),
        "last_discussed_product": discussed_name,
        "awaiting_customer_confirm": bool(session.get("customer_order_confirmed")),
        "handoff": step == STEP_HANDOFF,
    }


def build_conversation_context(
    db: Session,
    account: InstagramAccount,
    conversation: InstagramConversation,
    *,
    orders: DmOrderService,
    catalog: DmCatalogService,
) -> str:
    """Human-readable live context appended to the agent system prompt."""
    merchant_id = str(account.account_id or "").strip()
    if not merchant_id:
        return ""

    session_info = build_session_context_dict(conversation, catalog, account, merchant_id)
    session = read_session(conversation.sales_session)
    active_order = orders.order_for_session(conversation.id, session)
    recent_order = orders.latest_order_for_conversation(conversation.id)

    inventory = build_inventory_summary_dict(db, merchant_id, catalog, account)
    shop = build_shop_info_dict(db, merchant_id)

    lines = ["Live context (use this before calling tools when it is enough):"]

    shop_bits: list[str] = []
    if shop.get("business_name"):
        shop_bits.append(str(shop["business_name"]))
    if shop.get("business_location"):
        shop_bits.append(f"in {shop['business_location']}")
    if shop_bits:
        lines.append(f"- Shop: {' '.join(shop_bits)}.")
    status = str(shop.get("store_status") or "open")
    if shop.get("accepting_orders"):
        status_line = f"- Store status: {status} (accepting orders)."
        prep = shop.get("effective_prep_minutes") or shop.get("default_prep_minutes")
        if prep:
            status_line += f" Typical prep ~{prep} min."
        lines.append(status_line)
    else:
        reason = shop.get("orders_paused_reason") or "paused"
        lines.append(
            f"- Store status: paused ({reason}) — not accepting new orders right now. "
            "Be honest if they want to buy; offer to help with enquiries or tracking."
        )
    if shop.get("delivery_fee_per_km") is not None:
        lines.append(
            f"- Delivery rate: KES {int(round(float(shop['delivery_fee_per_km'])))}/km "
            "(exact fee depends on distance)."
        )

    mix_bits = []
    if inventory.get("product_count"):
        mix_bits.append(f"{inventory['product_count']} product(s)")
    if inventory.get("service_count"):
        mix_bits.append(f"{inventory['service_count']} service(s)")
    catalogue_line = (
        f"- Shop catalogue: {inventory['total_active_products']} active listing(s)"
    )
    if mix_bits:
        catalogue_line += f" ({', '.join(mix_bits)})"
    catalogue_line += "."
    lines.append(catalogue_line)

    if inventory["categories"]:
        cat_bits = ", ".join(
            f"{row['name']} ({row['count']})" for row in inventory["categories"][:5]
        )
        lines.append(f"- Top categories: {cat_bits}.")
    if inventory["low_stock"]:
        low_bits = ", ".join(
            f"{row['name']} ({row['stock']} left)" for row in inventory["low_stock"][:5]
        )
        lines.append(f"- Low stock: {low_bits}.")
    if inventory["out_of_stock_count"]:
        lines.append(
            f"- Out of stock: {inventory['out_of_stock_count']} product(s) "
            f"in the sampled catalogue."
        )

    if session_info["handoff"]:
        lines.append("- Conversation is with a human agent — you should not be replying.")
    elif session_info["step"] != STEP_IDLE:
        step_line = f"- Session: {session_info['step_label']}."
        if session_info["pending_product"]:
            qty = session_info.get("pending_quantity") or 1
            step_line += f" Pending: {session_info['pending_product']} × {qty}."
        elif session_info["last_discussed_product"]:
            step_line += f" Last discussed: {session_info['last_discussed_product']}."
        lines.append(step_line)
    elif session_info["last_discussed_product"]:
        lines.append(
            f"- Last discussed: {session_info['last_discussed_product']}."
        )

    if active_order is not None:
        summary = order_to_agent_dict(active_order)
        lines.append(
            f"- Active order {summary['order_number']}: {summary['status_label']}, "
            f"KES {summary['total_kes']:,} ({summary['items_summary']}). "
            "Mention proactively if the customer greets or asks for help."
        )
    elif recent_order is not None and str(recent_order.status or "") in TERMINAL_STATUSES:
        summary = order_to_agent_dict(recent_order)
        lines.append(
            f"- Most recent order {summary['order_number']}: {summary['status_label']} "
            f"(completed). Use get_customer_orders if they ask about past orders."
        )

    lines.append(
        "- Tools get_shop_info, get_inventory_summary, recommend_products, "
        "get_product_details, get_customer_orders, and get_order_by_number "
        "are available for fresher detail."
    )
    return "\n".join(lines)
