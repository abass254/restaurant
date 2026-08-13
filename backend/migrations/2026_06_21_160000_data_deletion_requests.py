"""Data deletion audit table for Meta callback compliance."""

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
        if not _has_table(conn, "data_deletion_requests"):
            conn.execute(
                text(
                    """
                    CREATE TABLE data_deletion_requests (
                        id VARCHAR(36) PRIMARY KEY,
                        confirmation_code VARCHAR(64) NOT NULL UNIQUE,
                        meta_user_id VARCHAR(255) NOT NULL,
                        instagram_account_ids JSON NULL,
                        source VARCHAR(64) NOT NULL DEFAULT 'meta_callback',
                        status VARCHAR(32) NOT NULL DEFAULT 'completed',
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
                    CREATE INDEX ix_data_deletion_requests_meta_user_id
                    ON data_deletion_requests (meta_user_id)
                    """,
                ),
            )

    print("data_deletion_requests table is ready.")


if __name__ == "__main__":
    main()
