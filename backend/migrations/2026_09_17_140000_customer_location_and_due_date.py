"""Add physical_location and date_to_pay to shop_customers."""

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
        if not insp.has_table("shop_customers"):
            print("shop_customers missing — run earlier migration first")
            return

        if not _has_column(conn, "shop_customers", "physical_location"):
            conn.execute(
                text(
                    "ALTER TABLE shop_customers "
                    "ADD COLUMN physical_location TEXT NULL"
                ),
            )
            print("added shop_customers.physical_location")
        else:
            print("shop_customers.physical_location already exists")

        if not _has_column(conn, "shop_customers", "date_to_pay"):
            conn.execute(
                text(
                    "ALTER TABLE shop_customers "
                    "ADD COLUMN date_to_pay DATE NULL"
                ),
            )
            print("added shop_customers.date_to_pay")
        else:
            print("shop_customers.date_to_pay already exists")


if __name__ == "__main__":
    main()
