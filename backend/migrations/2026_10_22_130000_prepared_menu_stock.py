"""Track prepared menu portions separately from ingredient and store stock."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def main() -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("inventory_items"):
            print("inventory_items does not exist; run the inventory migrations first")
            return

        columns = {column["name"] for column in inspector.get_columns("inventory_items")}
        if "prepared_quantity" not in columns:
            conn.execute(
                text("ALTER TABLE inventory_items ADD COLUMN prepared_quantity DECIMAL(12, 3) NULL")
            )

        if inspector.has_table("recipe_lines"):
            conn.execute(
                text(
                    "UPDATE inventory_items SET prepared_quantity = 0 "
                    "WHERE prepared_quantity IS NULL AND EXISTS ("
                    "SELECT 1 FROM recipe_lines "
                    "WHERE recipe_lines.product_id = inventory_items.product_id "
                    "AND recipe_lines.account_id = inventory_items.account_id)"
                )
            )

    print("Prepared menu stock column is ready.")


if __name__ == "__main__":
    main()
