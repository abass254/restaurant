"""Mark hotel menu (food_beverage) inventory as sell-only and untracked stock."""

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
        if not insp.has_table("inventory_items") or not insp.has_table("products"):
            print("inventory_items/products missing — run earlier migrations first")
            return
        result = conn.execute(
            text(
                """
                UPDATE inventory_items AS inv
                JOIN products AS p ON p.id = inv.product_id
                SET
                    inv.inventory_role = 'for_sale',
                    inv.stock_quantity = NULL,
                    inv.low_stock_threshold = NULL
                WHERE LOWER(REPLACE(COALESCE(p.category, ''), ' ', '_')) IN (
                    'food_beverage',
                    'food_&_beverage',
                    'hotel_menu',
                    'hotel'
                )
                """
            ),
        )
        print(f"marked {result.rowcount} hotel menu inventory_items as sell-only")


if __name__ == "__main__":
    main()
