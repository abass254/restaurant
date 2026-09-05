"""Add pickup address and coordinates on orders for rider hails."""

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
    notes: list[str] = []
    with engine.begin() as conn:
        if not inspect(conn).has_table("orders"):
            print("orders table missing — run earlier migrations first")
            return
        for column, ddl in (
            ("pickup_address", "TEXT NULL"),
            ("pickup_lat", "DOUBLE NULL"),
            ("pickup_lng", "DOUBLE NULL"),
        ):
            if not _has_column(conn, "orders", column):
                conn.execute(text(f"ALTER TABLE orders ADD COLUMN {column} {ddl}"))
                notes.append(f"added orders.{column}")
    if notes:
        print("; ".join(notes))
    else:
        print("orders pickup columns already exist")


if __name__ == "__main__":
    main()
