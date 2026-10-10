"""Add balance_due_date to shop_suppliers (when the owed balance must be paid)."""

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
        if "balance_due_date" in columns:
            print("shop_suppliers.balance_due_date already exists")
            return

        conn.execute(text("ALTER TABLE shop_suppliers ADD COLUMN balance_due_date DATE NULL"))
        print("added shop_suppliers.balance_due_date")


if __name__ == "__main__":
    main()
