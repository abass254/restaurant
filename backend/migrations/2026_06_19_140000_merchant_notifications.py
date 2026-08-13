"""In-app merchant notification feed."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_table(conn, table: str) -> bool:
    return table in inspect(conn).get_table_names()


def main() -> None:
    with engine.begin() as conn:
        if not _has_table(conn, "merchant_notifications"):
            conn.execute(
                text(
                    """
                    CREATE TABLE merchant_notifications (
                        id VARCHAR(36) PRIMARY KEY,
                        account_id VARCHAR(36) NOT NULL,
                        kind VARCHAR(32) NOT NULL,
                        title VARCHAR(255) NOT NULL,
                        body VARCHAR(500) NULL,
                        entity_type VARCHAR(64) NULL,
                        entity_id VARCHAR(36) NULL,
                        dedupe_key VARCHAR(255) NULL,
                        read_at DATETIME NULL,
                        created_at DATETIME NULL,
                        UNIQUE (account_id, dedupe_key),
                        FOREIGN KEY (account_id) REFERENCES accounts(id)
                    )
                    """,
                ),
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX ix_merchant_notifications_account_unread
                    ON merchant_notifications (account_id, read_at, created_at)
                    """,
                ),
            )

    print("merchant_notifications table is ready.")


if __name__ == "__main__":
    main()
