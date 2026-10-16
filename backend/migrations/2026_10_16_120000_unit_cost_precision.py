"""Store per-base-unit costs to 4 decimal places.

A 1 KES pack split into 200 base units costs 0.005 each, which DECIMAL(12, 2)
rounds to 0.00. Only the costing columns change; money totals stay at 2 places.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

# (table, column)
COLUMNS: list[tuple[str, str]] = [
    ("inventory_items", "buying_price"),
    ("stock_movements", "unit_cost"),
    ("stock_take_lines", "unit_cost"),
    ("kitchen_issue_lines", "unit_cost"),
]

PRECISION = 14
SCALE = 4


def main() -> None:
    with engine.begin() as conn:
        if conn.dialect.name == "sqlite":
            print("sqlite: tables are created from the models; nothing to alter")
            return
        insp = inspect(conn)
        for table, column in COLUMNS:
            if not insp.has_table(table):
                print(f"{table} missing — run earlier migration first")
                continue
            col = next((c for c in insp.get_columns(table) if c["name"] == column), None)
            if col is None:
                print(f"{table}.{column} missing — run earlier migration first")
                continue
            if getattr(col["type"], "scale", None) == SCALE and getattr(col["type"], "precision", None) == PRECISION:
                print(f"{table}.{column} already DECIMAL({PRECISION}, {SCALE})")
                continue
            null = "NULL" if col["nullable"] else "NOT NULL"
            conn.execute(text(f"ALTER TABLE {table} MODIFY {column} DECIMAL({PRECISION}, {SCALE}) {null}"))
            print(f"widened {table}.{column} to DECIMAL({PRECISION}, {SCALE})")


if __name__ == "__main__":
    main()
