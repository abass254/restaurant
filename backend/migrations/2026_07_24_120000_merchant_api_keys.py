"""Add merchant_api_keys for Postman / integration auth."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


CREATE_SQL_SQLITE = """
CREATE TABLE merchant_api_keys (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    account_id VARCHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    key_prefix VARCHAR(16) NOT NULL,
    key_hash VARCHAR(64) NOT NULL,
    scopes VARCHAR(255) NOT NULL DEFAULT 'orders:create',
    last_used_at DATETIME NULL,
    revoked_at DATETIME NULL,
    created_by_user_id VARCHAR(36) NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
)
"""

CREATE_SQL_MYSQL = """
CREATE TABLE merchant_api_keys (
    id CHAR(36) NOT NULL PRIMARY KEY,
    account_id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    key_prefix VARCHAR(16) NOT NULL,
    key_hash CHAR(64) NOT NULL,
    scopes VARCHAR(255) NOT NULL DEFAULT 'orders:create',
    last_used_at DATETIME NULL,
    revoked_at DATETIME NULL,
    created_by_user_id CHAR(36) NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
)
"""


def main() -> None:
    notes: list[str] = []
    dialect = engine.dialect.name
    with engine.begin() as conn:
        insp = inspect(conn)
        if insp.has_table("merchant_api_keys"):
            print("Nothing to do — merchant_api_keys already exists.")
            return

        ddl = CREATE_SQL_SQLITE if dialect == "sqlite" else CREATE_SQL_MYSQL
        conn.execute(text(ddl))
        notes.append("created merchant_api_keys")

        if dialect == "sqlite":
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX merchant_api_keys_key_hash_unique "
                    "ON merchant_api_keys (key_hash)",
                ),
            )
            conn.execute(
                text(
                    "CREATE INDEX merchant_api_keys_account_id_index "
                    "ON merchant_api_keys (account_id)",
                ),
            )
        else:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX merchant_api_keys_key_hash_unique "
                    "ON merchant_api_keys (key_hash)",
                ),
            )
            conn.execute(
                text(
                    "CREATE INDEX merchant_api_keys_account_id_index "
                    "ON merchant_api_keys (account_id)",
                ),
            )
        notes.append("added merchant_api_keys indexes")

    print("Migration applied:")
    for note in notes:
        print(f"  - {note}")


if __name__ == "__main__":
    main()
