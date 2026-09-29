"""Add opening stock and investment to accounts.

Idempotent — safe to re-run.
"""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _columns(conn) -> set[str]:
    if not inspect(conn).has_table("accounts"):
        return set()
    return {col["name"] for col in inspect(conn).get_columns("accounts")}


def main() -> None:
    with engine.begin() as conn:
        columns = _columns(conn)
        
        if "opening_stock" not in columns:
            conn.execute(
                text("ALTER TABLE accounts ADD COLUMN opening_stock NUMERIC(14, 2) NULL")
            )
            print("added accounts.opening_stock")
        else:
            print("accounts.opening_stock already exists.")

        if "opening_stock_set_at" not in columns:
            conn.execute(
                text("ALTER TABLE accounts ADD COLUMN opening_stock_set_at DATETIME NULL")
            )
            print("added accounts.opening_stock_set_at")
        else:
            print("accounts.opening_stock_set_at already exists.")
            
        if "opening_investment" not in columns:
            conn.execute(
                text("ALTER TABLE accounts ADD COLUMN opening_investment NUMERIC(14, 2) NULL")
            )
            print("added accounts.opening_investment")
        else:
            print("accounts.opening_investment already exists.")

        if "opening_investment_set_at" not in columns:
            conn.execute(
                text("ALTER TABLE accounts ADD COLUMN opening_investment_set_at DATETIME NULL")
            )
            print("added accounts.opening_investment_set_at")
        else:
            print("accounts.opening_investment_set_at already exists.")


if __name__ == "__main__":
    main()
