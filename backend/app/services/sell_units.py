"""Sell / buy units (piece, crate, dozen) with conversion to base stock qty."""

from __future__ import annotations

import re
from typing import Any

MIN_PACK_FACTOR = 2
MAX_PACK_FACTOR = 1_000_000

PACK_UNIT_ALIASES = frozenset(
    {
        "ctn",
        "ctns",
        "carton",
        "cartons",
        "box",
        "boxes",
        "bx",
        "crate",
        "crates",
        "tray",
        "trays",
        "bale",
        "bales",
        "bal",
        "bag",
        "bags",
        "jar",
        "jars",
        "out",
        "pkt",
        "pkts",
        "pack",
        "packs",
        "outer",
        "outers",
    },
)
DOZEN_UNIT_ALIASES = frozenset({"dozen", "dozens", "doz", "dz", "dzn"})
PIECE_UNIT_ALIASES = frozenset(
    {"pcs", "pc", "piece", "pieces", "each", "ea", "unit", "units", "nos", "no"},
)

_MEASURE = r"(?:ml|cl|ltrs?|litres?|liters?|l|kgs?|g|gms?|grams?|mg|oz|cm|mm|m|w|v|mah|inch|in)"
_NOT_MEASURE = rf"(?!\s*\.?\d)(?!\s*{_MEASURE}\b)"

# Ordered from most to least specific.
_FACTOR_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    # 24x500ml / 24 x 1L -> 24
    (re.compile(rf"\b(\d+)\s*[x×*]\s*\d+(?:\.\d+)?\s*{_MEASURE}\b", re.I), "first"),
    # 6x4 / 1x24 -> 24
    (re.compile(rf"\b(\d+)\s*[x×*]\s*(\d+)\b{_NOT_MEASURE}", re.I), "product"),
    # x24 -> 24
    (re.compile(rf"(?:^|\s)[x×*]\s*(\d+)\b{_NOT_MEASURE}", re.I), "first"),
    # 24s / 24's / 30 pcs / 12 pieces
    (
        re.compile(
            r"\b(\d+)\s*(?:['’]s\b|s\b|pcs\b|pc\b|pieces?\b|units?\b|nos\b|tabs?\b"
            r"|sachets?\b|packets?\b|pkts?\b|eggs?\b|bottles?\b|cans?\b|rolls?\b|bars?\b)",
            re.I,
        ),
        "first",
    ),
    # (24)
    (re.compile(r"\((\d+)\)"), "first"),
    # tray of 30 / pack per 24
    (re.compile(r"\b(?:of|per)\s+(\d+)\b" + _NOT_MEASURE, re.I), "first"),
)


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _normalize_name(name: str | None) -> str:
    return (name or "").strip().lower()


def base_unit_name(item: Any) -> str:
    product = getattr(item, "product", None)
    unit = getattr(product, "unit", None) if product is not None else None
    label = (unit or "").strip()
    return label or "Piece"


def pack_units_from_attributes(attributes: Any) -> list[dict[str, Any]]:
    raw = _as_dict(attributes).get("sell_units")
    if not isinstance(raw, list):
        return []
    packs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        if not name:
            continue
        key = _normalize_name(name)
        if key in seen:
            continue
        try:
            factor = int(entry.get("factor"))
        except (TypeError, ValueError):
            continue
        if factor < 2 or factor > 1_000_000:
            continue
        seen.add(key)
        pack: dict[str, Any] = {"name": name, "factor": factor}
        for price_key in ("selling_price", "buying_price"):
            raw_price = entry.get(price_key)
            if raw_price is None or raw_price == "":
                continue
            try:
                price = float(raw_price)
            except (TypeError, ValueError):
                continue
            if price >= 0:
                pack[price_key] = round(price, 2)
        packs.append(pack)
    return packs


def sell_units_for_item(item: Any) -> list[dict[str, Any]]:
    """Return base unit + configured packs for an inventory item."""
    base_name = base_unit_name(item)
    base_sell = (
        float(item.selling_price)
        if getattr(item, "selling_price", None) is not None
        else None
    )
    base_buy = (
        float(item.buying_price)
        if getattr(item, "buying_price", None) is not None
        else None
    )
    units: list[dict[str, Any]] = [
        {
            "name": base_name,
            "factor": 1,
            "selling_price": base_sell,
            "buying_price": base_buy,
        }
    ]
    for pack in pack_units_from_attributes(getattr(item, "attributes", None)):
        if _normalize_name(pack["name"]) == _normalize_name(base_name):
            continue
        factor = int(pack["factor"])
        if pack.get("selling_price") is None and base_sell is not None:
            pack["selling_price"] = round(base_sell * factor, 2)
        if pack.get("buying_price") is None and base_buy is not None:
            pack["buying_price"] = round(base_buy * factor, 2)
        units.append(pack)
    return units


def resolve_sell_unit(item: Any, sell_unit: str | None) -> dict[str, Any]:
    """Match a requested sell unit, defaulting to the base unit."""
    units = sell_units_for_item(item)
    if not sell_unit or not str(sell_unit).strip():
        return units[0]
    wanted = _normalize_name(str(sell_unit))
    for unit in units:
        if _normalize_name(unit["name"]) == wanted:
            return unit
    raise ValueError(f"Unknown sell unit “{sell_unit.strip()}”.")


