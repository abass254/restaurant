"""Shop suppliers directory for merchants."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


SHOP_SUPPLIERS_SQL = """
CREATE TABLE shop_suppliers (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    account_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    notes TEXT NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("shop_suppliers"):
            conn.execute(text(SHOP_SUPPLIERS_SQL))
            notes.append("created table shop_suppliers")

        insp = inspect(conn)
        if insp.has_table("shop_suppliers"):
            indexes = {row["name"] for row in insp.get_indexes("shop_suppliers")}
            if "shop_suppliers_account_phone_unique" not in indexes:
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX shop_suppliers_account_phone_unique "
                        "ON shop_suppliers (account_id, phone)",
                    ),
                )
                notes.append("created unique index shop_suppliers_account_phone_unique")
            if "shop_suppliers_account_name_index" not in indexes:
                conn.execute(
                    text(
                        "CREATE INDEX shop_suppliers_account_name_index "
                        "ON shop_suppliers (account_id, name)",
                    ),
                )
                notes.append("created index shop_suppliers_account_name_index")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("shop_suppliers schema already in place.")


if __name__ == "__main__":
    main()
