"""Track prepared portions and their equivalence on stock ledger entries."""

from __future__ import annotations

import sys
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402
from app.models import PreparedMenuStock  # noqa: E402


def main() -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("inventory_items"):
            print("inventory_items does not exist; run inventory migrations first")
            return

        for table_name in ("stock_movements", "order_items"):
            if not inspector.has_table(table_name):
                continue
            columns = {column["name"] for column in inspector.get_columns(table_name)}
            if "serving_unit" not in columns:
                conn.execute(
                    text(f"ALTER TABLE {table_name} ADD COLUMN serving_unit VARCHAR(32) NULL")
                )

        PreparedMenuStock.__table__.create(conn, checkfirst=True)
        tables = set(inspect(conn).get_table_names())
        item_columns = {
            column["name"] for column in inspect(conn).get_columns("inventory_items")
        }
        if "prepared_quantity" in item_columns:
            items = conn.execute(
                text(
                    "SELECT id, account_id, product_id, prepared_quantity "
                    "FROM inventory_items WHERE prepared_quantity IS NOT NULL"
                )
            ).mappings()
            for item in items:
                serving_unit = None
                if "recipe_serving_units" in tables:
                    serving_unit = conn.execute(
                        text(
                            "SELECT serving_unit FROM recipe_serving_units "
                            "WHERE account_id = :account_id AND product_id = :product_id "
                            "LIMIT 1"
                        ),
                        item,
                    ).scalar()
                if not serving_unit and "recipe_lines" in tables:
                    units = conn.execute(
                        text(
                            "SELECT DISTINCT serving_unit FROM recipe_lines "
                            "WHERE account_id = :account_id AND product_id = :product_id"
                        ),
                        item,
                    ).scalars().all()
                    if len(units) == 1:
                        serving_unit = units[0]
                serving_unit = serving_unit or "servings"
                exists = conn.execute(
                    text(
                        "SELECT 1 FROM prepared_menu_stocks "
                        "WHERE inventory_item_id = :inventory_item_id "
                        "AND serving_unit = :serving_unit"
                    ),
                    {"inventory_item_id": item["id"], "serving_unit": serving_unit},
                ).first()
                if not exists:
                    conn.execute(
                        text(
                            "INSERT INTO prepared_menu_stocks "
                            "(id, inventory_item_id, serving_unit, quantity, updated_at) "
                            "VALUES (:id, :inventory_item_id, :serving_unit, :quantity, CURRENT_TIMESTAMP)"
                        ),
                        {
                            "id": str(uuid4()),
                            "inventory_item_id": item["id"],
                            "serving_unit": serving_unit,
                            "quantity": item["prepared_quantity"],
                        },
                    )
    print("Prepared menu equivalence balances and ledger fields are ready.")


if __name__ == "__main__":
    main()
