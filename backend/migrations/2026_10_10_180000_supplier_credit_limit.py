"""Add credit_limit to shop_suppliers."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def main() -> None:
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("shop_suppliers"):
            print("shop_suppliers missing — run earlier migration first")
            return

        columns = {col["name"] for col in insp.get_columns("shop_suppliers")}
        if "credit_limit" in columns:
            print("shop_suppliers.credit_limit already exists")
            return

        conn.execute(
            text("ALTER TABLE shop_suppliers ADD COLUMN credit_limit DECIMAL(12, 2) DEFAULT 0.00"),
        )
        print("added shop_suppliers.credit_limit")


if __name__ == "__main__":
    main()
