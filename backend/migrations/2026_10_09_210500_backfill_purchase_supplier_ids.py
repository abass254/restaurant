"""Restaurant shops: link old purchase movements to suppliers by the name in their note.

Older purchases kept the supplier only as the first " · " part of the note
(see ``buildPurchaseNote`` in the frontend). Retail shops are left alone.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect, text  # noqa: E402

from app.database import engine  # noqa: E402

_META_PREFIX = re.compile(r"^(Ref|Status|Date|Pay|Loc|Doc)\b", re.IGNORECASE)


def supplier_label(note: str | None) -> str | None:
    raw = (note or "").strip()
    if not raw:
        return None
    first = raw.split(" · ")[0].strip()
    if not first or _META_PREFIX.match(first):
        return None
    return first


def main() -> None:
    with engine.begin() as conn:
        if "supplier_id" not in {c["name"] for c in inspect(conn).get_columns("stock_movements")}:
            print("stock_movements.supplier_id missing; run the restaurant supplies migration first.")
            return
        suppliers = conn.execute(
            text(
                "SELECT s.id, s.account_id, s.name FROM shop_suppliers s "
                "JOIN accounts a ON a.id = s.account_id WHERE a.store_type = 'restaurant'"
            )
        ).all()
        by_account: dict[str, dict[str, str]] = {}
        for supplier_id, account_id, name in suppliers:
            by_account.setdefault(str(account_id), {})[(name or "").strip().lower()] = str(supplier_id)
        if not by_account:
            print("No restaurant suppliers to link.")
            return

        rows = conn.execute(
            text(
                "SELECT m.id, m.account_id, m.note FROM stock_movements m "
                "JOIN accounts a ON a.id = m.account_id "
                "WHERE a.store_type = 'restaurant' AND m.reason = 'receive' "
                "AND m.supplier_id IS NULL AND m.note IS NOT NULL"
            )
        ).all()
        linked = 0
        for movement_id, account_id, note in rows:
            label = supplier_label(note)
            supplier_id = by_account.get(str(account_id), {}).get((label or "").lower())
            if not supplier_id:
                continue
            conn.execute(
                text("UPDATE stock_movements SET supplier_id = :sid WHERE id = :mid"),
                {"sid": supplier_id, "mid": movement_id},
            )
            linked += 1
    print(f"Linked {linked} restaurant purchase movement(s) to suppliers.")


if __name__ == "__main__":
    main()
