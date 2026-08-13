"""Sales autopilot: saved customers (with consent) and conversation session state."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def _has_index(conn, table: str, index_name: str) -> bool:
    return index_name in {idx["name"] for idx in inspect(conn).get_indexes(table)}


def main() -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS channel_customers (
                    id VARCHAR(36) PRIMARY KEY,
                    account_id VARCHAR(36) NOT NULL,
                    platform VARCHAR(32) NOT NULL,
                    external_id VARCHAR(255) NOT NULL,
                    display_name VARCHAR(255),
                    phone VARCHAR(32),
                    email VARCHAR(255),
                    delivery_address TEXT,
                    consent_status VARCHAR(20) NOT NULL DEFAULT 'none',
                    consent_asked_at DATETIME,
                    consent_given_at DATETIME,
                    created_at DATETIME,
                    updated_at DATETIME,
                    UNIQUE (account_id, platform, external_id)
                )
                """,
            ),
        )
        if not _has_index(conn, "channel_customers", "channel_customers_account_platform_index"):
            conn.execute(
                text(
                    """
                    CREATE INDEX channel_customers_account_platform_index
                    ON channel_customers (account_id, platform)
                    """,
                ),
            )

        if not _has_column(conn, "instagram_conversations", "sales_session"):
            conn.execute(
                text("ALTER TABLE instagram_conversations ADD COLUMN sales_session JSON"),
            )

        if not _has_column(conn, "orders", "last_customer_status_notified"):
            conn.execute(
                text(
                    "ALTER TABLE orders ADD COLUMN last_customer_status_notified VARCHAR(32)",
                ),
            )

    print("Sales autopilot customer tables/columns are ready.")


if __name__ == "__main__":
    main()
