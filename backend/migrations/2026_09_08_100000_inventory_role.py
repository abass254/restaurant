"""Add inventory_role so shops can mark items for sale, raw material, or both."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

INDEX_NAME = "inventory_items_account_id_inventory_role_index"


def _has_column(conn, table: str, column: str) -> bool:
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def _has_index(conn, table: str, index_name: str) -> bool:
    return index_name in {idx["name"] for idx in inspect(conn).get_indexes(table)}


def main() -> None:
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("inventory_items"):
            print("inventory_items missing — run earlier migration first")
            return
        if not _has_column(conn, "inventory_items", "inventory_role"):
            conn.execute(
                text(
                    "ALTER TABLE inventory_items "
                    "ADD COLUMN inventory_role VARCHAR(20) NOT NULL DEFAULT 'for_sale'"
                ),
            )
            print("added inventory_items.inventory_role")
        else:
            print("inventory_items.inventory_role already exists")

        if not _has_index(conn, "inventory_items", INDEX_NAME):
            conn.execute(
                text(
                    f"CREATE INDEX {INDEX_NAME} "
                    "ON inventory_items (account_id, inventory_role)"
                ),
            )
            print(f"added {INDEX_NAME}")
        else:
            print(f"{INDEX_NAME} already exists")


if __name__ == "__main__":
    main()
