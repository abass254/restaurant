"""Index ``users.phone`` for OTP login lookups."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

INDEX_NAME = "ix_users_phone"


def main() -> None:
    with engine.begin() as conn:
        if not inspect(conn).has_table("users"):
            print("users table missing — run earlier migrations first")
            return
        indexes = {idx["name"] for idx in inspect(conn).get_indexes("users")}
        if INDEX_NAME in indexes or "users_phone_index" in indexes:
            print(f"{INDEX_NAME} already exists")
            return
        dialect = conn.dialect.name
        if dialect == "sqlite":
            conn.execute(text(f"CREATE INDEX IF NOT EXISTS {INDEX_NAME} ON users (phone)"))
        else:
            conn.execute(text(f"CREATE INDEX {INDEX_NAME} ON users (phone)"))
        print(f"created {INDEX_NAME}")


if __name__ == "__main__":
    main()
