"""Add sell_unit + unit_factor on order_items for pack/crate sales."""

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
        if not insp.has_table("order_items"):
            print("order_items missing — run earlier migration first")
            return

        if not _has_column(conn, "order_items", "sell_unit"):
            conn.execute(
                text(
                    "ALTER TABLE order_items "
                    "ADD COLUMN sell_unit VARCHAR(64) NULL"
                ),
            )
            print("added order_items.sell_unit")
        else:
            print("order_items.sell_unit already exists")

        if not _has_column(conn, "order_items", "unit_factor"):
            conn.execute(
                text(
                    "ALTER TABLE order_items "
                    "ADD COLUMN unit_factor INTEGER NOT NULL DEFAULT 1"
                ),
            )
            print("added order_items.unit_factor")
        else:
            print("order_items.unit_factor already exists")


if __name__ == "__main__":
    main()
