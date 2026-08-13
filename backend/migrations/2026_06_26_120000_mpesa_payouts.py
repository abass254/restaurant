"""Add M-PESA B2B payout fields to platform config and collection transactions."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def _add_column(conn, table: str, ddl: str) -> None:
    conn.execute(text(ddl))


def main() -> None:
    with engine.begin() as conn:
        if not _has_column(conn, "mpesa_configurations", "b2b_initiator_name"):
            _add_column(
                conn,
                "mpesa_configurations",
                """
                ALTER TABLE mpesa_configurations
                ADD COLUMN b2b_initiator_name VARCHAR(100) NULL
                """,
            )
        if not _has_column(conn, "mpesa_configurations", "b2b_security_credential"):
            _add_column(
                conn,
                "mpesa_configurations",
                """
                ALTER TABLE mpesa_configurations
                ADD COLUMN b2b_security_credential TEXT NULL
                """,
            )
        if not _has_column(conn, "mpesa_configurations", "b2b_auto_payout"):
            _add_column(
                conn,
                "mpesa_configurations",
                """
                ALTER TABLE mpesa_configurations
                ADD COLUMN b2b_auto_payout BOOLEAN NOT NULL DEFAULT 0
                """,
            )

        txn_columns = {
            "account_id": "VARCHAR(36) NULL",
            "payout_status": "VARCHAR(30) NULL",
            "payout_shortcode": "VARCHAR(20) NULL",
            "payout_shortcode_type": "VARCHAR(20) NULL",
            "payout_amount": "INTEGER NULL",
            "payout_originator_conversation_id": "VARCHAR(100) NULL",
            "payout_result_code": "INTEGER NULL",
            "payout_result_desc": "VARCHAR(500) NULL",
            "payout_receipt_number": "VARCHAR(50) NULL",
            "payout_callback_payload": "JSON NULL",
            "payout_completed_at": "DATETIME NULL",
        }
        for column, col_type in txn_columns.items():
            if not _has_column(conn, "mpesa_transactions", column):
                _add_column(
                    conn,
                    "mpesa_transactions",
                    f"""
                    ALTER TABLE mpesa_transactions
                    ADD COLUMN {column} {col_type}
                    """,
                )

    print("M-PESA payout columns are ready.")


if __name__ == "__main__":
    main()