def normalize_sell_units_payload(raw: Any) -> list[dict[str, Any]]:
    """Validate and clean a sell_units list for storage on inventory attributes."""
    return pack_units_from_attributes({"sell_units": raw if isinstance(raw, list) else []})


def _valid_factor(value: Any) -> int | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not number.is_integer():
        return None
    factor = int(number)
    if factor < MIN_PACK_FACTOR or factor > MAX_PACK_FACTOR:
        return None
    return factor


def pack_factor_from_name(name: str | None) -> int | None:
    """Pieces per pack parsed from a product name (``Coke 24x500ml``, ``Eggs 30s``)."""
    text = (name or "").strip()
    if not text:
        return None
    for pattern, mode in _FACTOR_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        if mode == "product":
            factor = _valid_factor(int(match.group(1)) * int(match.group(2)))
        else:
            factor = _valid_factor(match.group(1))
        if factor is not None:
            return factor
    return None


def infer_pack_factor(
    pack_price: float | None,
    piece_price: float | None,
    tolerance: float = 0.02,
) -> int | None:
    """Pieces per pack from a pack price vs piece price (2366.4 / 197.2 -> 12)."""
    if not pack_price or not piece_price or pack_price <= 0 or piece_price <= 0:
        return None
    ratio = pack_price / piece_price
    factor = round(ratio)
    if factor < MIN_PACK_FACTOR or abs(ratio - factor) > factor * tolerance:
        return None
    return _valid_factor(factor)


def unit_kind(unit: str | None) -> str | None:
    """Classify an Excel unit label as ``pack``, ``dozen``, ``piece`` or None (other)."""
    key = re.sub(r"[^a-z]", "", _normalize_name(unit))
    if not key:
        return None
    if key in PACK_UNIT_ALIASES:
        return "pack"
    if key in DOZEN_UNIT_ALIASES:
        return "dozen"
    if key in PIECE_UNIT_ALIASES:
        return "piece"
    return None


def detect_pack(
    unit: str | None,
    name: str | None,
    pack_size: Any = None,
) -> tuple[str, int | None] | None:
    """Detect a pack unit for an imported row.

    Returns ``(pack_label, pieces_per_pack)`` when ``unit`` is a pack or dozen
    unit, else None. ``pieces_per_pack`` is None when it is a pack unit but the
    size is neither given nor parseable from the name.
    """
    kind = unit_kind(unit)
    label = (unit or "").strip()[:64]
    explicit = _valid_factor(pack_size)
    if explicit is not None and label and kind != "piece":
        return label, explicit
    if kind not in {"pack", "dozen"}:
        return None
    if kind == "dozen":
        return label, 12
    return label, pack_factor_from_name(name)


def merge_pack_into_attributes(
    attributes: Any,
    pack: dict[str, Any],
) -> dict[str, Any]:
    """Add or replace a pack (by name) in ``attributes.sell_units``."""
    attrs = dict(_as_dict(attributes))
    key = _normalize_name(pack.get("name"))
    existing = [
        entry
        for entry in pack_units_from_attributes(attrs)
        if _normalize_name(entry["name"]) != key
    ]
    packs = normalize_sell_units_payload([*existing, pack])
    if packs:
        attrs["sell_units"] = packs
    else:
        attrs.pop("sell_units", None)
    return attrs


def buy_units_from_attributes(attributes: Any) -> list[dict[str, Any]]:
    """Restaurant purchase units (``attributes.buy_units``), e.g. 50kg bag or 500g pack.

    Unlike sell packs, the factor may be fractional (0.5 kg pack) as long as it
    is positive and not 1.
    """
    raw = _as_dict(attributes).get("buy_units")
    if not isinstance(raw, list):
        return []
    units: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()[:64]
        key = _normalize_name(name)
        if not name or key in seen:
            continue
        try:
            factor = round(float(entry.get("factor")), 4)
        except (TypeError, ValueError):
            continue
        if factor <= 0 or factor == 1 or factor > 1_000_000:
            continue
        seen.add(key)
        unit: dict[str, Any] = {"name": name, "factor": factor}
        try:
            price = float(entry.get("buying_price"))
        except (TypeError, ValueError):
            price = None
        if price is not None and price >= 0:
            unit["buying_price"] = round(price, 2)
        units.append(unit)
    return units


def normalize_buy_units_payload(raw: Any) -> list[dict[str, Any]]:
    return buy_units_from_attributes({"buy_units": raw if isinstance(raw, list) else []})


def buy_units_for_item(item: Any) -> list[dict[str, Any]]:
    """Units a restaurant supply can be bought in: base unit, buy units, then sell packs."""
    base_name = base_unit_name(item)
    base_buy = (
        float(item.buying_price)
        if getattr(item, "buying_price", None) is not None
        else None
    )
    units: list[dict[str, Any]] = [{"name": base_name, "factor": 1, "buying_price": base_buy}]
    seen = {_normalize_name(base_name)}
    attributes = getattr(item, "attributes", None)
    candidates = buy_units_from_attributes(attributes) + [
        {key: pack[key] for key in ("name", "factor", "buying_price") if key in pack}
        for pack in pack_units_from_attributes(attributes)
    ]
    for unit in candidates:
        key = _normalize_name(unit["name"])
        if key in seen:
            continue
        seen.add(key)
        if unit.get("buying_price") is None and base_buy is not None:
            unit["buying_price"] = round(base_buy * float(unit["factor"]), 2)
        units.append(unit)
    return units
