"""Generate and host till-style receipt PDFs for WhatsApp / email links."""

from __future__ import annotations

from datetime import datetime, timezone
import io
import logging
from pathlib import Path
from zoneinfo import ZoneInfo

from fpdf import FPDF
import qrcode
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.uploads import (
    receipt_pdf_path,
    receipt_pdf_relative_url,
    save_receipt_pdf_bytes,
)
from app.models import Order
from app.services.product_media_service import absolute_media_url
from app.support.order_payments import payment_summary

logger = logging.getLogger(__name__)

PAGE_W = 80
MARGIN = 7
CONTENT_W = PAGE_W - (MARGIN * 2)
MID_X = PAGE_W / 2.0
NAIROBI = ZoneInfo("Africa/Nairobi")

PAPER = (246, 238, 227)
INK = (28, 20, 16)
MUTED = (110, 97, 86)
ACCENT = (35, 134, 54)
PAID = (21, 128, 61)
CREDIT = (194, 65, 12)
WAIT = (180, 83, 9)
FAIL = (190, 18, 60)

TRANSCHAP_LOGO_SVG = b"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path d="M15 11h24a4 4 0 0 1 4 4v34a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4V15a4 4 0 0 1 4-4z" fill="none" stroke="#20154c" stroke-width="3" stroke-linejoin="round"/>
  <path d="M20 22h14M20 30h14M20 38h8" fill="none" stroke="#20154c" stroke-width="3" stroke-linecap="round"/>
  <path fill="#77f665" d="M46 6 34 30h9L36 58l18-30h-9L54 6z"/>
