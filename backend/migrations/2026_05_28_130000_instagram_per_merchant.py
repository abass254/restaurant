"""One social channel row per merchant: add account_id + uniqueness."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def main() -> None:
    with engine.begin() as conn:
        if not _has_column(conn, "instagram_accounts", "account_id"):
            conn.execute(
                text(
                    "ALTER TABLE instagram_accounts "
                    "ADD COLUMN account_id VARCHAR(36) NULL",
                ),
            )

        conn.execute(
            text(
                """
                UPDATE instagram_accounts
                SET account_id = (
                    SELECT users.account_id
                    FROM users
                    WHERE users.id = instagram_accounts.user_id
                )
                WHERE account_id IS NULL
                """,
            ),
        )

        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS instagram_accounts_account_id_platform_index
                ON instagram_accounts (account_id, platform)
                """,
            ),
        )

        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS instagram_accounts_account_platform_unique
                ON instagram_accounts (account_id, platform)
                WHERE account_id IS NOT NULL
                """,
            ),
        )

    print("instagram_accounts.account_id is ready (one channel row per merchant).")


if __name__ == "__main__":
    main()
