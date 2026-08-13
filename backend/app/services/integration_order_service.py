"""Create delivery orders for merchant API integrations (Postman, ERP, etc.)."""

from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.models import InventoryItem, Order, OrderItem, OrderStatusHistory
from app.services.inventory_stock_service import InsufficientStockError, deduct_stock
from app.support.order_status import (
    FULFILLMENT_DELIVERY,
    PAYMENT_MPESA,
    PLACED,
    allowed_next_statuses,
)

logger = logging.getLogger(__name__)


class IntegrationOrderError(ValueError):
    """Validation / business error for integration order create."""


def _money(value: float | int | Decimal | None) -> Decimal:
    if value is None:
        return Decimal("0.00")
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _next_order_number(db: Session, account_id: str) -> str:
    last = (
        db.query(Order.order_number)
        .filter(Order.account_id == account_id)
        .order_by(Order.created_at.desc())
        .first()
    )
    if not last or not last[0]:
        return "ORD-000001"
    raw = str(last[0])
    if raw.startswith("ORD-"):
        try:
            n = int(raw.split("-", 1)[1])
            return f"ORD-{n + 1:06d}"
        except ValueError:
            pass
    if raw.isdigit():
        return f"ORD-{int(raw) + 1:06d}"
    # Fallback: count + 1
    count = db.query(Order).filter(Order.account_id == account_id).count()
    return f"ORD-{count + 1:06d}"


