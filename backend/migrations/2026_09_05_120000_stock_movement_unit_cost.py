"""Add unit_cost to stock_movements so restocks can record purchase spend."""

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
        if not insp.has_table("stock_movements"):
            print("stock_movements missing — run earlier migration first")
            return
        if _has_column(conn, "stock_movements", "unit_cost"):
            print("stock_movements.unit_cost already exists")
            return
        conn.execute(
            text(
                "ALTER TABLE stock_movements "
                "ADD COLUMN unit_cost NUMERIC(12, 2) NULL"
            ),
        )
        print("added stock_movements.unit_cost")


if __name__ == "__main__":
    main()
