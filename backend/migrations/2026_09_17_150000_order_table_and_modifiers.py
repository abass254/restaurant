"""Add table_number on orders and modifiers on order_items for restaurant/hotel sales."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def main() -> None:
    with engine.begin() as conn:
        insp = inspect(conn)
        if insp.has_table("orders"):
            if not _has_column(conn, "orders", "table_number"):
                conn.execute(
                    text(
                        "ALTER TABLE orders "
                        "ADD COLUMN table_number VARCHAR(50) NULL"
                    ),
                )
                print("added orders.table_number")
            else:
                print("orders.table_number already exists")
        else:
            print("orders table missing")

        if insp.has_table("order_items"):
            if not _has_column(conn, "order_items", "modifiers"):
                conn.execute(
                    text(
                        "ALTER TABLE order_items "
                        "ADD COLUMN modifiers JSON NULL"
                    ),
                )
                print("added order_items.modifiers")
            else:
                print("order_items.modifiers already exists")
        else:
            print("order_items table missing")


if __name__ == "__main__":
    main()
