"""Create shop_supplier_payments table."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


CREATE_TABLE_SQL = """
CREATE TABLE shop_supplier_payments (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    account_id VARCHAR(36) NOT NULL,
    supplier_id VARCHAR(36) NOT NULL,
    amount DECIMAL(14, 2) NOT NULL,
    reference VARCHAR(100) NULL,
    notes TEXT NULL,
    paid_at DATETIME NOT NULL,
    created_by VARCHAR(36) NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES shop_suppliers(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX ix_shop_supplier_payments_account_supplier (account_id, supplier_id),
    INDEX ix_shop_supplier_payments_paid_at (paid_at)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def main() -> None:
    with engine.begin() as conn:
        insp = inspect(conn)
        if insp.has_table("shop_supplier_payments"):
            print("shop_supplier_payments already exists")
            return
        conn.execute(text(CREATE_TABLE_SQL))
        print("created shop_supplier_payments table")


if __name__ == "__main__":
    main()
