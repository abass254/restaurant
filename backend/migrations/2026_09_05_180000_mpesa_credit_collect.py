"""Link M-PESA transactions to shop-customer credit collections.

Idempotent — safe to re-run.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("mpesa_transactions"):
            print("Nothing to do — mpesa_transactions table missing.")
            return

        existing = {col["name"] for col in insp.get_columns("mpesa_transactions")}
        if "shop_customer_id" not in existing:
            if insp.has_table("shop_customers"):
                conn.execute(
                    text(
                        "ALTER TABLE mpesa_transactions "
                        "ADD COLUMN shop_customer_id VARCHAR(36) "
                        "REFERENCES shop_customers(id) ON DELETE SET NULL",
                    ),
                )
            else:
                conn.execute(
                    text(
                        "ALTER TABLE mpesa_transactions "
                        "ADD COLUMN shop_customer_id VARCHAR(36)",
                    ),
                )
            notes.append("added column mpesa_transactions.shop_customer_id")

        existing = {col["name"] for col in insp.get_columns("mpesa_transactions")}
        if "credit_collect_amount" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE mpesa_transactions "
                    "ADD COLUMN credit_collect_amount INTEGER NULL",
                ),
            )
            notes.append("added column mpesa_transactions.credit_collect_amount")
        if "credit_collected_at" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE mpesa_transactions "
                    "ADD COLUMN credit_collected_at DATETIME NULL",
                ),
            )
            notes.append("added column mpesa_transactions.credit_collected_at")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Nothing to do — mpesa credit-collect columns already present.")


if __name__ == "__main__":
    main()
