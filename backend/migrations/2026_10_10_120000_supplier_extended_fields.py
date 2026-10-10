"""Add balance, address, postal_code, city, email, fax, pin_number to shop_suppliers."""

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
        if not insp.has_table("shop_suppliers"):
            print("shop_suppliers missing — run earlier migration first")
            return

        columns_to_add = [
            ("balance", "DECIMAL(14, 2) DEFAULT 0.00"),
            ("address", "VARCHAR(255) NULL"),
            ("postal_code", "VARCHAR(64) NULL"),
            ("city", "VARCHAR(120) NULL"),
            ("email", "VARCHAR(255) NULL"),
            ("fax", "VARCHAR(64) NULL"),
            ("pin_number", "VARCHAR(64) NULL"),
        ]

        for col_name, col_type in columns_to_add:
            if not _has_column(conn, "shop_suppliers", col_name):
                conn.execute(
                    text(f"ALTER TABLE shop_suppliers ADD COLUMN {col_name} {col_type}"),
                )
                print(f"added shop_suppliers.{col_name}")
            else:
                print(f"shop_suppliers.{col_name} already exists")


if __name__ == "__main__":
    main()
