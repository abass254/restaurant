"""Add booking_id to mpesa_transactions for booking deposit STK linking.

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
        if "booking_id" not in existing:
            # bookings table may not exist yet on older DBs
            if insp.has_table("bookings"):
                conn.execute(
                    text(
                        "ALTER TABLE mpesa_transactions "
                        "ADD COLUMN booking_id VARCHAR(36) "
                        "REFERENCES bookings(id) ON DELETE SET NULL",
                    ),
                )
            else:
                conn.execute(
                    text(
                        "ALTER TABLE mpesa_transactions "
                        "ADD COLUMN booking_id VARCHAR(36)",
                    ),
                )
            notes.append("added column mpesa_transactions.booking_id")

        if "booking_id" in existing or "booking_id" in {
            col["name"] for col in insp.get_columns("mpesa_transactions")
        }:
            if insp.has_table("bookings"):
                result = conn.execute(
                    text(
                        """
                        UPDATE mpesa_transactions
                        SET booking_id = (
                            SELECT bookings.id
                            FROM bookings
                            WHERE bookings.deposit_mpesa_txn_id = mpesa_transactions.id
                            LIMIT 1
                        )
                        WHERE booking_id IS NULL
                          AND EXISTS (
                            SELECT 1
                            FROM bookings
                            WHERE bookings.deposit_mpesa_txn_id = mpesa_transactions.id
                          )
                        """,
                    ),
                )
                if result.rowcount:
                    notes.append(
                        f"backfilled booking_id on {result.rowcount} mpesa_transactions row(s)",
                    )

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Nothing to do — mpesa_transactions.booking_id already present.")


if __name__ == "__main__":
    main()
