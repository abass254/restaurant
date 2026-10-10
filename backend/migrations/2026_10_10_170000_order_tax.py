"""Add tax column to orders."""

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
        if not _has_column(conn, "orders", "tax"):
            conn.execute(text("ALTER TABLE orders ADD COLUMN tax NUMERIC(12, 2) NOT NULL DEFAULT 0"))
            notes.append("added orders.tax")
    if notes:
        print("; ".join(notes))
    else:
        print("orders tax column already exists")


if __name__ == "__main__":
    main()
