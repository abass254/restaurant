"""Safaricom amount limits checked before STK collection or merchant payout.

Production B2C/B2B often rejects amounts under KES 10 with
"Declined due to limit rule: less than the minimum transaction amount."
STK can still accept KES 1, so we raise the collection floor to the payout
minimum when we already know how the merchant is paid.
"""

from __future__ import annotations

from app.config import get_settings


def min_payout_kes(shortcode_type: str | None, *, sandbox: bool) -> int:
    settings = get_settings()
    if sandbox:
        return max(1, int(settings.mpesa_min_sandbox_amount or 1))
    kind = (shortcode_type or "").lower()
    if kind in {"phone", "b2c", "msisdn", "pochi", "pochi_la_biashara"}:
        return max(1, int(settings.mpesa_min_b2c_amount or 10))
    return max(1, int(settings.mpesa_min_b2b_amount or 10))


def min_collection_kes(shortcode_type: str | None, *, sandbox: bool) -> int:
    settings = get_settings()
    stk_min = max(1, int(settings.mpesa_min_stk_amount or 1))
    return max(stk_min, min_payout_kes(shortcode_type, sandbox=sandbox))


def max_mpesa_kes() -> int:
    return max(1, int(get_settings().mpesa_max_amount or 150_000))


def amount_limit_message(
    amount: int,
    min_kes: int,
    *,
    label: str = "Amount",
) -> str | None:
    value = int(amount)
    ceiling = max_mpesa_kes()
    if value < min_kes:
        return (
            f"{label} must be at least KES {min_kes}. "
            "Safaricom declines smaller amounts (limit rule)."
        )
    if value > ceiling:
        return f"{label} cannot exceed KES {ceiling:,}."
    return None


def require_min_amount(
    amount: int,
    min_kes: int,
    *,
    label: str = "Amount",
) -> int:
    from app.services.mpesa_service import MpesaApiError

    value = int(amount)
    message = amount_limit_message(value, min_kes, label=label)
    if message:
        raise MpesaApiError(message)
    return value
