"""Extras get one recipe row per meal and supply, and existing single-supply extra recipes move over."""

from __future__ import annotations

import sys
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402
from app.models import ModifierOptionRecipe  # noqa: E402


def migrate() -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("modifier_options"):
            print("modifier_options table missing; skip extra recipes per meal.")
            return
        created = not inspector.has_table("modifier_option_recipes")
        ModifierOptionRecipe.__table__.create(conn, checkfirst=True)
        if not created:
            print("modifier_option_recipes already in place.")
            return

        legacy = conn.execute(
            text(
                """
                SELECT o.id, o.product_id, o.stock_qty, o.portion_unit, l.product_id AS menu_product_id
                FROM modifier_options o
                JOIN modifier_groups g ON g.id = o.group_id
                JOIN catalogue_modifier_groups l ON l.group_id = g.id
                WHERE g.is_extra = 1 AND o.product_id IS NOT NULL
                """
            )
        ).fetchall()
        now = datetime.utcnow()
        moved = 0
        for row in legacy:
            stock_qty = float(row.stock_qty or 1) or 1
            conn.execute(
                text(
                    """
                    INSERT INTO modifier_option_recipes
                        (id, option_id, menu_product_id, product_id, stock_qty, portions_per_unit,
                         portion_unit, sort_order, created_at)
                    VALUES (:id, :option_id, :menu, :product, :qty, :per_unit, :unit, 0, :now)
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "option_id": row.id,
                    "menu": row.menu_product_id,
                    "product": row.product_id,
                    "qty": stock_qty,
                    "per_unit": round(1 / stock_qty, 3),
                    "unit": row.portion_unit or "portions",
                    "now": now,
                },
            )
            moved += 1
    print(f"Created modifier_option_recipes; moved {moved} existing extra recipe row(s).")


if __name__ == "__main__":
    migrate()
