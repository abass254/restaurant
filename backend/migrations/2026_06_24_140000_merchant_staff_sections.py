"""Add allowed_sections column for merchant staff access control."""

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
        if not _has_column(conn, "users", "allowed_sections"):
            conn.execute(text("ALTER TABLE users ADD COLUMN allowed_sections TEXT NULL"))
            notes.append("added users.allowed_sections")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Merchant staff sections schema already in place.")


if __name__ == "__main__":
    main()
