"""Add operational settings to merchant accounts."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

# Allow `python backend/migrations/<file>.py` from anywhere.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def migrate() -> None:
    with engine.begin() as conn:
        if not _has_column(conn, "accounts", "allow_item_quantity_adjustment"):
            conn.execute(
                text(
                    """
                    ALTER TABLE accounts
                    ADD COLUMN allow_item_quantity_adjustment BOOLEAN NOT NULL DEFAULT 1
                    """
                )
            )
        if not _has_column(conn, "accounts", "adjust_selling_price_on_purchase"):
            conn.execute(
                text(
                    """
                    ALTER TABLE accounts
                    ADD COLUMN adjust_selling_price_on_purchase BOOLEAN NOT NULL DEFAULT 1
                    """
                )
            )
    print("Account operational settings columns are ready.")


if __name__ == "__main__":
    migrate()
