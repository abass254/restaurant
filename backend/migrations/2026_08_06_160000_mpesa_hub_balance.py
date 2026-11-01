"""Create mpesa_hub_balance_queries for TransChap hub Account Balance checks.

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
        if insp.has_table("mpesa_hub_balance_queries"):
            print("mpesa_hub_balance_queries already exists.")
            return

        conn.execute(
            text(
                """
                CREATE TABLE mpesa_hub_balance_queries (
                    id VARCHAR(36) NOT NULL PRIMARY KEY,
                    shortcode VARCHAR(20) NOT NULL,
                    originator_conversation_id VARCHAR(100) NOT NULL,
                    conversation_id VARCHAR(100) NULL,
                    status VARCHAR(30) NOT NULL DEFAULT 'pending',
                    result_code INTEGER NULL,
                    result_desc VARCHAR(500) NULL,
                    balances_raw TEXT NULL,
                    working_balance VARCHAR(50) NULL,
                    utility_balance VARCHAR(50) NULL,
                    charges_balance VARCHAR(50) NULL,
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
                CREATE UNIQUE INDEX mpesa_hub_balance_originator_unique
                ON mpesa_hub_balance_queries (originator_conversation_id)
                """,
            ),
        )

    print("mpesa_hub_balance_queries is ready.")


if __name__ == "__main__":
    main()
