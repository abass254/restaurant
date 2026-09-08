"""Clarify inventory roles: migrate legacy for_sale (resale) rows to both.

for_sale = sell only (finished goods; hidden from Purchases)
both = buy & sell (retail stock)
raw_material = buy only
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def main() -> None:
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("inventory_items"):
            print("inventory_items missing — run earlier migration first")
            return
        cols = {col["name"] for col in insp.get_columns("inventory_items")}
        if "inventory_role" not in cols:
            print("inventory_items.inventory_role missing — run inventory_role migration first")
            return
        result = conn.execute(
            text(
                "UPDATE inventory_items "
                "SET inventory_role = 'both' "
                "WHERE inventory_role = 'for_sale' OR inventory_role IS NULL OR inventory_role = ''"
            ),
        )
        print(f"migrated {result.rowcount} inventory_items from for_sale/empty → both")


if __name__ == "__main__":
    main()
