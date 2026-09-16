"""Add allow_orders_when_store_closed to platform messaging settings."""

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
        if not _has_column(conn, "platform_messaging_settings", "allow_orders_when_store_closed"):
            conn.execute(
                text(
                    """
                    ALTER TABLE platform_messaging_settings
                    ADD COLUMN allow_orders_when_store_closed BOOLEAN NOT NULL DEFAULT 0
                    """
                )
            )
    print("allow_orders_when_store_closed column is ready.")


if __name__ == "__main__":
    migrate()
