"""Store an equivalence on each recipe supply line."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402
from sqlalchemy.schema import CreateTable  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.models import RecipeLine  # noqa: E402


def main() -> None:
    notes: list[str] = []
    with engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("recipe_lines"):
            print("recipe_lines does not exist; migration skipped")
            return

        columns = {column["name"] for column in inspector.get_columns("recipe_lines")}
        if "serving_unit" not in columns:
            conn.execute(
                text(
                    "ALTER TABLE recipe_lines "
                    "ADD COLUMN serving_unit VARCHAR(32) NOT NULL DEFAULT 'servings'"
                )
            )
            notes.append("added recipe_lines.serving_unit")

        constraints = inspect(conn).get_unique_constraints("recipe_lines")
        target_columns = ["account_id", "product_id", "ingredient_product_id", "serving_unit"]
        has_target = any(
            constraint.get("column_names") == target_columns
            for constraint in constraints
        )
        if not has_target and inspect(conn).has_table("recipe_serving_units"):
            if conn.dialect.name == "mysql":
                conn.execute(
                    text(
                        "UPDATE recipe_lines AS rl "
                        "JOIN recipe_serving_units AS rsu "
                        "ON rsu.account_id = rl.account_id AND rsu.product_id = rl.product_id "
                        "SET rl.serving_unit = rsu.serving_unit "
                        "WHERE rsu.serving_unit IS NOT NULL AND TRIM(rsu.serving_unit) <> ''"
                    )
                )
            else:
                conn.execute(
                    text(
                        "UPDATE recipe_lines SET serving_unit = ("
                        "SELECT rsu.serving_unit FROM recipe_serving_units AS rsu "
                        "WHERE rsu.account_id = recipe_lines.account_id "
                        "AND rsu.product_id = recipe_lines.product_id "
                        "AND rsu.serving_unit IS NOT NULL AND TRIM(rsu.serving_unit) <> ''"
                        ") WHERE EXISTS (SELECT 1 FROM recipe_serving_units AS rsu "
                        "WHERE rsu.account_id = recipe_lines.account_id "
                        "AND rsu.product_id = recipe_lines.product_id "
                        "AND rsu.serving_unit IS NOT NULL AND TRIM(rsu.serving_unit) <> '')"
                    )
                )
            notes.append("backfilled recipe line equivalences from recipe_serving_units")

        if not has_target:
            old = next(
                (
                    constraint.get("name")
                    for constraint in constraints
                    if constraint.get("column_names")
                    == ["account_id", "product_id", "ingredient_product_id"]
                ),
                None,
            )
            if old is None:
                raise RuntimeError("Could not find the existing recipe_lines unique constraint.")
            if conn.dialect.name == "mysql":
                conn.execute(text(f"ALTER TABLE recipe_lines DROP INDEX `{old}`"))
                conn.execute(
                    text(
                        "ALTER TABLE recipe_lines ADD CONSTRAINT uq_recipe_lines "
                        "UNIQUE (account_id, product_id, ingredient_product_id, serving_unit)"
                    )
                )
            elif conn.dialect.name == "sqlite":
                rebuilt = RecipeLine.__table__.to_metadata(
                    Base.metadata,
                    name="recipe_lines_rebuild",
                )
                conn.execute(text("DROP TABLE IF EXISTS recipe_lines_rebuild"))
                conn.execute(CreateTable(rebuilt))
                conn.execute(
                    text(
                        "INSERT INTO recipe_lines_rebuild "
                        "(id, account_id, product_id, ingredient_product_id, quantity, "
                        "serving_unit, sort_order, created_at) "
                        "SELECT id, account_id, product_id, ingredient_product_id, quantity, "
                        "serving_unit, sort_order, created_at FROM recipe_lines"
                    )
                )
                conn.execute(text("DROP TABLE recipe_lines"))
                conn.execute(
                    text("ALTER TABLE recipe_lines_rebuild RENAME TO recipe_lines")
                )
                conn.execute(
                    text(
                        "CREATE INDEX recipe_lines_account_product_idx "
                        "ON recipe_lines (account_id, product_id)"
                    )
                )
            else:
                raise RuntimeError(
                    "Replacing the recipe_lines unique constraint requires MySQL or SQLite."
                )
            notes.append("updated recipe_lines uniqueness to include serving_unit")

    if notes:
        print("Migration applied:")
        for note in notes:
            print(f"  - {note}")
    else:
        print("Recipe-line equivalence schema already in place.")


if __name__ == "__main__":
    main()
