#!/usr/bin/env python3
"""Clean a Shiil POS item export into a TransChap inventory import CSV.

Input columns: ITEM_ID, DESCRIPTION, BAR_CODE, UOM, COST, PRICE, VAT_PERCENT,
ITEM_BAL, ... (comma-space separated). Each item has one row in the unit its
stock and prices are kept in. Pack units are split into pieces:

- CTN uses the piece count in the name (``QUENCHER 12*1 LTR`` -> 12), else 36;
- BAL 24, DZN 12, HBG 25, HCN 10, BAG 50;
- every other unit is one piece (PC / OUT / EA as Pcs, KG / KIL as Kg, JAR as Jar).

Usage: clean_shiil_inventory_export.py INPUT.csv OUTPUT.csv [NOTES.txt]
"""

from __future__ import annotations

import csv
import re
import sys
from collections import defaultdict

PACK_PIECES = {"CTN": 36, "BAL": 24, "DZN": 12, "HBG": 25, "HCN": 10, "BAG": 50}
PACK_FROM_NAME = {"CTN"}

UNIT_LABELS = {
    "PC": "Pcs",
    "PCS": "Pcs",
    "OUT": "Pcs",
    "EA": "Pcs",
    "01": "Pcs",
    "KG": "Kg",
    "KIL": "Kg",
    "JAR": "Jar",
    "CTN": "Ctn",
    "BAL": "Bale",
    "BAG": "Bag",
    "DZN": "Dozen",
    "HBG": "Half Bag",
    "HCN": "Half Ctn",
}

# Packs whose row is really one piece (identical PC row / per-piece prices).
SINGLE_PIECE_CODES = {"4311", "4488"}

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
    "applicable tax",
    "product_type",
]

# Prefer a row in a piece unit when an item has several rows.
ROW_PREFERENCE = {"PC": 0, "PCS": 0, "OUT": 1, "EA": 2}

SIZE_UNIT = r"(?:G|GM|GMS|GRM|KG|KGS|ML|L|LT|LTR|LTRS|LITRE|LITRES|CM|MM|M)\b"
_LEFT_COUNT = re.compile(r"(\d+)\s*([A-Z]*)\s*$")
_RIGHT_COUNT = re.compile(r"^\s*(\d+)\s*([A-Z]*)")
_PACK_COUNT = re.compile(r"(\d+)\s*(?:PCK|PACK|PCS)\b")
# Packs sold by weight / volume (TILLY 10KG, QUENCHER 12*1 LTR) stay in their own unit.
_KG_OR_LITRE = re.compile(r"\d\s*(?:KG|KGS|L|LT|LTR|LTRS|LITRE|LITRES|LITER|LITERS)\b")


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


def pieces_from_name(name: str) -> int | None:
    """Pieces per carton from ``24*500ML`` / ``500ML*18`` / ``2*20S`` / ``18PCK`` style names."""
    text = name.upper()
    parts = text.split("*")
    counts: list[tuple[int, int]] = []
    for i in range(len(parts) - 1):
        for side, match in (
            ("left", _LEFT_COUNT.search(parts[i])),
            ("right", _RIGHT_COUNT.search(parts[i + 1])),
        ):
            if not match:
                continue
            number, suffix = int(match.group(1)), match.group(2)
            if re.fullmatch(SIZE_UNIT, suffix or "-"):
                continue
            if side == "right" and not suffix:
                tail = parts[i + 1][match.end():]
                if re.match(r"\s*" + SIZE_UNIT, tail):
                    continue
            rank = {"S": 0, "": 1}.get(suffix, 2)
            counts.append((rank, number))
    if counts:
        best = min(counts, key=lambda c: c[0])[1]
        return best if best >= 2 else None
    match = _PACK_COUNT.search(text)
    if match and int(match.group(1)) >= 2:
        return int(match.group(1))
    return None


def _read(path: str) -> list[dict[str, str]]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle, skipinitialspace=True))
    header = [c.strip().upper() for c in rows[0]]
    out = []
    for line, row in enumerate(rows[1:], start=2):
        cells = [c.strip() for c in row]
        if not any(cells):
            continue
        record = {key: (cells[i] if i < len(cells) else "") for i, key in enumerate(header) if key}
        record["_line"] = str(line)
        out.append(record)
    return out


