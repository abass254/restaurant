"""DM ticket fields on conversations + platform messaging settings."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def _has_table(conn, table: str) -> bool:
    return table in inspect(conn).get_table_names()


def main() -> None:
    with engine.begin() as conn:
        if not _has_table(conn, "platform_messaging_settings"):
            conn.execute(
                text(
                    """
                    CREATE TABLE platform_messaging_settings (
                        id VARCHAR(36) PRIMARY KEY,
                        wait_dm_time_seconds INTEGER NOT NULL DEFAULT 10,
                        created_at DATETIME NULL,
                        updated_at DATETIME NULL
                    )
                    """,
                ),
            )

        for column, ddl in (
            ("ticket_status", "VARCHAR(20) NOT NULL DEFAULT 'open'"),
            ("ticket_opened_at", "DATETIME NULL"),
            ("awaiting_customer_since", "DATETIME NULL"),
            ("response_timeout_token", "VARCHAR(36) NULL"),
            ("ticket_closed_at", "DATETIME NULL"),
        ):
            if not _has_column(conn, "instagram_conversations", column):
                conn.execute(
                    text(f"ALTER TABLE instagram_conversations ADD COLUMN {column} {ddl}"),
                )

    print("DM ticket columns and platform_messaging_settings are ready.")


if __name__ == "__main__":
    main()
