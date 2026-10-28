"""Distinguish meal extras from ordinary menu modifiers."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def migrate() -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("modifier_groups"):
            print("modifier_groups table missing; run the modifier groups migration first.")
            return

        columns = {column["name"] for column in inspector.get_columns("modifier_groups")}
        is_new_column = "is_extra" not in columns
        if is_new_column:
            conn.execute(
                text("ALTER TABLE modifier_groups ADD COLUMN is_extra BOOLEAN NOT NULL DEFAULT 0")
            )

    print("Modifier and extra groups are distinguished.")


if __name__ == "__main__":
    migrate()
