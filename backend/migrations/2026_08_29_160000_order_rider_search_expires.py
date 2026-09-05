"""Add rider_search_expires_at for Tools → Delivery hail timeouts."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def main() -> None:
    with engine.begin() as conn:
        if not inspect(conn).has_table("orders"):
            print("orders table missing — run earlier migrations first")
            return
        if not _has_column(conn, "orders", "rider_search_expires_at"):
            conn.execute(
                text("ALTER TABLE orders ADD COLUMN rider_search_expires_at DATETIME NULL"),
            )
            print("added orders.rider_search_expires_at")
        else:
            print("orders.rider_search_expires_at already exists")


if __name__ == "__main__":
    main()
