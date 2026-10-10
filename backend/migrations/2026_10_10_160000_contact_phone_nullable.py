"""Allow shop_customers.phone / shop_suppliers.phone to be NULL (imported contacts without a number)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

TABLES = ("shop_customers", "shop_suppliers")


def main() -> None:
    with engine.begin() as conn:
        if conn.dialect.name == "sqlite":
            print("sqlite: tables are created from the models; nothing to alter")
            return
        insp = inspect(conn)
        for table in TABLES:
            if not insp.has_table(table):
                print(f"{table} missing — run earlier migration first")
                continue
            phone = next(col for col in insp.get_columns(table) if col["name"] == "phone")
            if phone["nullable"]:
                print(f"{table}.phone already nullable")
                continue
            conn.execute(text(f"ALTER TABLE {table} MODIFY phone VARCHAR(32) NULL"))
            print(f"made {table}.phone nullable")


if __name__ == "__main__":
    main()
