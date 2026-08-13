"""Add google_id to users for Google Sign-In.

Idempotent — safe to re-run.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        insp = inspect(conn)
        if not insp.has_table("users"):
            print("Nothing to do — users table missing.")
            return

        existing = {col["name"] for col in insp.get_columns("users")}
        if "google_id" not in existing:
            conn.execute(
                text("ALTER TABLE users ADD COLUMN google_id VARCHAR(255)"),
            )
            notes.append("added column users.google_id")

        # Unique index if missing (SQLite/MySQL both tolerate IF NOT EXISTS via try).
        indexes = {idx["name"] for idx in insp.get_indexes("users")}
        if "users_google_id_unique" not in indexes and "ix_users_google_id" not in indexes:
            try:
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX users_google_id_unique "
                        "ON users (google_id)",
                    ),
                )
                notes.append("added unique index users_google_id_unique")
            except Exception as exc:
                notes.append(f"index skipped: {exc}")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Nothing to do — users.google_id already present.")


if __name__ == "__main__":
    main()
