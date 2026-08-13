"""Add `users.username` and seed the platform's default super admin.

Two related but independent changes, bundled because the seeded super
admin is the very first user that *needs* the new column:

1. Adds a ``username`` ``VARCHAR(64)`` column to ``users`` (nullable,
   unique). Merchant accounts continue to authenticate by ``email``;
   ``username`` is reserved for admin-style logins (the super admin who
   manages every merchant on the platform).

2. Upserts a ``super_admin`` user with::

       username = "netizen"
       password = "password"   (hashed via app.core.security.hash_password)
       user_role = "super_admin"
       is_activated = True

   If a user with that username already exists, its role, password and
   activation flag are reset so the documented default ("netizen" /
   "password") always works in development. Re-running is safe.

The script is safe to invoke multiple times.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402
from app.models import User  # noqa: E402

SUPER_ADMIN_USERNAME = "netizen"
SUPER_ADMIN_DEFAULT_PASSWORD = "password"
SUPER_ADMIN_ROLE = "super_admin"
SUPER_ADMIN_DISPLAY_NAME = "Platform Super Admin"


def _add_username_column() -> bool:
    """Add ``users.username`` (nullable, unique) if it doesn't exist yet."""
    with engine.begin() as conn:
        cols = {c["name"] for c in inspect(conn).get_columns("users")}
        if "username" in cols:
            return False

        conn.execute(text("ALTER TABLE users ADD COLUMN username VARCHAR(64)"))
        # SQLite allows a partial unique index, but a regular one is fine
        # here since NULLs are treated as distinct.
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique "
                "ON users (username)",
            ),
        )
        return True


def _upsert_super_admin() -> str:
    """Ensure the netizen super admin exists with the documented password.

    Returns a short status string for the log line.
    """
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == SUPER_ADMIN_USERNAME).first()
        hashed = hash_password(SUPER_ADMIN_DEFAULT_PASSWORD)

        if user is None:
            user = User(
                name=SUPER_ADMIN_DISPLAY_NAME,
                username=SUPER_ADMIN_USERNAME,
                email=None,
                account_id=None,
                password=hashed,
                user_role=SUPER_ADMIN_ROLE,
                is_activated=True,
                require_change_password=False,
                created_at=now,
                updated_at=now,
            )
            db.add(user)
            db.commit()
            return "created"

        user.name = user.name or SUPER_ADMIN_DISPLAY_NAME
        user.user_role = SUPER_ADMIN_ROLE
        user.is_activated = True
        user.require_change_password = False
        user.password = hashed
        user.updated_at = now
        db.commit()
        return "reset"
    finally:
        db.close()


def main() -> None:
    added_column = _add_username_column()
    print(
        "users.username column: "
        + ("added" if added_column else "already present"),
    )

    status = _upsert_super_admin()
    print(
        f"super_admin user '{SUPER_ADMIN_USERNAME}': {status} "
        f"(default password: '{SUPER_ADMIN_DEFAULT_PASSWORD}')",
    )


if __name__ == "__main__":
    main()
