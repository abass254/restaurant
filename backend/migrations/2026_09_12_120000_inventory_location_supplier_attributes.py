"""Add location, supplier, and attributes JSON to inventory_items."""

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
        if not insp.has_table("inventory_items"):
            print("inventory_items missing — run earlier migration first")
            return

        if not _has_column(conn, "inventory_items", "supplier"):
            conn.execute(
                text(
                    "ALTER TABLE inventory_items "
                    "ADD COLUMN supplier VARCHAR(255) NULL"
                ),
            )
            print("added inventory_items.supplier")
        else:
            print("inventory_items.supplier already exists")

        if not _has_column(conn, "inventory_items", "location"):
            conn.execute(
                text(
                    "ALTER TABLE inventory_items "
                    "ADD COLUMN location VARCHAR(255) NULL"
                ),
            )
            print("added inventory_items.location")
        else:
            print("inventory_items.location already exists")

        if not _has_column(conn, "inventory_items", "attributes"):
            conn.execute(
                text(
                    "ALTER TABLE inventory_items "
                    "ADD COLUMN attributes JSON NULL"
                ),
            )
            print("added inventory_items.attributes")
        else:
            print("inventory_items.attributes already exists")


if __name__ == "__main__":
    main()
