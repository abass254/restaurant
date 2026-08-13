"""Create ``user_login_codes`` for merchant OTP sign-in."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

SQL = """
CREATE TABLE user_login_codes (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    code_hash VARCHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    created_at DATETIME NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)
"""


def main() -> None:
    with engine.begin() as conn:
        insp = inspect(conn)
        if insp.has_table("user_login_codes"):
            print("user_login_codes already exists")
            return
        if not insp.has_table("users"):
            print("users table missing — run earlier migrations first")
            return
        conn.execute(text(SQL))
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS user_login_codes_user_id_index "
                "ON user_login_codes (user_id)",
            ),
        )
        print("created user_login_codes")


if __name__ == "__main__":
    main()
