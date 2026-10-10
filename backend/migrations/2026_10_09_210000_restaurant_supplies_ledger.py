"""Restaurant supplies: purchase orders, stock takes, ledger links and sale costing.

Additive only: new tables and nullable columns. Retail rows are untouched.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

PURCHASE_ORDERS_SQL = """
CREATE TABLE purchase_orders (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    account_id VARCHAR(36) NOT NULL,
    supplier_id VARCHAR(36) NULL,
    supplier_name VARCHAR(255) NULL,
    reference VARCHAR(32) NOT NULL,
    supplier_invoice_no VARCHAR(120) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'draft',
    order_date DATE NULL,
    expected_date DATE NULL,
    received_at DATETIME NULL,
    subtotal DECIMAL(14, 2) NOT NULL DEFAULT 0,
    discount DECIMAL(14, 2) NOT NULL DEFAULT 0,
    total DECIMAL(14, 2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(14, 2) NOT NULL DEFAULT 0,
    payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid',
    notes TEXT NULL,
    cancelled_reason VARCHAR(1000) NULL,
    created_by VARCHAR(36) NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES shop_suppliers(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT uq_purchase_orders_account_reference UNIQUE (account_id, reference)
)
"""

PURCHASE_ORDER_LINES_SQL = """
CREATE TABLE purchase_order_lines (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    purchase_order_id VARCHAR(36) NOT NULL,
    inventory_item_id VARCHAR(36) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    purchase_unit VARCHAR(64) NOT NULL,
    unit_factor DECIMAL(12, 4) NOT NULL DEFAULT 1,
    quantity_ordered DECIMAL(12, 3) NOT NULL,
    quantity_received DECIMAL(12, 3) NOT NULL DEFAULT 0,
    unit_cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
    line_total DECIMAL(14, 2) NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
)
"""

STOCK_TAKES_SQL = """
CREATE TABLE stock_takes (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    account_id VARCHAR(36) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    notes TEXT NULL,
    counted_at DATETIME NULL,
    created_by VARCHAR(36) NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
)
"""

STOCK_TAKE_LINES_SQL = """
CREATE TABLE stock_take_lines (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    stock_take_id VARCHAR(36) NOT NULL,
    inventory_item_id VARCHAR(36) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    expected_qty DECIMAL(12, 3) NULL,
    counted_qty DECIMAL(12, 3) NULL,
    variance_qty DECIMAL(12, 3) NULL,
    unit_cost DECIMAL(12, 2) NULL,
    FOREIGN KEY (stock_take_id) REFERENCES stock_takes(id) ON DELETE CASCADE,
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
    CONSTRAINT uq_stock_take_lines_item UNIQUE (stock_take_id, inventory_item_id)
)
"""

# (table, column, DDL type, foreign key target or None)
NEW_COLUMNS: list[tuple[str, str, str, str | None]] = [
    ("stock_movements", "total_cost", "DECIMAL(14, 2) NULL", None),
    ("stock_movements", "supplier_id", "VARCHAR(36) NULL", "shop_suppliers(id)"),
    ("stock_movements", "purchase_order_id", "VARCHAR(36) NULL", "purchase_orders(id)"),
    ("stock_movements", "purchase_order_line_id", "VARCHAR(36) NULL", "purchase_order_lines(id)"),
    ("stock_movements", "order_id", "VARCHAR(36) NULL", "orders(id)"),
    ("stock_movements", "order_item_id", "VARCHAR(36) NULL", "order_items(id)"),
    ("stock_movements", "stock_take_id", "VARCHAR(36) NULL", "stock_takes(id)"),
    ("inventory_items", "preferred_supplier_id", "VARCHAR(36) NULL", "shop_suppliers(id)"),
    ("order_items", "cost_total", "DECIMAL(12, 2) NULL", None),
    ("accounts", "block_sale_on_low_ingredients", "BOOLEAN NOT NULL DEFAULT 0", None),
]

NEW_INDEXES: list[tuple[str, str, str]] = [
    ("purchase_orders", "ix_purchase_orders_account_status", "account_id, status"),
    ("purchase_orders", "ix_purchase_orders_supplier", "supplier_id"),
    ("purchase_order_lines", "ix_purchase_order_lines_po", "purchase_order_id"),
    ("stock_takes", "ix_stock_takes_account_created", "account_id, created_at"),
    ("stock_movements", "ix_stock_movements_purchase_order", "purchase_order_id"),
    ("stock_movements", "ix_stock_movements_order", "order_id"),
]


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def _create_table(conn, name: str, sql: str, notes: list[str]) -> None:
    if inspect(conn).has_table(name):
        return
    suffix = (
        " DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        if conn.dialect.name == "mysql"
        else ""
    )
    conn.execute(text(sql.rstrip() + suffix))
    notes.append(f"created table {name}")


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        _create_table(conn, "purchase_orders", PURCHASE_ORDERS_SQL, notes)
        _create_table(conn, "purchase_order_lines", PURCHASE_ORDER_LINES_SQL, notes)
        _create_table(conn, "stock_takes", STOCK_TAKES_SQL, notes)
        _create_table(conn, "stock_take_lines", STOCK_TAKE_LINES_SQL, notes)

        for table, column, ddl, fk_target in NEW_COLUMNS:
            if _has_column(conn, table, column):
                continue
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
            notes.append(f"added {table}.{column}")
            if fk_target and conn.dialect.name == "mysql":
                conn.execute(
                    text(
                        f"ALTER TABLE {table} ADD CONSTRAINT fk_{table}_{column} "
                        f"FOREIGN KEY ({column}) REFERENCES {fk_target} ON DELETE SET NULL"
                    )
                )

        for table, index, columns in NEW_INDEXES:
            existing = {row["name"] for row in inspect(conn).get_indexes(table)}
            if index in existing:
                continue
            conn.execute(text(f"CREATE INDEX {index} ON {table} ({columns})"))
            notes.append(f"created index {index}")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Restaurant supplies schema already in place.")


if __name__ == "__main__":
    main()
