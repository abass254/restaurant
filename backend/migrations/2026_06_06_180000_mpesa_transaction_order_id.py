"""Add order_id to mpesa_transactions so every STK attempt links to an order.

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
        if "order_id" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE mpesa_transactions "
                    "ADD COLUMN order_id VARCHAR(36) "
                    "REFERENCES orders(id) ON DELETE SET NULL",
                ),
            )
            notes.append("added column mpesa_transactions.order_id")

        if insp.has_table("orders"):
            result = conn.execute(
                text(
                    """
                    UPDATE mpesa_transactions
                    SET order_id = (
                        SELECT orders.id
                        FROM orders
                        WHERE orders.mpesa_transaction_id = mpesa_transactions.id
                        LIMIT 1
                    )
                    WHERE order_id IS NULL
                      AND EXISTS (
                        SELECT 1
                        FROM orders
                        WHERE orders.mpesa_transaction_id = mpesa_transactions.id
                      )
                    """,
                ),
            )
            if result.rowcount:
                notes.append(
                    f"backfilled order_id on {result.rowcount} mpesa_transactions row(s)",
                )

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Nothing to do — mpesa_transactions.order_id already present.")


if __name__ == "__main__":
    main()
