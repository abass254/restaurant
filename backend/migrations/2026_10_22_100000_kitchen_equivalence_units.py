"""Store each shop's available menu equivalence measures."""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402
from app.models import KitchenEquivalenceUnit  # noqa: E402


def main() -> None:
    table = KitchenEquivalenceUnit.__table__
    with engine.begin() as conn:
        if not inspect(conn).has_table(table.name):
            table.create(bind=conn)
            print("created kitchen_equivalence_units")
        else:
            print("kitchen_equivalence_units already up to date")
        if inspect(conn).has_table("recipe_serving_units"):
            units = conn.execute(
                text(
                    "SELECT DISTINCT account_id, serving_unit "
                    "FROM recipe_serving_units "
                    "WHERE serving_unit IS NOT NULL AND TRIM(serving_unit) <> ''"
                )
            ).fetchall()
            imported = 0
            for account_id, name in units:
                exists = conn.execute(
                    text(
                        "SELECT 1 FROM kitchen_equivalence_units "
                        "WHERE account_id = :account_id AND name = :name"
                    ),
                    {"account_id": account_id, "name": name},
                ).first()
                if exists:
                    continue
                conn.execute(
                    text(
                        "INSERT INTO kitchen_equivalence_units "
                        "(id, account_id, name, sort_order) "
                        "VALUES (:id, :account_id, :name, 0)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "account_id": account_id,
                        "name": name,
                    },
                )
                imported += 1
            if imported:
                print(f"imported {imported} existing recipe measures")


if __name__ == "__main__":
    main()
