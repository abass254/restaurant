"""Copy supply selling prices onto paid modifier options.

Options used to charge their linked supply's selling price when their own price was 0.
Each option now charges its own price, so paid options linked to a priced supply get
that price written onto them. Safe to re-run: only options still at 0 are touched.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import Session  # noqa: E402

from app.models import InventoryItem, ModifierGroup, ModifierOption  # noqa: E402


def copy_supply_prices(db: Session) -> int:
    rows = (
        db.query(ModifierOption, InventoryItem.selling_price)
        .join(ModifierGroup, ModifierGroup.id == ModifierOption.group_id)
        .join(
            InventoryItem,
            (InventoryItem.product_id == ModifierOption.product_id)
            & (InventoryItem.account_id == ModifierGroup.account_id),
        )
        .filter(
            ModifierGroup.included.isnot(True),
            ModifierOption.product_id.isnot(None),
            InventoryItem.selling_price.isnot(None),
            InventoryItem.selling_price > 0,
        )
        .all()
    )
    now = datetime.utcnow()
    changed = 0
    for option, price in rows:
        if option.price_delta and float(option.price_delta) > 0:
            continue
        option.price_delta = price
        option.updated_at = now
        changed += 1
    db.commit()
    return changed


def main() -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        print(f"priced {copy_supply_prices(db)} modifier option(s) from their supplies")
    finally:
        db.close()


if __name__ == "__main__":
    main()
