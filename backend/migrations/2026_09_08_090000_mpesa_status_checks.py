"""Create mpesa_status_checks for Daraja Transaction Status reconciliation.

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
    with engine.begin() as conn:
        insp = inspect(conn)
        if insp.has_table("mpesa_status_checks"):
            print("mpesa_status_checks already exists.")
            return

        conn.execute(
            text(
                """
                CREATE TABLE mpesa_status_checks (
                    id VARCHAR(36) NOT NULL PRIMARY KEY,
                    transaction_id VARCHAR(36) NOT NULL REFERENCES mpesa_transactions(id),
                    direction VARCHAR(3) NOT NULL,
                    queried_receipt VARCHAR(50) NULL,
                    recorded_amount INTEGER NULL,
                    originator_conversation_id VARCHAR(100) NOT NULL,
                    conversation_id VARCHAR(100) NULL,
                    status VARCHAR(30) NOT NULL DEFAULT 'pending',
                    result_code INTEGER NULL,
                    result_desc VARCHAR(500) NULL,
                    match_state VARCHAR(30) NULL,
                    safaricom_status VARCHAR(50) NULL,
                    safaricom_amount VARCHAR(50) NULL,
                    safaricom_receipt VARCHAR(50) NULL,
                    safaricom_completed_at DATETIME NULL,
                    debit_party VARCHAR(120) NULL,
                    credit_party VARCHAR(120) NULL,
                    debit_party_charges VARCHAR(120) NULL,
                    reason_type VARCHAR(120) NULL,
                    callback_payload JSON NULL,
                    requested_by_user_id VARCHAR(36) NULL REFERENCES users(id),
                    requested_at DATETIME NULL,
                    completed_at DATETIME NULL,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL
                )
                """,
            ),
        )
        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX mpesa_status_checks_originator_unique
                ON mpesa_status_checks (originator_conversation_id)
                """,
            ),
        )
        conn.execute(
            text(
                """
                CREATE INDEX mpesa_status_checks_txn_index
                ON mpesa_status_checks (transaction_id, direction)
                """,
            ),
        )

    print("mpesa_status_checks is ready.")


if __name__ == "__main__":
    main()
