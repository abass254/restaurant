#!/usr/bin/env python3
"""Clean a POS inventory export that lists one row per unit (PC / CTN / OUT / BAL…).

Input columns: Name, BarCode (item code), UOM, BuyingPrice, SellingPrice, ItemsBalance.
Rows sharing an item code are the same product. The output is a TransChap import CSV
with one row per item id:

- the single unit (PC, or OUT when there is no PC - both shown as "Pcs") carries
  the stock and the single buying / selling price;
- the largest pack (Ctn, Bale, Bag, Dozen…) becomes the bulk unit, with
  qty_per_bulk from the buying-price ratio and its own prices.

Usage: clean_uom_inventory_export.py INPUT.csv OUTPUT.csv [NOTES.txt]
"""

from __future__ import annotations

import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.services.sell_units import pack_factor_from_name  # noqa: E402

# Smaller rank = smaller unit; the smallest unit present becomes the base.
UNIT_RANK = {
    "PC": 0,
    "PCS": 0,
    "KIL": 0,
    "KG": 0,
    "OUT": 1,
    "DZN": 1,
    "JAR": 2,
    "BAG": 2,
    "BAL": 2,
    "CTN": 3,
}

UNIT_LABELS = {
    "PC": "Pcs",
    "PCS": "Pcs",
    "CTN": "Ctn",
    "OUT": "Outer",
    "BAL": "Bale",
    "BAG": "Bag",
    "JAR": "Jar",
    "KIL": "Kg",
    "KG": "Kg",
    "DZN": "Dozen",
}

OUT_HEADERS = [
    "item_id",
    "name",
    "unit",
    "quantity",
    "single_buying_price",
    "single_price",
    "bulk_unit",
    "qty_per_bulk",
    "bulk_buying_price",
    "bulk_price",
    "low_stock_threshold",
    "product_type",
]

# The single unit is shown as Pcs when it is a PC or an out-of-pack OUT.
SINGLE_AS_PCS = {"PC", "PCS", "OUT"}

RATIO_TOLERANCE = 0.02


def _num(value: str | None) -> float | None:
    text = (value or "").strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _money(value: float | None) -> str:
    return "" if value is None else f"{value:.2f}"


def _qty(value: float | None) -> str:
    if value is None:
        return ""
    rounded = round(value, 3)
    return str(int(rounded)) if rounded.is_integer() else str(rounded)


