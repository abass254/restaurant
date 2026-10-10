"""Recipes (supplies each dish uses) and per-line stock usage for accurate restores."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

RECIPE_LINES_SQL = """
CREATE TABLE recipe_lines (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    account_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    ingredient_product_id VARCHAR(36) NOT NULL,
    quantity DECIMAL(12, 4) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES catalogue(id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_product_id) REFERENCES catalogue(id) ON DELETE CASCADE,
    CONSTRAINT uq_recipe_lines UNIQUE (account_id, product_id, ingredient_product_id)
)
"""


def _has_column(conn, table: str, column: str) -> bool:
    if not inspect(conn).has_table(table):
        return False
    return column in {col["name"] for col in inspect(conn).get_columns(table)}


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        if not inspect(conn).has_table("recipe_lines"):
            suffix = (
                " DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
                if conn.dialect.name == "mysql"
                else ""
            )
            conn.execute(text(RECIPE_LINES_SQL.rstrip() + suffix))
            notes.append("created table recipe_lines")
        indexes = {row["name"] for row in inspect(conn).get_indexes("recipe_lines")}
        if "recipe_lines_account_product_idx" not in indexes:
            conn.execute(
                text("CREATE INDEX recipe_lines_account_product_idx ON recipe_lines (account_id, product_id)")
            )
            notes.append("created index recipe_lines_account_product_idx")
        if not _has_column(conn, "order_items", "stock_usage"):
            conn.execute(text("ALTER TABLE order_items ADD COLUMN stock_usage JSON NULL"))
            notes.append("added order_items.stock_usage")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Recipe schema already in place.")


if __name__ == "__main__":
    main()
