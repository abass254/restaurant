"""Create shop_expenses table for daily errands and operational expenses."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def _has_table(conn, table: str) -> bool:
    return inspect(conn).has_table(table)


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        if not _has_table(conn, "shop_expenses"):
            conn.execute(
                text(
                    """
                    CREATE TABLE shop_expenses (
                        id VARCHAR(36) NOT NULL PRIMARY KEY,
                        account_id VARCHAR(36) NOT NULL,
                        user_id VARCHAR(36) NULL,
                        title VARCHAR(255) NOT NULL,
                        category VARCHAR(64) NOT NULL DEFAULT 'errand',
                        amount DECIMAL(14, 2) NOT NULL,
                        payment_method VARCHAR(32) NOT NULL DEFAULT 'cash',
                        spent_at DATETIME NOT NULL,
                        notes TEXT NULL,
                        created_at DATETIME NULL,
                        updated_at DATETIME NULL,
                        FOREIGN KEY (account_id) REFERENCES accounts (id),
                        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
                    )
                    """
                )
            )
            conn.execute(
                text("CREATE INDEX ix_shop_expenses_account_spent_at ON shop_expenses (account_id, spent_at)")
            )
            conn.execute(
                text("CREATE INDEX ix_shop_expenses_account_created ON shop_expenses (account_id, created_at)")
            )
            notes.append("created shop_expenses table and indices")

    if notes:
        print("2026_10_21_140000_shop_expenses:", ", ".join(notes))
    else:
        print("2026_10_21_140000_shop_expenses: already up to date")


if __name__ == "__main__":
    main()
