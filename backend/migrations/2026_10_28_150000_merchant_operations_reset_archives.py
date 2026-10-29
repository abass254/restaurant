"""Create merchant_operations_reset_archives table for 30-day reclaimable data resets."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import inspect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import engine  # noqa: E402
from app.models import MerchantOperationsResetArchive, ModifierOptionRecipe  # noqa: E402


def migrate() -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("accounts"):
            print("accounts table missing; skip reset archives migration.")
            return

        if not inspector.has_table("modifier_option_recipes"):
            ModifierOptionRecipe.__table__.create(conn, checkfirst=True)
            print("created modifier_option_recipes")
        else:
            print("modifier_option_recipes already exists")

        if not inspector.has_table("merchant_operations_reset_archives"):
            MerchantOperationsResetArchive.__table__.create(conn, checkfirst=True)
            print("created merchant_operations_reset_archives")
        else:
            print("merchant_operations_reset_archives already exists")

    print("Merchant operations reset archives table ready.")


if __name__ == "__main__":
    migrate()
