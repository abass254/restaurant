"""Rename products table to catalogue, create backward-compatible view, and create meal_addons table."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402
from app.database import engine  # noqa: E402


def main() -> None:
    with engine.begin() as conn:
        insp = inspect(conn)
        tables = set(insp.get_table_names())
        views = set(insp.get_view_names())

        # 1. Rename products -> catalogue (if catalogue doesn't exist yet)
        if "catalogue" not in tables and "products" in tables:
            print("Renaming table 'products' to 'catalogue'...")
            conn.execute(text("RENAME TABLE products TO catalogue;"))
            print("Successfully renamed 'products' to 'catalogue'.")
            tables.add("catalogue")
            tables.remove("products")
        elif "catalogue" in tables:
            print("Table 'catalogue' already exists.")

        # 2. Create backward-compatible VIEW 'products' if not present
        if "products" not in tables and "products" not in views and "catalogue" in tables:
            print("Creating backward-compatible view 'products' pointing to 'catalogue'...")
            conn.execute(text("CREATE VIEW products AS SELECT * FROM catalogue;"))
            print("Successfully created view 'products'.")
        elif "products" in views:
            print("View 'products' already exists.")

        # 3. Create meal_addons link table
        if "meal_addons" not in tables:
            print("Creating table 'meal_addons'...")
            dialect_name = conn.dialect.name
            if dialect_name == "sqlite":
                conn.execute(
                    text(
                        """
                        CREATE TABLE meal_addons (
                            id VARCHAR(36) PRIMARY KEY,
                            meal_id VARCHAR(36) NOT NULL,
                            addon_id VARCHAR(36) NOT NULL,
                            additional_price DECIMAL(10, 2) NULL,
                            is_default BOOLEAN NOT NULL DEFAULT 0,
                            is_required BOOLEAN NOT NULL DEFAULT 0,
                            max_quantity INTEGER DEFAULT 1,
                            sort_order INTEGER DEFAULT 0,
                            created_at DATETIME NULL,
                            FOREIGN KEY (meal_id) REFERENCES catalogue(id) ON DELETE CASCADE,
                            FOREIGN KEY (addon_id) REFERENCES catalogue(id) ON DELETE CASCADE,
                            UNIQUE(meal_id, addon_id)
                        );
                        """
                    )
                )
            else:
                conn.execute(
                    text(
                        """
                        CREATE TABLE meal_addons (
                            id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PRIMARY KEY,
                            meal_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
                            addon_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
                            additional_price DECIMAL(10, 2) NULL,
                            is_default BOOLEAN NOT NULL DEFAULT 0,
                            is_required BOOLEAN NOT NULL DEFAULT 0,
                            max_quantity INTEGER DEFAULT 1,
                            sort_order INTEGER DEFAULT 0,
                            created_at DATETIME NULL,
                            CONSTRAINT fk_meal_addons_meal FOREIGN KEY (meal_id) REFERENCES catalogue(id) ON DELETE CASCADE,
                            CONSTRAINT fk_meal_addons_addon FOREIGN KEY (addon_id) REFERENCES catalogue(id) ON DELETE CASCADE,
                            CONSTRAINT uq_meal_addons_meal_addon UNIQUE (meal_id, addon_id)
                        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                        """
                    )
                )
            print("Successfully created table 'meal_addons'.")
        else:
            print("Table 'meal_addons' already exists.")

        # 4. Migrate existing product_type from 'product' to 'retail' in catalogue
        if "catalogue" in tables:
            conn.execute(
                text(
                    "UPDATE catalogue SET product_type = 'retail' WHERE product_type = 'product' OR product_type IS NULL;"
                )
            )
            print("Migrated existing product_type 'product' to 'retail'.")


if __name__ == "__main__":
    main()
