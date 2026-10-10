"""Let each restaurant define its own menu sections (Burgers, Breakfast, Drinks…)."""

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


def migrate() -> None:
    with engine.begin() as conn:
        if not inspect(conn).has_table("accounts"):
            print("accounts table missing; nothing to do.")
            return
        if not _has_column(conn, "accounts", "menu_sections"):
            conn.execute(text("ALTER TABLE accounts ADD COLUMN menu_sections JSON NULL"))
    print("Account menu sections column is ready.")


if __name__ == "__main__":
    migrate()
