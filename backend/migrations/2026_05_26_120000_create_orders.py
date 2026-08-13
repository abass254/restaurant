"""Create the orders tables.

Three new tables:

* ``orders``                — order header (channel, fulfillment, status, totals)
* ``order_items``           — line items with snapshotted name/price
* ``order_status_history``  — audit log of every status change

Status state machine lives in ``app.support.order_status``. The migration
itself doesn't enforce values beyond the column being a string — the API
layer does the legal-transition check.

Idempotent — safe to re-run; will skip any table that's already there.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

ORDERS_SQL = """
CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    order_number VARCHAR(32) NOT NULL,
    source VARCHAR(20) NOT NULL,
    fulfillment_type VARCHAR(20) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'placed',
    source_conversation_id INTEGER,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(32),
    customer_email VARCHAR(255),
    delivery_address TEXT,
    delivery_notes TEXT,
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
    delivery_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
    discount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'KES',
    payment_method VARCHAR(20),
    mpesa_transaction_id INTEGER,
    placed_by_user_id INTEGER,
    placed_at DATETIME,
    paid_at DATETIME,
    prepared_at DATETIME,
    ready_at DATETIME,
    dispatched_at DATETIME,
    completed_at DATETIME,
    cancelled_at DATETIME,
    notes TEXT,
    created_at DATETIME,
    updated_at DATETIME,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (source_conversation_id) REFERENCES instagram_conversations(id) ON DELETE SET NULL,
    FOREIGN KEY (mpesa_transaction_id) REFERENCES mpesa_transactions(id) ON DELETE SET NULL,
    FOREIGN KEY (placed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
)
"""

ORDER_ITEMS_SQL = """
CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    inventory_item_id INTEGER,
    product_id INTEGER,
    product_name VARCHAR(255) NOT NULL,
    product_sku VARCHAR(120),
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    line_total NUMERIC(12, 2) NOT NULL,
    notes TEXT,
    created_at DATETIME,
    updated_at DATETIME,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE SET NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
)
"""

ORDER_STATUS_HISTORY_SQL = """
CREATE TABLE order_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    from_status VARCHAR(32),
    to_status VARCHAR(32) NOT NULL,
    changed_by_user_id INTEGER,
    note TEXT,
    created_at DATETIME,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
)
"""

INDEXES = [
    # orders
    ("orders_order_number_unique", "CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_unique ON orders (order_number)"),
    ("orders_account_id_status_index", "CREATE INDEX IF NOT EXISTS orders_account_id_status_index ON orders (account_id, status)"),
    ("orders_account_id_source_index", "CREATE INDEX IF NOT EXISTS orders_account_id_source_index ON orders (account_id, source)"),
    ("orders_account_id_fulfillment_type_index", "CREATE INDEX IF NOT EXISTS orders_account_id_fulfillment_type_index ON orders (account_id, fulfillment_type)"),
    ("orders_account_id_created_at_index", "CREATE INDEX IF NOT EXISTS orders_account_id_created_at_index ON orders (account_id, created_at)"),
    # order_items
    ("order_items_order_id_index", "CREATE INDEX IF NOT EXISTS order_items_order_id_index ON order_items (order_id)"),
    # order_status_history
    ("order_status_history_order_id_created_at_index", "CREATE INDEX IF NOT EXISTS order_status_history_order_id_created_at_index ON order_status_history (order_id, created_at)"),
]


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        insp = inspect(conn)

        if not insp.has_table("orders"):
            conn.execute(text(ORDERS_SQL))
            notes.append("created table orders")
        if not insp.has_table("order_items"):
            conn.execute(text(ORDER_ITEMS_SQL))
            notes.append("created table order_items")
        if not insp.has_table("order_status_history"):
            conn.execute(text(ORDER_STATUS_HISTORY_SQL))
            notes.append("created table order_status_history")

        # Refresh inspector so the new tables are visible for index creation.
        insp = inspect(conn)
        for table in ("orders", "order_items", "order_status_history"):
            if not insp.has_table(table):
                continue
        existing_indexes: set[str] = set()
        for table in ("orders", "order_items", "order_status_history"):
            if insp.has_table(table):
                for row in insp.get_indexes(table):
                    existing_indexes.add(row["name"])

        for name, sql in INDEXES:
            if name in existing_indexes:
                continue
            conn.execute(text(sql))
            notes.append(f"created index {name}")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Nothing to do — orders schema already in place.")


if __name__ == "__main__":
    main()
