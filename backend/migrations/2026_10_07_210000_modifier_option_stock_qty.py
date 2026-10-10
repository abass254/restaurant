"""How much of its linked supply a menu option uses per pick (e.g. 1 bottle, 0.05 kg)."""

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
        if not inspect(conn).has_table("modifier_options"):
            print("modifier_options table missing; run the modifier groups migration first.")
            return
        if not _has_column(conn, "modifier_options", "stock_qty"):
            conn.execute(
                text("ALTER TABLE modifier_options ADD COLUMN stock_qty DECIMAL(10, 3) NOT NULL DEFAULT 1")
            )
    print("Modifier option stock quantity column is ready.")


if __name__ == "__main__":
    migrate()
