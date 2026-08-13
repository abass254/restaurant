"""Add accounts.logo_url for store logo on Basics.

Idempotent — safe to re-run.
"""

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
    with engine.begin() as conn:
        if _has_column(conn, "accounts", "logo_url"):
            print("accounts.logo_url already exists.")
            return
        conn.execute(text("ALTER TABLE accounts ADD COLUMN logo_url VARCHAR(500) NULL"))
        print("added accounts.logo_url")


if __name__ == "__main__":
    main()
