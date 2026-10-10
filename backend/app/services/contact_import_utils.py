"""Helpers shared by the customer and supplier spreadsheet importers."""

from __future__ import annotations

import re
import zipfile
from io import BytesIO
from typing import Any, Literal

from openpyxl import load_workbook
from openpyxl.workbook.workbook import Workbook

from app.services.rider_service import normalize_phone

ImportMode = Literal["merge", "replace"]

TOTAL_LABELS = {"total", "total:", "totals", "grand total", "grand total:"}

NO_LIMIT_WORDS = {"no limit", "nolimit", "unlimited", "none", "n/a", "na", "-", "--"}

_CURRENCY_PREFIX = re.compile(r"^(?:ksh?s?\.?|kes)\s*", re.IGNORECASE)


def _strip_styles(content: bytes) -> bytes | None:
    try:
        source = zipfile.ZipFile(BytesIO(content))
    except zipfile.BadZipFile:
        return None
    out = BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            if info.filename == "xl/styles.xml":
                continue
            target.writestr(info, source.read(info.filename))
    return out.getvalue()


def load_import_workbook(content: bytes) -> Workbook:
    """Open an uploaded .xlsx, falling back to ignoring styles.

    Some POS exports ship stylesheets openpyxl cannot parse; the cell values
    are still fine without them.
    """
    try:
        return load_workbook(filename=BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        stripped = _strip_styles(content)
        if stripped is not None:
            try:
                return load_workbook(filename=BytesIO(stripped), read_only=True, data_only=True)
            except Exception:
                pass
        raise ValueError("Could not read the Excel file. Upload a valid .xlsx file.") from exc


def is_total_row(raw: tuple[Any, ...] | list[Any]) -> bool:
    return any(
        isinstance(cell, str) and cell.strip().lower() in TOTAL_LABELS for cell in raw
    )


def is_repeated_header(
    raw: tuple[Any, ...] | list[Any],
    column_map: dict[str, int],
    aliases: dict[str, tuple[str, ...]],
) -> bool:
    """True for a header line pasted again mid-sheet (two or more cells are column names)."""
    hits = 0
    for field, idx in column_map.items():
        if idx >= len(raw) or not isinstance(raw[idx], str):
            continue
        if re.sub(r"\s+", " ", raw[idx].strip().lower()) in aliases.get(field, ()):
            hits += 1
    return hits >= 2


def clean_money_text(text: str) -> str:
    return _CURRENCY_PREFIX.sub("", text.strip()).replace(",", "").strip()


def is_no_limit(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() in NO_LIMIT_WORDS


def join_notes(*parts: str | None) -> str | None:
    return "; ".join(p for p in parts if p) or None


def contact_key(phone: str | None, name: str | None) -> str:
    """Duplicate key inside one file: the phone, or the name for rows without one."""
    if phone:
        return normalize_phone(phone)
    return "name:" + re.sub(r"\s+", " ", (name or "").strip().lower())


def phone_problem(phone: str, normalized: str) -> str | None:
    """Explain why a phone can't be used, or ``None`` when it looks fine."""
    digits = re.sub(r"\D", "", normalized or "")
    if not digits:
        return f"Phone '{phone}' has no digits."
    if len(digits) < 9:
        return f"Phone '{phone}' is too short."
    if len(digits) > 15:
        return f"Phone '{phone}' is too long."
    return None