def _clean_name(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _whole_ratio(pack: float | None, base: float | None) -> int | None:
    if not pack or not base or pack <= 0 or base <= 0:
        return None
    ratio = pack / base
    factor = round(ratio)
    if factor < 2 or abs(ratio - factor) > factor * RATIO_TOLERANCE:
        return None
    return factor


def _unit_label(raw: str) -> str:
    code = (raw or "").strip().upper()
    return UNIT_LABELS.get(code, code.title() or "Pcs")


def clean(rows: list[dict[str, str]]) -> tuple[list[list[str]], list[str]]:
    notes: list[str] = []
    groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for index, row in enumerate(rows, start=2):
        name = _clean_name(row.get("Name", ""))
        code = (row.get("BarCode") or row.get("SKU") or "").strip()
        if not name and not code:
            notes.append(f"Row {index}: blank row dropped.")
            continue
        if not code:
            code = f"NAME:{name.upper()}"
        groups[code].append({**row, "Name": name, "_line": str(index)})

    # Same name on different codes would merge on import (name matching); suffix the code.
    codes_by_name: dict[str, set[str]] = defaultdict(set)
    for code, group in groups.items():
        codes_by_name[group[0]["Name"].upper()].add(code)
    duplicate_names = {name for name, codes in codes_by_name.items() if len(codes) > 1}

    out: list[list[str]] = []
    for code, group in groups.items():
        group.sort(
            key=lambda r: (
                UNIT_RANK.get((r.get("UOM") or "").strip().upper(), 2),
                _num(r.get("BuyingPrice")) or float("inf"),
                _num(r.get("SellingPrice")) or float("inf"),
            ),
        )
        base = group[0]
        name = base["Name"]
        if name.upper() in duplicate_names:
            notes.append(f"Code {code}: name '{name}' is shared with another code; renamed to '{name} ({code})'.")
            name = f"{name} ({code})"
        names = {r["Name"] for r in group}
        if len(names) > 1:
            notes.append(f"Code {code}: different names {sorted(names)}; using '{name}'.")

        base_unit = _unit_label(base.get("UOM", ""))
        base_buy = _num(base.get("BuyingPrice"))
        base_sell = _num(base.get("SellingPrice"))
        base_qty = _num(base.get("ItemsBalance"))
        sku = "" if code.startswith("NAME:") else code
        threshold = base.get("Low Stock Threshold", "").strip() or "5"

        packs: list[tuple[dict[str, str], str, int]] = []
        sources: list[str] = []
        seen_units = {base_unit}
        for pack in group[1:]:
            unit = _unit_label(pack.get("UOM", ""))
            pack_buy = _num(pack.get("BuyingPrice"))
            pack_sell = _num(pack.get("SellingPrice"))
            if unit in seen_units:
                notes.append(f"Code {code} '{name}': duplicate {unit} row (line {pack['_line']}) dropped.")
                continue
            factor = _whole_ratio(pack_buy, base_buy)
            source = "buy"
            if factor is None:
                factor = _whole_ratio(pack_sell, base_sell) or pack_factor_from_name(name)
                source = "other"
            if factor is None:
                notes.append(
                    f"Code {code} '{name}': {pack.get('UOM')} row (line {pack['_line']}) - pieces per "
                    f"{unit} can't be worked out (buy {_money(pack_buy)} vs {base_unit} "
                    f"{_money(base_buy)}, sell {_money(pack_sell)} vs {_money(base_sell)}) - dropped. "
                    "Add it on the item with the correct pieces per pack.",
                )
                continue
            seen_units.add(unit)
            packs.append((pack, unit, factor))
            sources.append(source)

        # A pack sized by sell price / name whose cost implies a much cheaper base unit.
        buy_sized = "buy" in sources
        for (pack, unit, factor), source in zip(packs, sources):
            pack_buy = _num(pack.get("BuyingPrice"))
            if source == "buy" or not pack_buy or not base_buy:
                continue
            if base_buy <= pack_buy / factor * 1.5:
                continue
            if buy_sized:
                notes.append(
                    f"Code {code} '{name}': {unit} row (line {pack['_line']}) prices conflict with "
                    f"{base_unit} ({_money(pack_buy)} for {factor} vs {_money(base_buy)} each) - "
                    "dropped; review this item's prices and add the pack manually.",
                )
                packs = [p for p in packs if p[0] is not pack]
                break
            fixed = round(pack_buy / factor, 2)
            notes.append(
                f"Code {code} '{name}': {base_unit} buying price {_money(base_buy)} is out of line "
                f"with {unit} ({_money(pack_buy)} / {factor}); corrected to {_money(fixed)}.",
            )
            base_buy = fixed
            break

        if base_sell is not None and base_buy is not None and base_sell < base_buy:
            notes.append(
                f"Code {code} '{name}': {base_unit} sells below cost "
                f"({_money(base_sell)} < {_money(base_buy)}) - check prices.",
            )

        for pack, unit, factor in packs:
            pack_qty = _num(pack.get("ItemsBalance"))
            if pack_qty and base_qty is not None:
                expected = pack_qty * factor
                if abs(expected - base_qty) > max(1.0, 0.1 * base_qty):
                    notes.append(
                        f"Code {code} '{name}': {unit} balance {_qty(pack_qty)} x {factor} = "
                        f"{_qty(expected)} vs {base_unit} balance {_qty(base_qty)}; "
                        f"kept {_qty(base_qty)} {base_unit}.",
                    )

        bulk = max(packs, key=lambda p: p[2]) if packs else None
        for pack, unit, factor in packs:
            if bulk is not None and pack is not bulk[0]:
                notes.append(
                    f"Code {code} '{name}': middle unit {unit} x{factor} "
                    f"(buy {_money(_num(pack.get('BuyingPrice')))}, sell "
                    f"{_money(_num(pack.get('SellingPrice')))}) not included; bulk is "
                    f"{bulk[1]} x{bulk[2]}.",
                )

        single_code = (base.get("UOM") or "").strip().upper()
        single_unit = "Pcs" if single_code in SINGLE_AS_PCS else base_unit
        out.append(
            [
                sku,
                name,
                single_unit,
                _qty(base_qty if base_qty is not None else 0),
                _money(base_buy),
                _money(base_sell),
                bulk[1] if bulk else "",
                str(bulk[2]) if bulk else "",
                _money(_num(bulk[0].get("BuyingPrice"))) if bulk else "",
                _money(_num(bulk[0].get("SellingPrice"))) if bulk else "",
                threshold,
                "product",
            ],
        )
    return out, notes


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 1
    src, dst = argv[1], argv[2]
    notes_path = argv[3] if len(argv) > 3 else None
    with open(src, encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    out, notes = clean(rows)
    with open(dst, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(OUT_HEADERS)
        writer.writerows(out)
    if notes_path:
        with open(notes_path, "w", encoding="utf-8") as handle:
            handle.write("\n".join(notes) + "\n")
    with_bulk = sum(1 for row in out if row[7])
    print(f"{len(rows)} input rows -> {len(out)} items ({with_bulk} with a bulk unit)")
    print(f"{len(notes)} notes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
