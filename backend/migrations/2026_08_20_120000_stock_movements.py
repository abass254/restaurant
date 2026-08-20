"""Create stock_movements ledger for barcode stock in / stock out.

Idempotent — safe to re-run.
"""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402


def _has_table(conn, table: str) -> bool:
    return table in inspect(conn).get_table_names()


def main() -> None:
    with engine.begin() as conn:
        if not _has_table(conn, "stock_movements"):
            conn.execute(
                text(
                    """
                    CREATE TABLE stock_movements (
                        id VARCHAR(36) PRIMARY KEY,
                        account_id VARCHAR(36) NOT NULL,
                        inventory_item_id VARCHAR(36) NOT NULL,
                        direction VARCHAR(8) NOT NULL,
                        quantity INT NOT NULL,
                        quantity_before INT NULL,
                        quantity_after INT NULL,
                        reason VARCHAR(32) NOT NULL,
                        note VARCHAR(500) NULL,
                        created_by VARCHAR(36) NULL,
                        created_at DATETIME NULL,
                        FOREIGN KEY (account_id) REFERENCES accounts(id),
                        FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
                        FOREIGN KEY (created_by) REFERENCES users(id)
                    )
                    """,
                ),
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX ix_stock_movements_account_created
                    ON stock_movements (account_id, created_at)
                    """,
                ),
            )
            conn.execute(
                text(
                    """
                    CREATE INDEX ix_stock_movements_item_created
                    ON stock_movements (inventory_item_id, created_at)
                    """,
                ),
            )
            print("Created stock_movements table.")
        else:
            print("Nothing to do — stock_movements already present.")


if __name__ == "__main__":
    main()