class IntegrationOrderService:
    def __init__(self, db: Session):
        self.db = db

    def create_delivery_order(
        self,
        account_id: str,
        *,
        customer_name: str,
        customer_phone: str,
        delivery_address: str,
        items: list[dict[str, Any]],
        customer_email: str | None = None,
        delivery_notes: str | None = None,
        delivery_fee: float | int | Decimal | None = 0,
        discount: float | int | Decimal | None = 0,
        currency: str = "KES",
        payment_method: str | None = "cash",
        source: str = "phone_call",
        notes: str | None = None,
        external_order_id: str | None = None,
    ) -> tuple[Order, bool]:
        name = (customer_name or "").strip()
        phone = (customer_phone or "").strip()
        address = (delivery_address or "").strip()
        if not name:
            raise IntegrationOrderError("customer_name is required.")
        if not phone:
            raise IntegrationOrderError("customer_phone is required.")
        if not address:
            raise IntegrationOrderError("delivery_address is required.")
        if not items:
            raise IntegrationOrderError("At least one item is required.")

        ext_id = (external_order_id or "").strip() or None
        if ext_id:
            existing = (
                self.db.query(Order)
                .filter(
                    Order.account_id == account_id,
                    Order.external_order_id == ext_id,
                )
                .first()
            )
            if existing:
                return existing, False

        if payment_method == PAYMENT_MPESA and not phone:
            raise IntegrationOrderError(
                "customer_phone is required for M-PESA orders.",
            )

        allowed_sources = {
            "walkin",
            "phone_call",
            "instagram",
            "whatsapp",
            "tiktok",
            "facebook",
        }
        clean_source = (source or "phone_call").strip()
        if clean_source not in allowed_sources:
            raise IntegrationOrderError(
                f"source must be one of: {', '.join(sorted(allowed_sources))}.",
            )

        resolved: list[tuple[dict[str, Any], InventoryItem | None, Decimal, str, str | None]] = []
        for idx, line in enumerate(items):
            inv_item: InventoryItem | None = None
            inv_id = (line.get("inventory_item_id") or "").strip() or None
            if inv_id:
                inv_item = (
                    self.db.query(InventoryItem)
                    .options(joinedload(InventoryItem.product))
                    .filter(
                        InventoryItem.id == inv_id,
                        InventoryItem.account_id == account_id,
                    )
                    .first()
                )
                if not inv_item:
                    raise IntegrationOrderError(
                        f"items[{idx}].inventory_item_id not found in your inventory.",
                    )

            qty = int(line.get("quantity") or 0)
            if qty < 1:
                raise IntegrationOrderError(f"items[{idx}].quantity must be >= 1.")

            if inv_item and inv_item.product:
                product_name = (
                    (line.get("product_name") or inv_item.product.name) or ""
                ).strip()
                sku = line.get("product_sku") or inv_item.product.sku
                default_price = (
                    Decimal(str(inv_item.selling_price))
                    if inv_item.selling_price is not None
                    else Decimal("0")
                )
                unit_price = (
                    _money(line.get("unit_price"))
                    if line.get("unit_price") is not None
                    else default_price
                )
            else:
                product_name = (line.get("product_name") or "").strip()
                if not product_name:
                    raise IntegrationOrderError(
                        f"items[{idx}].product_name is required for custom items.",
                    )
                if line.get("unit_price") is None:
                    raise IntegrationOrderError(
                        f"items[{idx}].unit_price is required for custom items.",
                    )
                sku = (line.get("product_sku") or "").strip() or None
                unit_price = _money(line.get("unit_price"))

            resolved.append((line, inv_item, unit_price, product_name, sku))

        subtotal = sum(
            (price * int(line.get("quantity") or 0) for line, _, price, _, _ in resolved),
            Decimal("0"),
        )
        fee = _money(delivery_fee)
        disc = _money(discount)
        total = (subtotal + fee - disc).quantize(Decimal("0.01"))
        if total < 0:
            total = Decimal("0.00")

        from datetime import datetime

        now = datetime.utcnow()
        api_note = (notes or "").strip() or None
        origin = "Created via merchant API (Postman / integration)."
        combined_notes = f"{origin} {api_note}".strip() if api_note else origin

        order = Order(
            account_id=account_id,
            order_number=_next_order_number(self.db, account_id),
            source=clean_source,
            fulfillment_type=FULFILLMENT_DELIVERY,
            status=PLACED,
            customer_name=name,
            customer_phone=phone,
            customer_email=(customer_email or "").strip() or None,
            delivery_address=address,
            delivery_notes=(delivery_notes or "").strip() or None,
            subtotal=subtotal,
            delivery_fee=fee,
            discount=disc,
            total=total,
            currency=(currency or "KES").upper()[:8],
            payment_method=payment_method,
            placed_by_user_id=None,
            placed_at=now,
            notes=combined_notes,
            external_order_id=ext_id,
            external_sync_status="received" if ext_id else None,
            created_at=now,
            updated_at=now,
        )
        self.db.add(order)
        self.db.flush()

        for line, inv_item, price, product_name, sku in resolved:
            self.db.add(
                OrderItem(
                    order_id=order.id,
                    inventory_item_id=inv_item.id if inv_item else None,
                    product_id=inv_item.product_id if inv_item else None,
                    product_name=product_name,
                    product_sku=sku,
                    quantity=int(line.get("quantity") or 0),
                    unit_price=price,
                    line_total=(price * int(line.get("quantity") or 0)).quantize(
                        Decimal("0.01"),
                    ),
                    notes=(line.get("notes") or None),
                    created_at=now,
                    updated_at=now,
                ),
            )

        self.db.add(
            OrderStatusHistory(
                order_id=order.id,
                from_status=None,
                to_status=PLACED,
                changed_by_user_id=None,
                note="Order placed via merchant API.",
                created_at=now,
            ),
        )

        try:
            if deduct_stock(
                self.db,
                [
                    (inv_item.id, int(line.get("quantity") or 0))
                    for line, inv_item, _, _, _ in resolved
                    if inv_item
                ],
                account_id=account_id,
            ):
                order.stock_deducted = True
        except InsufficientStockError as exc:
            self.db.rollback()
            raise IntegrationOrderError(str(exc)) from exc

        self.db.commit()
        self.db.refresh(order)

        try:
            from app.services.merchant_notification_service import MerchantNotificationService

            MerchantNotificationService(self.db).notify_order_status(order, PLACED)
        except Exception:
            logger.exception(
                "Merchant notification failed for API order_id=%s",
                order.id,
            )

        return order, True

    @staticmethod
    def order_response(order: Order) -> dict[str, Any]:
        from app.schemas import OrderOut

        return OrderOut.from_model(
            order,
            allowed_next=allowed_next_statuses(order.status, order.fulfillment_type),
        ).model_dump(mode="json")
