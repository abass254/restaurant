from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.models import MerchantKraProfile

KRA_PIN_RE = re.compile(r"^[A-Z]\d{9}[A-Z]$", re.IGNORECASE)
INTEGRATION_TYPES = frozenset({"vscu", "oscu", "device"})


def normalize_kra_pin(value: str | None) -> str:
    return (value or "").strip().upper()


def validate_kra_pin(value: str) -> str:
    normalized = normalize_kra_pin(value)
    if not KRA_PIN_RE.fullmatch(normalized):
        raise ValueError("Enter a valid KRA PIN (e.g. P051234567X).")
    return normalized


def get_merchant_profile(
    db: Session,
    account_id: str,
) -> MerchantKraProfile | None:
    return (
        db.query(MerchantKraProfile)
        .filter(MerchantKraProfile.account_id == account_id)
        .first()
    )