def clean(rows: list[dict[str, str]]) -> tuple[list[list[str]], list[str]]:
    notes: list[str] = []
    groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        row["DESCRIPTION"] = _clean_name(row.get("DESCRIPTION", ""))
        code = row.get("ITEM_ID", "").strip()
        if not code and not row["DESCRIPTION"]:
            continue
        groups[code or f"NAME:{row['DESCRIPTION'].upper()}"].append(row)

    for code, group in list(groups.items()):
        if group[0]["DESCRIPTION"].upper() == "TEST" and not any(_num(r.get("PRICE")) for r in group):
            notes.append(f"Code {code} 'TEST': placeholder item ({len(group)} rows) dropped.")
            del groups[code]

    codes_by_name: dict[str, set[str]] = defaultdict(set)
    for code, group in groups.items():
        codes_by_name[group[0]["DESCRIPTION"].upper()].add(code)
    duplicate_names = {name for name, codes in codes_by_name.items() if len(codes) > 1}

    out: list[list[str]] = []
    counts = {"pack": 0}
    for code, group in groups.items():
        group.sort(key=lambda r: ROW_PREFERENCE.get(r.get("UOM", "").upper(), 9))
        row = group[0]
        name = row["DESCRIPTION"]
        for extra in group[1:]:
            notes.append(
                f"Code {code} '{name}': extra {extra.get('UOM')} row (line {extra['_line']}) has the same "
                f"prices as the {row.get('UOM')} row - dropped.",
            )
        if name.upper() in duplicate_names:
            notes.append(f"Code {code}: name '{name}' is shared with another code; renamed to '{name} ({code})'.")
            name = f"{name} ({code})"

        uom = row.get("UOM", "").strip().upper()
        cost = _num(row.get("COST"))
        price = _num(row.get("PRICE"))
        balance = _num(row.get("ITEM_BAL")) or 0.0
        vat = _num(row.get("VAT_PERCENT"))
        tax = f"VAT {_qty(vat)}%" if vat is not None else ""
        sku = "" if code.startswith("NAME:") else code

        pieces = PACK_PIECES.get(uom)
        if pieces and code in SINGLE_PIECE_CODES:
            notes.append(
                f"Code {code} '{name}': listed as {uom} but priced per piece "
                f"(buy {_money(cost)}, sell {_money(price)}); imported as Pcs - check prices.",
            )
            pieces = None
            uom = "PC"
        elif pieces and _KG_OR_LITRE.search(name.upper()):
            notes.append(
                f"Code {code} '{name}': sold by kg / litre; kept as {UNIT_LABELS[uom]} "
                f"(stock {_qty(balance)}, buy {_money(cost)}, sell {_money(price)}), not split into pieces.",
            )
            pieces = None
        elif pieces and uom in PACK_FROM_NAME:
            from_name = pieces_from_name(name)
            if from_name:
                pieces = from_name

        if pieces:
            counts["pack"] += 1
            single_buy = cost / pieces if cost is not None else None
            single_sell = price / pieces if price is not None else None
            notes.append(
                f"Code {code} '{name}': {UNIT_LABELS[uom]} x{pieces} at buy {_money(cost)} / sell "
                f"{_money(price)} -> Pcs at {_money(single_buy)} / {_money(single_sell)}; "
                f"stock {_qty(balance)} {UNIT_LABELS[uom]} = {_qty(balance * pieces)} Pcs.",
            )
            record = [
                sku, name, "Pcs", _qty(balance * pieces), _money(single_buy), _money(single_sell),
                UNIT_LABELS[uom], str(pieces), _money(cost), _money(price),
            ]
        else:
            unit = UNIT_LABELS.get(uom, uom.title() or "Pcs")
            record = [sku, name, unit, _qty(balance), _money(cost), _money(price), "", "", "", ""]

        if cost is not None and price is not None and price < cost:
            notes.append(f"Code {code} '{name}': sells below cost ({_money(price)} < {_money(cost)}) - check prices.")
        if uom == "EA" and cost and cost >= 500 and balance == 0:
            notes.append(
                f"Code {code} '{name}': EA priced like a pack (buy {_money(cost)}); imported as 1 Pcs - "
                "check the unit.",
            )
        out.append([*record, "5", tax, "product"])
    notes.insert(0, f"{len(out)} items written ({counts['pack']} split from packs into pieces).")
    return out, notes


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 1
    out, notes = clean(_read(argv[1]))
    with open(argv[2], "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(OUT_HEADERS)
        writer.writerows(out)
    if len(argv) > 3:
        with open(argv[3], "w", encoding="utf-8") as handle:
            handle.write("\n".join(notes) + "\n")
    print("\n".join(notes))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
