"""Generate and host till-style receipt PDFs for WhatsApp / email links."""

from __future__ import annotations

import logging
from pathlib import Path

from fpdf import FPDF
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.uploads import (
    receipt_pdf_path,
    receipt_pdf_relative_url,
    save_receipt_pdf_bytes,
)
from app.models import Order
from app.services.product_media_service import absolute_media_url

logger = logging.getLogger(__name__)

PAGE_W = 80
MARGIN = 6
CONTENT_W = PAGE_W - (MARGIN * 2)


def _safe(text: object) -> str:
    raw = str(text or "").strip()
    # Helvetica core font is Latin-1; keep WhatsApp/PDF readable for local names.
    return raw.encode("latin-1", "replace").decode("latin-1")


def _money(amount: object, currency: str = "KES") -> str:
    try:
        value = float(amount or 0)
    except (TypeError, ValueError):
        value = 0.0
    return f"{currency} {value:,.2f}"


def build_order_receipt_pdf_bytes(
    order: Order,
    *,
    shop_name: str,
) -> bytes:
    """Build a simple one-page till PDF for ``order``."""
    currency = order.currency or "KES"
    pay = (order.payment_method or "other").replace("_", " ").title()
    if (order.payment_method or "") == "credit":
        pay = "On credit"
    elif (order.payment_method or "") == "mpesa":
        pay = "M-PESA"
    elif (order.payment_method or "") == "cash":
        pay = "Cash"

    pdf = FPDF(orientation="P", unit="mm", format=(PAGE_W, 200))
    pdf.set_auto_page_break(auto=True, margin=8)
    pdf.add_page()
    pdf.set_left_margin(MARGIN)
    pdf.set_right_margin(MARGIN)
    pdf.set_x(MARGIN)

    def line(text: str, *, bold: bool = False, size: int = 9, align: str = "L") -> None:
        pdf.set_font("Helvetica", "B" if bold else "", size)
        pdf.set_x(MARGIN)
        pdf.multi_cell(CONTENT_W, 5, _safe(text), align=align)

    line(shop_name or "DukAI", bold=True, size=12, align="C")
    line("Receipt", size=9, align="C")
    pdf.ln(1)
    line(f"Order: {order.order_number}")
    if order.customer_name:
        line(f"Customer: {order.customer_name}")
    line(f"Payment: {pay}")
    pdf.ln(1)

    items = list(order.items or [])
    if not items:
        line(f"Sale  {_money(order.total, currency)}")
    else:
        for item in items:
            name = (item.product_name or "Item").strip() or "Item"
            qty = int(item.quantity or 1)
            label = name if qty <= 1 else f"{qty} x {name}"
            amount = _money(item.line_total, currency)
            line(f"{label}")
            line(amount, align="R")

    pdf.ln(1)
    line(f"Total  {_money(order.total, currency)}", bold=True, size=10)
    pdf.ln(2)
    line("Thank you for shopping with us.", size=8, align="C")

    out = pdf.output()
    if isinstance(out, (bytes, bytearray)):
        return bytes(out)
    return str(out).encode("latin-1", "replace")


def ensure_order_receipt_pdf_url(
    db: Session,
    order: Order,
    *,
    shop_name: str,
    settings: Settings | None = None,
    force: bool = False,
) -> str | None:
    """Ensure a hosted PDF exists for ``order`` and return its absolute URL."""
    del db  # reserved for future DB caching of receipt URLs
    cfg = settings or get_settings()
    account_id = str(order.account_id or "").strip()
    order_id = str(order.id or "").strip()
    if not account_id or not order_id:
        return None

    path: Path = receipt_pdf_path(account_id=account_id, order_id=order_id)
    relative = receipt_pdf_relative_url(account_id=account_id, order_id=order_id)
    try:
        if force or not path.is_file() or path.stat().st_size < 64:
            body = build_order_receipt_pdf_bytes(order, shop_name=shop_name)
            save_receipt_pdf_bytes(account_id=account_id, order_id=order_id, body=body)
    except Exception:
        logger.exception("Could not build receipt PDF for order_id=%s", order_id)
        return None

    return absolute_media_url(relative, cfg) or None
