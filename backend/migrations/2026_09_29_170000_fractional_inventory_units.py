"""Allow fractional stock and sell-unit factors for measured goods."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def migrate() -> None:
    with engine.begin() as conn:
        dialect = conn.dialect.name
        if dialect == "mysql":
            if inspect(conn).has_table("inventory_items"):
                conn.execute(
                    text(
                        "ALTER TABLE inventory_items "
                        "MODIFY stock_quantity NUMERIC(12, 3) NULL, "
                        "MODIFY low_stock_threshold NUMERIC(12, 3) NULL"
                    )
                )
            if inspect(conn).has_table("stock_movements"):
                conn.execute(
                    text(
                        "ALTER TABLE stock_movements "
                        "MODIFY quantity NUMERIC(12, 3) NOT NULL, "
                        "MODIFY quantity_before NUMERIC(12, 3) NULL, "
                        "MODIFY quantity_after NUMERIC(12, 3) NULL"
                    )
                )
            if inspect(conn).has_table("order_items"):
                conn.execute(
                    text(
                        "ALTER TABLE order_items "
                        "MODIFY unit_factor NUMERIC(12, 4) NOT NULL DEFAULT 1"
                    )
                )
        elif dialect == "postgresql":
            for table, columns in {
                "inventory_items": {
                    "stock_quantity": "NUMERIC(12, 3)",
                    "low_stock_threshold": "NUMERIC(12, 3)",
                },
                "stock_movements": {
                    "quantity": "NUMERIC(12, 3)",
                    "quantity_before": "NUMERIC(12, 3)",
                    "quantity_after": "NUMERIC(12, 3)",
                },
                "order_items": {"unit_factor": "NUMERIC(12, 4)"},
            }.items():
                if not inspect(conn).has_table(table):
                    continue
                for column, column_type in columns.items():
                    conn.execute(
                        text(
                            f"ALTER TABLE {table} ALTER COLUMN {column} "
                            f"TYPE {column_type} USING {column}::{column_type}"
                        )
                    )
        elif dialect != "sqlite":
            raise RuntimeError(
                f"Fractional inventory migration is unsupported for database {dialect!r}."
            )
    print("Fractional inventory units are ready.")


if __name__ == "__main__":
    migrate()
