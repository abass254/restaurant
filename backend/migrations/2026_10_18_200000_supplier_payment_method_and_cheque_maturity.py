"""Add payment_method and cheque_maturity_date to shop_supplier_payments."""

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
        if not insp.has_table("shop_supplier_payments"):
            print("shop_supplier_payments table missing — run earlier migration first")
            return

        columns = {col["name"] for col in insp.get_columns("shop_supplier_payments")}

        if "payment_method" not in columns:
            conn.execute(
                text("ALTER TABLE shop_supplier_payments ADD COLUMN payment_method VARCHAR(32) NULL DEFAULT 'mpesa'")
            )
            print("added shop_supplier_payments.payment_method")
        else:
            print("shop_supplier_payments.payment_method already exists")

        if "cheque_maturity_date" not in columns:
            conn.execute(
                text("ALTER TABLE shop_supplier_payments ADD COLUMN cheque_maturity_date DATE NULL")
            )
            print("added shop_supplier_payments.cheque_maturity_date")
        else:
            print("shop_supplier_payments.cheque_maturity_date already exists")


if __name__ == "__main__":
    main()
