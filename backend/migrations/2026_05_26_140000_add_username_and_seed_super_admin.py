"""Add `users.username` and seed a local-only default super admin.

1. Adds a ``username`` ``VARCHAR(64)`` column to ``users`` (nullable, unique).
2. In local/debug only, creates ``netizen`` with the documented default
   password if that username does not already exist. An existing super
   admin is never overwritten — re-running this migration in production
   will not reset a live password.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import SessionLocal, engine  # noqa: E402
from app.support.super_admin_seed import (  # noqa: E402
    SUPER_ADMIN_USERNAME,
    seed_super_admin,
)


def _add_username_column() -> bool:
    """Add ``users.username`` (nullable, unique) if it doesn't exist yet."""
    with engine.begin() as conn:
        cols = {c["name"] for c in inspect(conn).get_columns("users")}
        if "username" in cols:
            return False

        conn.execute(text("ALTER TABLE users ADD COLUMN username VARCHAR(64)"))
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique "
                "ON users (username)",
            ),
        )
        return True


def main() -> None:
    added_column = _add_username_column()
    print(
        "users.username column: "
        + ("added" if added_column else "already present"),
    )

    db = SessionLocal()
    try:
        status = seed_super_admin(db)
    finally:
        db.close()

    print(f"super_admin user '{SUPER_ADMIN_USERNAME}': {status}")


if __name__ == "__main__":
    main()