</svg>"""


def _safe(text: object) -> str:
    raw = str(text or "").strip()
    return raw.encode("latin-1", "replace").decode("latin-1")


def _money(amount: object, currency: str = "KES") -> str:
    try:
        value = float(amount or 0)
    except (TypeError, ValueError):
        value = 0.0
    return f"{currency} {value:,.2f}"


def _format_num(amount: object) -> str:
    try:
        value = float(amount or 0)
    except (TypeError, ValueError):
        value = 0.0
    return f"{value:,.2f}"


def _mpesa_receipt(order: Order) -> str | None:
    txn = getattr(order, "mpesa_transaction", None)
    code = str(getattr(txn, "mpesa_receipt_number", None) or "").strip()
    if code:
        return code
    for item in getattr(order, "mpesa_transactions", None) or []:
        code = str(getattr(item, "mpesa_receipt_number", None) or "").strip()
        if code:
            return code
    return None


def _status_info(order: Order) -> tuple[str, tuple[int, int, int]]:
    st = (order.status or "").lower()
    pay_method = (order.payment_method or "").lower()
    if st in ("cancelled", "voided"):
        return "VOIDED", FAIL
    if st == "refunded":
        return "REFUNDED", FAIL
    if pay_method == "credit":
        return "INVOICE", CREDIT
    if pay_method == "mpesa" and st == "placed" and not getattr(order, "paid_at", None):
        return "WAITING", WAIT
    return "PAID", PAID


def _estimate_page_height(order: Order, items: list) -> float:
    h = 88.0
    for item in items:
        h += 6.5
        qty = int(getattr(item, "quantity", 1) or 1)
        if qty > 1:
            h += 4.5
        mods = getattr(item, "modifiers", None) or []
        h += len(mods) * 3.5

    adjustments = [
        float(order.delivery_fee or 0),
        float(order.tax or 0),
        float(order.discount or 0),
        float(order.returned_total or 0),
    ]
    if any(a > 0 for a in adjustments):
        h += 6.0 + sum(5.0 for a in adjustments if a > 0)

    if _mpesa_receipt(order):
        h += 15.0

    meta_count = 2  # Ref, When
    if order.table_number:
        meta_count += 1
    if order.customer_phone:
        meta_count += 1
    h += meta_count * 5.5

    h += 38.0  # footer QR, barcode, ASANTE
    return max(150.0, h)


def build_order_receipt_pdf_bytes(
    order: Order,
    *,
    shop_name: str,
) -> bytes:
    """Build an authentic styled till-receipt PDF for ``order``."""
    currency = order.currency or "KES"
    status_label, status_color = _status_info(order)
    mpesa_code = _mpesa_receipt(order)

    pay_label = (order.payment_method or "other").replace("_", " ").title()
    if (order.payment_method or "") == "credit":
        pay_label = "On credit"
    elif (order.payment_method or "") == "mpesa":
        pay_label = "M-PESA"
    elif (order.payment_method or "") == "cash":
        pay_label = "Cash"
    elif (order.payment_method or "") == "split":
        pay_label = payment_summary(order, currency)

    customer = (order.customer_name or "").strip() or "Walk-in"
    payline = f"{pay_label}  ·  {customer}"

    items = list(order.items or [])
    if not items:
        # Fallback pseudo-item
        class _Single:
            product_name = "Sale"
            quantity = 1
            unit_price = order.total
            line_total = order.total
            modifiers = None

        items = [_Single()]

    page_h = _estimate_page_height(order, items)

    pdf = FPDF(orientation="P", unit="mm", format=(PAGE_W, page_h))
    pdf.set_auto_page_break(False)
    pdf.add_page()

    # 1. Paper background
    pdf.set_fill_color(*PAPER)
    pdf.rect(0, 0, PAGE_W, page_h, style="F")

    # 2. Top accent bar
    pdf.set_fill_color(*ACCENT)
    pdf.rect(10, 5, PAGE_W - 20, 1.2, style="F", round_corners=True, corner_radius=0.6)

    # 3. TransChap Logo mark
    try:
        pdf.image(io.BytesIO(TRANSCHAP_LOGO_SVG), x=MID_X - 4.5, y=8.5, w=9, h=9)
    except Exception:
        pass

    y = 19.5

    # 4. Shop name
    pdf.set_text_color(*INK)
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_xy(MARGIN, y)
    pdf.cell(CONTENT_W, 6, _safe(shop_name or "TransChap"), align="C")
    y += 6.5

    # 5. Title
    pdf.set_text_color(*MUTED)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_xy(MARGIN, y)
    pdf.cell(CONTENT_W, 4, "INVOICE" if status_label == "INVOICE" else "TILL RECEIPT", align="C")
    y += 7.0

    # 6. Status stamp (PAID / WAITING / INVOICE / VOIDED / REFUNDED)
    stamp_w = max(26.0, pdf.get_string_width(status_label) + 8.0)
    stamp_h = 6.5
    stamp_x = MID_X - stamp_w / 2.0
    with pdf.rotation(angle=-2.8, x=MID_X, y=y + stamp_h / 2.0):
        pdf.set_draw_color(*status_color)
        pdf.set_line_width(0.55)
        pdf.rect(stamp_x, y, stamp_w, stamp_h, style="D", round_corners=True, corner_radius=1.2)
        pdf.set_text_color(*status_color)
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_xy(stamp_x, y + 0.8)
        pdf.cell(stamp_w, 5, status_label, align="C")
    y += 10.5

    # 7. Hero amount
    pdf.set_text_color(*MUTED)
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_xy(MARGIN, y)
    pdf.cell(CONTENT_W, 4, currency, align="C")
    y += 5.5

    pdf.set_text_color(*INK)
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_xy(MARGIN, y)
    pdf.cell(CONTENT_W, 8, _format_num(order.total), align="C")
    y += 8.5

    # 8. Payline (e.g. M-PESA · Walk-in)
    pdf.set_text_color(*MUTED)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_xy(MARGIN, y)
    pdf.cell(CONTENT_W, 4, _safe(payline), align="C")
    y += 7.0

    # 9. M-PESA Code Box (if available)
    if mpesa_code:
        pdf.set_dash_pattern(1.1, 0.9)
        pdf.set_draw_color(*INK)
        pdf.set_line_width(0.35)
        pdf.rect(MARGIN, y, CONTENT_W, 11, style="D", round_corners=True, corner_radius=1.5)
        pdf.set_dash_pattern(0)
        pdf.set_font("Helvetica", "B", 7)
        pdf.set_text_color(*MUTED)
        pdf.set_xy(MARGIN, y + 1.2)
        pdf.cell(CONTENT_W, 3.5, "M-PESA CODE", align="C")
        pdf.set_font("Helvetica", "B", 10.5)
        pdf.set_text_color(*INK)
        pdf.set_xy(MARGIN, y + 4.8)
        pdf.cell(CONTENT_W, 5, _safe(mpesa_code), align="C")
        y += 15.0

    def draw_dash(curr_y: float) -> None:
        pdf.set_dash_pattern(1.2, 1.1)
        pdf.set_draw_color(*MUTED)
        pdf.set_line_width(0.2)
        pdf.line(MARGIN, curr_y, MARGIN + CONTENT_W, curr_y)
        pdf.set_dash_pattern(0)

    draw_dash(y)
    y += 5.0

    # 10. Items list
    for item in items:
        name = _safe(getattr(item, "product_name", None) or "Item")
        qty = int(getattr(item, "quantity", 1) or 1)
        line_total = getattr(item, "line_total", 0)
        price_str = _format_num(line_total)

        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*INK)
        name_w = pdf.get_string_width(name)
        price_w = pdf.get_string_width(price_str)

        pdf.text(MARGIN, y + 3.5, name)
        pdf.text(MARGIN + CONTENT_W - price_w, y + 3.5, price_str)

        # Dotted leader between item name and price
        leader_start = MARGIN + name_w + 1.5
        leader_end = MARGIN + CONTENT_W - price_w - 1.5
        if leader_end > leader_start:
            pdf.set_dash_pattern(0.4, 0.8)
            pdf.set_draw_color(*MUTED)
            pdf.set_line_width(0.18)
            pdf.line(leader_start, y + 3.5, leader_end, y + 3.5)
            pdf.set_dash_pattern(0)

        y += 5.0

        if qty > 1:
            unit_price = getattr(item, "unit_price", 0)
            sub_label = f"{qty} x {_format_num(unit_price)}"
            pdf.set_font("Helvetica", "", 7.5)
            pdf.set_text_color(*MUTED)
            pdf.text(MARGIN, y + 2.5, sub_label)
            y += 4.0

        mods = getattr(item, "modifiers", None) or []
        for mod in mods:
            mod_name = mod.get("name") if isinstance(mod, dict) else getattr(mod, "name", "")
            mod_price = mod.get("price", 0) if isinstance(mod, dict) else getattr(mod, "price", 0)
            pdf.set_font("Helvetica", "", 7.5)
            pdf.set_text_color(*MUTED)
            m_str = f"+ {_safe(mod_name)}"
            if float(mod_price or 0) > 0:
                m_str += f" ({_format_num(mod_price)})"
            pdf.text(MARGIN + 2, y + 2.5, m_str)
            y += 3.5

        y += 1.5

    # 11. Adjustments (if any)
    subtotal = float(order.subtotal or 0)
    adjustments: list[tuple[str, float, bool]] = []
    if float(order.delivery_fee or 0) > 0:
        adjustments.append(("Delivery fee", float(order.delivery_fee), False))
    if float(order.discount or 0) > 0:
        adjustments.append(("Discount", float(order.discount), True))
    if float(order.tax or 0) > 0:
        adjustments.append(("Tax", float(order.tax), False))
    if float(order.returned_total or 0) > 0:
        adjustments.append(("Goods on return", float(order.returned_total), True))

    if adjustments:
        y += 1.0
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(*MUTED)
        pdf.text(MARGIN, y + 3.0, "Subtotal")
        sw = pdf.get_string_width(_format_num(subtotal))
        pdf.text(MARGIN + CONTENT_W - sw, y + 3.0, _format_num(subtotal))
        y += 4.5
        for label, val, is_neg in adjustments:
            pdf.text(MARGIN, y + 3.0, label)
            v_str = f"-{_format_num(val)}" if is_neg else _format_num(val)
            vw = pdf.get_string_width(v_str)
            pdf.text(MARGIN + CONTENT_W - vw, y + 3.0, v_str)
            y += 4.5

    # 12. Solid total line & TOTAL
    y += 1.0
    pdf.set_draw_color(*INK)
    pdf.set_line_width(0.5)
    pdf.line(MARGIN, y, MARGIN + CONTENT_W, y)
    y += 4.0

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*INK)
    total_title = "NET TOTAL" if float(order.returned_total or 0) > 0 else "TOTAL"
    pdf.text(MARGIN, y + 3.5, total_title)
    pdf.set_font("Helvetica", "B", 12)
    net_total = max(0.0, float(order.total or 0) - float(order.returned_total or 0))
    tot_str = _format_num(net_total)
    tot_w = pdf.get_string_width(tot_str)
    pdf.text(MARGIN + CONTENT_W - tot_w, y + 3.5, tot_str)
    y += 8.5

    # 13. Metadata rows
    stamp_dt = order.paid_at or getattr(order, "placed_at", None) or getattr(order, "created_at", None)
    when_str = "—"
    if stamp_dt:
        aware = stamp_dt.replace(tzinfo=timezone.utc) if stamp_dt.tzinfo is None else stamp_dt
        when_str = aware.astimezone(NAIROBI).strftime("%H:%M %d/%m/%Y")

    meta_rows: list[tuple[str, str]] = []
    if order.table_number:
        meta_rows.append(("Table", str(order.table_number)))
    meta_rows.append(("Ref", order.order_number))
    meta_rows.append(("When", when_str))
    if order.customer_phone:
        meta_rows.append(("Phone", str(order.customer_phone)))

    for label, val in meta_rows:
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(*MUTED)
        pdf.text(MARGIN, y + 3.0, label)

        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(*INK)
        vw = pdf.get_string_width(val)
        pdf.text(MARGIN + CONTENT_W - vw, y + 3.0, _safe(val))
        y += 5.5

    y += 1.5
    draw_dash(y)
    y += 6.0

    # 14. Footer: QR code on left, Barcode + ASANTE on right
    qr_size = 18.0
    try:
        qr = qrcode.QRCode(box_size=1, border=0, error_correction=qrcode.constants.ERROR_CORRECT_M)
        qr_summary = f"{order.order_number} Confirmed. {currency} {_format_num(order.total)} at {shop_name}"
        qr.add_data(qr_summary)
        qr.make(fit=True)
        matrix = qr.get_matrix()
        qr_n = len(matrix)
        mod_size = qr_size / float(qr_n)

        qr_x = MARGIN
        qr_y = y
        pdf.set_fill_color(*INK)
        for r in range(qr_n):
            for c in range(qr_n):
                if matrix[r][c]:
                    pdf.rect(qr_x + c * mod_size, qr_y + r * mod_size, mod_size, mod_size, style="F")
    except Exception:
        pass

    # Barcode
    bx = MARGIN + qr_size + 4.0
    bw = CONTENT_W - qr_size - 4.0
    bar_h = 6.5
    seed = f"{order.order_number}{order.order_number}{order.order_number}".replace(" ", "")[:28]
    units = []
    for ch in seed:
        n = ord(ch)
        units.extend([1 + (n % 4), 1 + ((n // 3) % 2)])
    total_units = sum(units) or 1
    unit_w = bw / float(total_units)
    curr_bx = bx
    pdf.set_fill_color(*INK)
    for idx, u in enumerate(units):
        w = u * unit_w
        if idx % 2 == 0:
            pdf.rect(curr_bx, y, w, bar_h, style="F")
        curr_bx += w

    # ASANTE & Thanks
    pdf.set_xy(bx, y + bar_h + 2.0)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*INK)
    pdf.cell(bw, 4, "ASANTE", align="L")

    pdf.set_xy(bx, y + bar_h + 6.0)
    pdf.set_font("Helvetica", "", 7.5)
    pdf.set_text_color(*MUTED)
    pdf.cell(bw, 3.5, "Thank you for shopping with us", align="L")

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
