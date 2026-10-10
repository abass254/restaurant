"""Sell / buy units (piece, crate, dozen) with conversion to base stock qty."""

from __future__ import annotations

from typing import Any


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
