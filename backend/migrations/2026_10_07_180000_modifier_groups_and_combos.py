"""Option groups (Size, Choose drink…) and combo meals for restaurant menus.

Creates modifier_groups, modifier_options, catalogue_modifier_groups and
combo_components, then turns each dish's existing meal_addons into an
"Add-ons" group owned by the shop that created the dish.
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

TABLE_SUFFIX = " DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"

TABLES: list[tuple[str, str]] = [
    (
        "modifier_groups",
        """
        CREATE TABLE modifier_groups (
            id VARCHAR(36) NOT NULL PRIMARY KEY,
            account_id VARCHAR(36) NOT NULL,
            name VARCHAR(120) NOT NULL,
            min_select INTEGER NOT NULL DEFAULT 0,
            max_select INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NULL,
            updated_at DATETIME NULL,
            FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
        """,
    ),
    (
        "modifier_options",
        """
        CREATE TABLE modifier_options (
            id VARCHAR(36) NOT NULL PRIMARY KEY,
            group_id VARCHAR(36) NOT NULL,
            name VARCHAR(120) NOT NULL,
            price_delta DECIMAL(10, 2) NOT NULL DEFAULT 0,
            product_id VARCHAR(36) NULL,
            is_default BOOLEAN NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT 1,
            created_at DATETIME NULL,
            updated_at DATETIME NULL,
            FOREIGN KEY (group_id) REFERENCES modifier_groups(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES catalogue(id) ON DELETE SET NULL
        )
        """,
    ),
    (
        "catalogue_modifier_groups",
        """
        CREATE TABLE catalogue_modifier_groups (
            id VARCHAR(36) NOT NULL PRIMARY KEY,
            product_id VARCHAR(36) NOT NULL,
            group_id VARCHAR(36) NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NULL,
            FOREIGN KEY (product_id) REFERENCES catalogue(id) ON DELETE CASCADE,
            FOREIGN KEY (group_id) REFERENCES modifier_groups(id) ON DELETE CASCADE,
            CONSTRAINT uq_catalogue_modifier_groups UNIQUE (product_id, group_id)
        )
        """,
    ),
    (
        "combo_components",
        """
        CREATE TABLE combo_components (
            id VARCHAR(36) NOT NULL PRIMARY KEY,
            combo_id VARCHAR(36) NOT NULL,
            component_product_id VARCHAR(36) NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NULL,
            FOREIGN KEY (combo_id) REFERENCES catalogue(id) ON DELETE CASCADE,
            FOREIGN KEY (component_product_id) REFERENCES catalogue(id) ON DELETE CASCADE,
            CONSTRAINT uq_combo_components UNIQUE (combo_id, component_product_id)
        )
        """,
    ),
]

INDEXES: list[tuple[str, str, str]] = [
    ("modifier_groups", "modifier_groups_account_id_idx", "account_id"),
    ("modifier_options", "modifier_options_group_id_idx", "group_id"),
    ("catalogue_modifier_groups", "catalogue_modifier_groups_group_id_idx", "group_id"),
    ("combo_components", "combo_components_component_idx", "component_product_id"),
]


def _convert_meal_addons(conn) -> int:
    """Create one "Add-ons" group per dish that still only has meal_addons."""
    rows = conn.execute(
        text(
            """
            SELECT ma.meal_id, ma.addon_id, ma.additional_price, ma.is_default,
                   ma.sort_order, meal.created_by_account_id AS account_id,
                   addon.name AS addon_name
            FROM meal_addons ma
            JOIN catalogue meal ON meal.id = ma.meal_id
            JOIN catalogue addon ON addon.id = ma.addon_id
            WHERE meal.created_by_account_id IS NOT NULL
            ORDER BY ma.meal_id, ma.sort_order
            """
        )
    ).mappings().all()
    by_meal: dict[str, list] = {}
    for row in rows:
        by_meal.setdefault(row["meal_id"], []).append(row)

    converted = 0
    now = datetime.utcnow()
    for meal_id, links in by_meal.items():
        account_id = links[0]["account_id"]
        already = conn.execute(
            text(
                """
                SELECT 1 FROM catalogue_modifier_groups cmg
                JOIN modifier_groups g ON g.id = cmg.group_id
                WHERE cmg.product_id = :meal_id AND g.account_id = :account_id
                LIMIT 1
                """
            ),
            {"meal_id": meal_id, "account_id": account_id},
        ).first()
        if already:
            continue

        group_id = str(uuid.uuid4())
        conn.execute(
            text(
                """
                INSERT INTO modifier_groups
                    (id, account_id, name, min_select, max_select, sort_order, created_at, updated_at)
                VALUES (:id, :account_id, 'Add-ons', 0, :max_select, 0, :now, :now)
                """
            ),
            {"id": group_id, "account_id": account_id, "max_select": len(links), "now": now},
        )
        for index, link in enumerate(links):
            price = link["additional_price"]
            if price is None:
                inv_price = conn.execute(
                    text(
                        """
                        SELECT selling_price FROM inventory_items
                        WHERE account_id = :account_id AND product_id = :product_id
                        LIMIT 1
                        """
                    ),
                    {"account_id": account_id, "product_id": link["addon_id"]},
                ).scalar()
                price = inv_price or 0
            conn.execute(
                text(
                    """
                    INSERT INTO modifier_options
                        (id, group_id, name, price_delta, product_id, is_default,
                         sort_order, is_active, created_at, updated_at)
                    VALUES (:id, :group_id, :name, :price, :product_id, :is_default,
                            :sort_order, 1, :now, :now)
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "group_id": group_id,
                    "name": link["addon_name"][:120],
                    "price": price,
                    "product_id": link["addon_id"],
                    "is_default": bool(link["is_default"]),
                    "sort_order": index,
                    "now": now,
                },
            )
        conn.execute(
            text(
                """
                INSERT INTO catalogue_modifier_groups (id, product_id, group_id, sort_order, created_at)
                VALUES (:id, :product_id, :group_id, 0, :now)
                """
            ),
            {"id": str(uuid.uuid4()), "product_id": meal_id, "group_id": group_id, "now": now},
        )
        converted += 1
    return converted


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        suffix = TABLE_SUFFIX if conn.dialect.name == "mysql" else ""
        for table, sql in TABLES:
            if not inspect(conn).has_table(table):
                conn.execute(text(sql.rstrip() + suffix))
                notes.append(f"created table {table}")

        for table, index, column in INDEXES:
            existing = {row["name"] for row in inspect(conn).get_indexes(table)}
            if index not in existing:
                conn.execute(text(f"CREATE INDEX {index} ON {table} ({column})"))
                notes.append(f"created index {index}")

        if inspect(conn).has_table("meal_addons"):
            converted = _convert_meal_addons(conn)
            if converted:
                notes.append(f"converted add-ons on {converted} dish(es) into option groups")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Modifier groups schema already in place.")


if __name__ == "__main__":
    main()
