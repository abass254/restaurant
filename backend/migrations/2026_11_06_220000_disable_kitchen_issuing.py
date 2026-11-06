"""Turn store and kitchen off for every shop that has it on.

Kitchen balances move back into the single store figure and pending kitchen
requests are cancelled. Safe to re-run: shops already off are skipped.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import Session  # noqa: E402

from app.models import Account  # noqa: E402
from app.services.kitchen_issue_service import disable_kitchen_issuing  # noqa: E402
from app.services.order_stock_service import kitchen_issuing_on  # noqa: E402


def disable_all(db: Session) -> int:
    accounts = db.query(Account).filter(Account.kitchen_issuing_enabled.is_(True)).all()
    changed = 0
    for account in accounts:
        if kitchen_issuing_on(account):
            disable_kitchen_issuing(db, account, user_id=None)
        else:
            account.kitchen_issuing_enabled = False
        db.commit()
        changed += 1
    return changed


def main() -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        print(f"turned store and kitchen off for {disable_all(db)} shop(s)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
