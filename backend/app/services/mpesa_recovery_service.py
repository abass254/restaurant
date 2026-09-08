"""
Self-healing for lost Safaricom STK callbacks.

Safaricom does not guarantee callback delivery, and a tunnelled or briefly
unreachable callback host loses them outright. Any collection left ``pending``
past a short grace period is asked about directly with STK Push Query and
settled from Safaricom's answer.

Collections settled here are NOT paid out to the merchant: money only moves on
a deliberate Send to merchant in /admin/mpesa.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models import MpesaTransaction
from app.services import mpesa_service

logger = logging.getLogger(__name__)

# Safaricom answers "still being processed" for a while after the push, so give
# the customer time to enter their PIN before treating silence as a lost result.
DEFAULT_GRACE = timedelta(minutes=2)
# Don't chase rows so old that Safaricom no longer answers for them.
DEFAULT_MAX_AGE = timedelta(days=7)
DEFAULT_BATCH = 20


def _now_naive_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def stale_pending_collections(
    db: Session,
    *,
    grace: timedelta = DEFAULT_GRACE,
    max_age: timedelta = DEFAULT_MAX_AGE,
    limit: int = DEFAULT_BATCH,
) -> list[MpesaTransaction]:
    now = _now_naive_utc()
    return (
        db.query(MpesaTransaction)
        .filter(
            MpesaTransaction.status == "pending",
            MpesaTransaction.checkout_request_id.isnot(None),
            MpesaTransaction.created_at.isnot(None),
            MpesaTransaction.created_at < now - grace,
            MpesaTransaction.created_at > now - max_age,
        )
        .order_by(MpesaTransaction.created_at.desc())
        .limit(limit)
        .all()
    )


def sweep_pending_collections(
    db: Session,
    *,
    grace: timedelta = DEFAULT_GRACE,
    max_age: timedelta = DEFAULT_MAX_AGE,
    limit: int = DEFAULT_BATCH,
) -> dict[str, int]:
    """Resolve stuck collections against Safaricom. Returns a per-outcome count."""
    rows = stale_pending_collections(db, grace=grace, max_age=max_age, limit=limit)
    counts = {"checked": 0, "paid": 0, "failed": 0, "pending": 0, "errors": 0}

    for txn in rows:
        counts["checked"] += 1
        try:
            outcome = mpesa_service.refresh_pending_stk(db, txn, auto_payout=False)
        except Exception:
            counts["errors"] += 1
            db.rollback()
            logger.exception("STK recovery query failed txn=%s", txn.id)
            continue

        counts[outcome] = counts.get(outcome, 0) + 1
        if outcome == "paid":
            logger.warning(
                "STK recovery: Safaricom confirms txn=%s (KES %s, ref %s) was paid — "
                "callback was lost. Awaiting admin Send to merchant.",
                txn.id,
                txn.amount,
                txn.account_reference,
            )

    return counts


async def run_recovery_loop() -> None:
    """Background sweep, started from the app lifespan. Never raises."""
    import asyncio

    from app.config import get_settings
    from app.database import SessionLocal

    settings = get_settings()
    interval = max(30, int(settings.mpesa_stk_recovery_interval_seconds))
    grace = timedelta(seconds=max(30, int(settings.mpesa_stk_recovery_grace_seconds)))

    logger.info("M-PESA STK recovery sweep every %ss (grace %s)", interval, grace)
    while True:
        await asyncio.sleep(interval)
        try:
            db = SessionLocal()
            try:
                counts = await asyncio.to_thread(
                    sweep_pending_collections,
                    db,
                    grace=grace,
                )
            finally:
                db.close()
            if counts["checked"]:
                logger.info("M-PESA STK recovery sweep: %s", counts)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("M-PESA STK recovery sweep failed")
