"""Shop customers with a per-customer credit limit."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


SHOP_CUSTOMERS_SQL = """
CREATE TABLE shop_customers (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    account_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    email VARCHAR(255) NULL,
    address TEXT NULL,
    notes TEXT NULL,
    credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0,
    outstanding_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("shop_customers"):
            conn.execute(text(SHOP_CUSTOMERS_SQL))
            notes.append("created table shop_customers")

        insp = inspect(conn)
        if insp.has_table("shop_customers"):
            indexes = {row["name"] for row in insp.get_indexes("shop_customers")}
            if "shop_customers_account_phone_unique" not in indexes:
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX shop_customers_account_phone_unique "
                        "ON shop_customers (account_id, phone)",
                    ),
                )
                notes.append("created unique index shop_customers_account_phone_unique")
            if "shop_customers_account_name_index" not in indexes:
                conn.execute(
                    text(
                        "CREATE INDEX shop_customers_account_name_index "
                        "ON shop_customers (account_id, name)",
                    ),
                )
                notes.append("created index shop_customers_account_name_index")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("shop_customers schema already in place.")


if __name__ == "__main__":
    main()
