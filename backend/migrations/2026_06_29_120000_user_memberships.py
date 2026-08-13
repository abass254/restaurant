"""Create user_memberships and backfill from users.account_id."""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_table(conn, table: str) -> bool:
    return inspect(conn).has_table(table)


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        if not _has_table(conn, "user_memberships"):
            conn.execute(
                text(
                    """
                    CREATE TABLE user_memberships (
                        id VARCHAR(36) PRIMARY KEY,
                        user_id VARCHAR(36) NOT NULL REFERENCES users(id),
                        account_id VARCHAR(36) NOT NULL REFERENCES accounts(id),
                        role VARCHAR(255) NOT NULL DEFAULT 'staff',
                        allowed_sections TEXT NULL,
                        is_active BOOLEAN NOT NULL DEFAULT TRUE,
                        created_at TIMESTAMP NULL,
                        updated_at TIMESTAMP NULL,
                        UNIQUE (user_id, account_id)
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX ix_user_memberships_user_id ON user_memberships(user_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX ix_user_memberships_account_id ON user_memberships(account_id)"
                )
            )
            notes.append("created user_memberships table")

        rows = conn.execute(
            text(
                """
                SELECT
                    u.id AS user_id,
                    u.account_id AS account_id,
                    COALESCE(NULLIF(TRIM(u.user_role), ''), 'staff') AS role,
                    u.allowed_sections AS allowed_sections,
                    COALESCE(u.is_activated, TRUE) AS is_active,
                    COALESCE(u.created_at, CURRENT_TIMESTAMP) AS created_at,
                    COALESCE(u.updated_at, CURRENT_TIMESTAMP) AS updated_at
                FROM users u
                WHERE u.account_id IS NOT NULL
                """
            )
        ).mappings()
        for row in rows:
            conn.execute(
                text(
                    """
                    INSERT INTO user_memberships (
                        id,
                        user_id,
                        account_id,
                        role,
                        allowed_sections,
                        is_active,
                        created_at,
                        updated_at
                    ) VALUES (
                        :id,
                        :user_id,
                        :account_id,
                        :role,
                        :allowed_sections,
                        :is_active,
                        :created_at,
                        :updated_at
                    )
                    ON CONFLICT (user_id, account_id) DO NOTHING
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "user_id": row["user_id"],
                    "account_id": row["account_id"],
                    "role": row["role"],
                    "allowed_sections": row["allowed_sections"],
                    "is_active": row["is_active"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                },
            )
        notes.append("backfilled user_memberships from users.account_id")

    print("Migration applied:")
    for note in notes:
        print(f"  - {note}")


if __name__ == "__main__":
    main()
