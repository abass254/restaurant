"""Copy attributes.barcode into products.sku where sku is empty.

Imports and some catalog rows store the scan code under attributes.barcode
while leaving sku NULL. SKU is the primary display / match field for Trans Chap
and inventory tables.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402


def _barcode_from_attributes(raw) -> str | None:
    if raw is None:
        return None
    attrs = raw
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="ignore")
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return None
        try:
            attrs = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(attrs, dict):
        return None
    barcode = attrs.get("barcode")
    if isinstance(barcode, str) and barcode.strip():
        return barcode.strip()[:120]
    return None


def main() -> None:
    updated = 0
    skipped = 0
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, sku, attributes
                FROM products
                WHERE attributes IS NOT NULL
                  AND (sku IS NULL OR TRIM(sku) = '')
                """
            )
        ).fetchall()

        for row in rows:
            data = dict(row._mapping)
            barcode = _barcode_from_attributes(data.get("attributes"))
            if not barcode:
                skipped += 1
                continue
            conn.execute(
                text("UPDATE products SET sku = :sku WHERE id = :id"),
                {"sku": barcode, "id": data["id"]},
            )
            updated += 1

    print(f"backfilled sku from attributes.barcode for {updated} product(s)")
    print(f"skipped {skipped} product(s) with no usable barcode")


if __name__ == "__main__":
    main()
