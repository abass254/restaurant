"""Let one order be paid with several methods (e.g. cash + M-PESA)."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def migrate() -> None:
    with engine.begin() as conn:
        if not inspect(conn).has_table("orders"):
            print("orders table missing; nothing to do.")
            return
        if not _has_column(conn, "orders", "payment_splits"):
            conn.execute(text("ALTER TABLE orders ADD COLUMN payment_splits JSON NULL"))
    print("Order payment splits column is ready.")


if __name__ == "__main__":
    migrate()
