"""Create order_returns and order_return_items tables, and add returned_total / returned_quantity columns."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def _has_table(conn, table: str) -> bool:
    return inspect(conn).has_table(table)


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        insp = inspect(conn)

        if not insp.has_table("orders") or not insp.has_table("order_items"):
            print("orders or order_items table missing — run earlier migrations first")
            return

        # 1. Add returned_total to orders
        if not _has_column(conn, "orders", "returned_total"):
            conn.execute(
                text("ALTER TABLE orders ADD COLUMN returned_total NUMERIC(12, 2) NOT NULL DEFAULT 0"),
            )
            notes.append("added orders.returned_total")

        # 2. Add returned_quantity to order_items
        if not _has_column(conn, "order_items", "returned_quantity"):
            conn.execute(
                text("ALTER TABLE order_items ADD COLUMN returned_quantity INTEGER NOT NULL DEFAULT 0"),
            )
            notes.append("added order_items.returned_quantity")

        # 3. Create order_returns table
        if not _has_table(conn, "order_returns"):
            conn.execute(
                text(
                    """
                    CREATE TABLE order_returns (
                        id VARCHAR(36) NOT NULL PRIMARY KEY,
                        account_id VARCHAR(36) NOT NULL,
                        order_id VARCHAR(36) NOT NULL,
                        return_number VARCHAR(32) NOT NULL,
                        total_refunded DECIMAL(12, 2) NOT NULL DEFAULT 0,
                        refund_payment_method VARCHAR(20) NULL,
                        reason VARCHAR(255) NOT NULL,
                        notes TEXT NULL,
                        created_by_user_id VARCHAR(36) NULL,
                        created_at DATETIME NULL,
                        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
                        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
                        INDEX ix_order_returns_account_id (account_id),
                        INDEX ix_order_returns_order_id (order_id),
                        INDEX ix_order_returns_created_at (account_id, created_at)
                    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """,
                ),
            )
            notes.append("created table order_returns and indexes")

        # 4. Create order_return_items table
        if not _has_table(conn, "order_return_items"):
            conn.execute(
                text(
                    """
                    CREATE TABLE order_return_items (
                        id VARCHAR(36) NOT NULL PRIMARY KEY,
                        order_return_id VARCHAR(36) NOT NULL,
                        order_item_id VARCHAR(36) NOT NULL,
                        inventory_item_id VARCHAR(36) NULL,
                        product_name VARCHAR(255) NOT NULL,
                        quantity INTEGER NOT NULL,
                        unit_price DECIMAL(12, 2) NOT NULL,
                        refund_amount DECIMAL(12, 2) NOT NULL,
                        restock BOOLEAN NOT NULL DEFAULT 1,
                        condition_name VARCHAR(32) NOT NULL DEFAULT 'good',
                        created_at DATETIME NULL,
                        FOREIGN KEY (order_return_id) REFERENCES order_returns(id) ON DELETE CASCADE,
                        FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
                        FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE SET NULL,
                        INDEX ix_order_return_items_return_id (order_return_id),
                        INDEX ix_order_return_items_item_id (order_item_id)
                    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """,
                ),
            )
            notes.append("created table order_return_items and indexes")

    print("\n".join(notes) if notes else "order returns schema already up to date")


if __name__ == "__main__":
    main()
