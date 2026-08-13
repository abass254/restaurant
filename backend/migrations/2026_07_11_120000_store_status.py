"""Add store pause / busy / station heartbeat columns for Merchant Station."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        account_cols = [
            ("orders_paused", "BOOLEAN NOT NULL DEFAULT 0"),
            ("orders_paused_until", "DATETIME NULL"),
            ("orders_paused_reason", "VARCHAR(64) NULL"),
            ("busy_extra_prep_minutes", "INTEGER NOT NULL DEFAULT 0"),
            ("default_prep_minutes", "INTEGER NOT NULL DEFAULT 20"),
            ("station_last_heartbeat_at", "DATETIME NULL"),
            ("station_heartbeat_required", "BOOLEAN NOT NULL DEFAULT 0"),
        ]
        for name, ddl in account_cols:
            if not _has_column(conn, "accounts", name):
                conn.execute(text(f"ALTER TABLE accounts ADD COLUMN {name} {ddl}"))
                notes.append(f"added accounts.{name}")

        if not _has_column(conn, "orders", "prep_minutes"):
            conn.execute(text("ALTER TABLE orders ADD COLUMN prep_minutes INTEGER NULL"))
            notes.append("added orders.prep_minutes")

        if not inspect(conn).has_table("push_subscriptions"):
            conn.execute(
                text(
                    """
                    CREATE TABLE push_subscriptions (
                        id VARCHAR(36) PRIMARY KEY,
                        account_id VARCHAR(36) NOT NULL,
                        user_id VARCHAR(36) NOT NULL,
                        endpoint TEXT NOT NULL,
                        endpoint_hash VARCHAR(64) NOT NULL,
                        p256dh VARCHAR(255) NOT NULL,
                        auth VARCHAR(255) NOT NULL,
                        user_agent VARCHAR(512) NULL,
                        created_at DATETIME NULL,
                        updated_at DATETIME NULL,
                        UNIQUE (endpoint_hash),
                        FOREIGN KEY (account_id) REFERENCES accounts(id),
                        FOREIGN KEY (user_id) REFERENCES users(id)
                    )
                    """,
                ),
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX ix_push_subscriptions_account_user
                    ON push_subscriptions (account_id, user_id)
                    """,
                ),
            )
            notes.append("created push_subscriptions")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Store status schema already in place.")


if __name__ == "__main__":
    main()
