"""Expand the product catalog and rework the inventory pricing columns.

Changes:
  products:
    + product_code   VARCHAR(64)  UNIQUE   (auto-filled "PRD-{id:06d}")
    + sku            VARCHAR(120) (manufacturer SKU / barcode, indexed)
    + attributes     JSON         (category-specific structured info)
  inventory_items:
    - sku, price, cost_price  (removed; SKU now lives on the catalog)
    + buying_price   DECIMAL(12, 2)   (renamed from cost_price)
    + selling_price  DECIMAL(12, 2)   (renamed from price)

Idempotent — safe to re-run; will skip any change that's already applied.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow `python backend/migrations/<file>.py` from anywhere.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402


def _columns(conn, table: str) -> set[str]:
    return {row["name"] for row in inspect(conn).get_columns(table)}


def _table_exists(conn, table: str) -> bool:
    return inspect(conn).has_table(table)


def upgrade_products(conn) -> list[str]:
    """Add product_code, sku, attributes to products. Backfill product_code."""
    notes: list[str] = []
    cols = _columns(conn, "products")

    if "product_code" not in cols:
        conn.execute(text("ALTER TABLE products ADD COLUMN product_code VARCHAR(64)"))
        notes.append("added products.product_code")
    if "sku" not in cols:
        conn.execute(text("ALTER TABLE products ADD COLUMN sku VARCHAR(120)"))
        notes.append("added products.sku")
    if "attributes" not in cols:
        # SQLite stores JSON as TEXT; SQLAlchemy's JSON type handles encoding.
        conn.execute(text("ALTER TABLE products ADD COLUMN attributes TEXT"))
        notes.append("added products.attributes")

    # Backfill product_code for any rows that lack one.
    rows = conn.execute(
        text("SELECT id FROM products WHERE product_code IS NULL OR product_code = ''"),
    ).fetchall()
    for (pid,) in rows:
        code = f"PRD-{int(pid):06d}"
        conn.execute(
            text("UPDATE products SET product_code = :code WHERE id = :id"),
            {"code": code, "id": pid},
        )
    if rows:
        notes.append(f"backfilled product_code for {len(rows)} row(s)")

    # Indexes.
    existing_indexes = {
        row["name"] for row in inspect(conn).get_indexes("products")
    }
    if "products_product_code_unique" not in existing_indexes:
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS products_product_code_unique "
                "ON products (product_code)",
            ),
        )
        notes.append("created unique index products(product_code)")
    if "products_sku_index" not in existing_indexes:
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS products_sku_index ON products (sku)"),
        )
        notes.append("created index products(sku)")

    return notes


def upgrade_inventory_items(conn) -> list[str]:
    """Rename price->selling_price, cost_price->buying_price, drop sku.

    SQLite can't ALTER COLUMN or DROP COLUMN in older versions, so we use the
    standard table-rebuild recipe even though modern SQLite supports DROP/RENAME.
    """
    notes: list[str] = []

    if not _table_exists(conn, "inventory_items"):
        return notes

    cols = _columns(conn, "inventory_items")
    target = {
        "id",
        "account_id",
        "product_id",
        "buying_price",
        "selling_price",
        "stock_quantity",
        "low_stock_threshold",
        "is_active",
        "notes",
        "created_at",
        "updated_at",
    }
    if cols == target:
        return notes  # Already migrated.

    # Build the new table, copy data with column rename, swap, recreate indexes.
    conn.execute(text("DROP TABLE IF EXISTS inventory_items__new"))
    conn.execute(
        text(
            """
            CREATE TABLE inventory_items__new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                buying_price NUMERIC,
                selling_price NUMERIC,
                stock_quantity INTEGER,
                low_stock_threshold INTEGER,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                notes TEXT,
                created_at DATETIME,
                updated_at DATETIME,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
                UNIQUE(account_id, product_id)
            )
            """,
        ),
    )

    # Copy data with renamed columns. Older schema had cost_price + price + sku;
    # we keep the values and drop sku.
    select_cols = ["id", "account_id", "product_id"]
    select_cols.append("cost_price" if "cost_price" in cols else "NULL")
    select_cols.append("price" if "price" in cols else "NULL")
    select_cols.append("stock_quantity" if "stock_quantity" in cols else "NULL")
    select_cols.append(
        "low_stock_threshold" if "low_stock_threshold" in cols else "NULL",
    )
    select_cols.append("is_active" if "is_active" in cols else "1")
    select_cols.append("notes" if "notes" in cols else "NULL")
    select_cols.append("created_at" if "created_at" in cols else "NULL")
    select_cols.append("updated_at" if "updated_at" in cols else "NULL")

    conn.execute(
        text(
            f"""
            INSERT INTO inventory_items__new (
                id, account_id, product_id, buying_price, selling_price,
                stock_quantity, low_stock_threshold, is_active, notes,
                created_at, updated_at
            )
            SELECT {", ".join(select_cols)}
            FROM inventory_items
            """,
        ),
    )

    conn.execute(text("DROP TABLE inventory_items"))
    conn.execute(text("ALTER TABLE inventory_items__new RENAME TO inventory_items"))

    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS inventory_items_account_id_is_active_index "
            "ON inventory_items (account_id, is_active)",
        ),
    )

    notes.append("rebuilt inventory_items (renamed price/cost_price, dropped sku)")
    return notes


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        notes.extend(upgrade_products(conn))
        notes.extend(upgrade_inventory_items(conn))

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Nothing to do — schema is already at v2.")


if __name__ == "__main__":
    main()
