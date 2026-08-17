"""Merchant-safe M-PESA copy — never leak hub / Daraja internals."""

from __future__ import annotations

import re

_INTERNAL = re.compile(
    r"daraja|oauth|passkey|mpesa_sandbox|mpesa_consumer|mpesa_shortcode|\.env|"
    r"initiator|security credential|utility\s*[→\->]+\s*working|originator|"
    r"checkoutrequest|merchantrequest|access_token|consumer_key|consumer_secret|"
    r"businessshortcode|resultcode|hub paybill|hub shortcode|hub account|"
    r"b2b|b2c|wrong credentials|callback url|conversationid|developer\.safaricom",
    re.IGNORECASE,
)

COLLECTION_FAILED = (
    "The payment didn't go through. Ask the customer to try again."
)
PAYOUT_DELAYED = (
    "Payment was received. We're still sending it to your store. "
    "Contact support if it doesn't arrive."
)
STK_FAILED = (
    "Couldn't send the M-PESA prompt. Check the phone number and try again."
)
PAYMENTS_UNAVAILABLE = (
    "Payments aren't available right now. Try again shortly or contact support."
)


def _looks_internal(text: str) -> bool:
    return bool(_INTERNAL.search(text))


def merchant_safe_collection_desc(
    status: str | None,
    result_code: int | None,
    raw: str | None,
) -> str | None:
    text = (raw or "").strip()
    lowered = text.lower()
    status_l = (status or "").lower()

    if status_l == "pending":
        return "Waiting for the customer to enter their M-PESA PIN."
    if status_l == "cancelled" or result_code == 1032 or "cancelled" in lowered:
        return "The customer cancelled the M-PESA prompt."
    if result_code == 1037 or "did not respond" in lowered or "timeout" in lowered:
        return "The customer didn't complete the M-PESA prompt in time."
    if result_code == 2001 or ("wrong" in lowered and "pin" in lowered):
        return "The customer entered the wrong M-PESA PIN."
    if result_code == 1 or "insufficient" in lowered:
        return "The customer doesn't have enough M-PESA balance."
    if (
        result_code == 1001
        or "unable to lock" in lowered
        or "cannot be reached" in lowered
    ):
        return "Couldn't reach the customer's phone. Ask them to try again."
    if status_l == "success":
        return "Customer paid."
    if status_l == "failed":
        if text and not _looks_internal(text):
            return text
        return COLLECTION_FAILED
    if text and _looks_internal(text):
        return None
    return text or None


def merchant_safe_payout_desc(payout_status: str | None, raw: str | None) -> str | None:
    status = (payout_status or "").lower()
    text = (raw or "").strip()
    lowered = text.lower()

    if status == "success":
        return "Sent to your store."
    if status in {"queued", "pending"}:
        return "Sending this payment to your store…"
    if _looks_internal(text):
        return PAYOUT_DELAYED
    if "destination is missing" in lowered or (
        "not configured" in lowered and "payout" in lowered
    ):
        return (
            "Add your Till, Paybill, Pochi, or phone under Store basics "
            "so we can pay you out."
        )
    if "below" in lowered and "minimum" in lowered:
        return "This amount is below M-PESA's minimum for payout to your store."
    if status in {"failed", "skipped"}:
        return text or PAYOUT_DELAYED
    return text or None


def merchant_safe_stk_error(message: str | None) -> str:
    text = (message or "").strip()
    if not text:
        return STK_FAILED
    lowered = text.lower()
    if "invalid phone" in lowered or "use 254" in lowered:
        return "Enter a valid Kenyan M-PESA number (07XXXXXXXX or 2547XXXXXXXX)."
    if "not configured for this shop" in lowered:
        return "Set your payout details under Store basics before requesting a payment."
    if "paybill account number is missing" in lowered:
        return "Your Paybill account number is missing. Add it under Store basics."
    if "amount" in lowered and ("at least" in lowered or "minimum" in lowered):
        return text
    if _looks_internal(text):
        return PAYMENTS_UNAVAILABLE if "daraja" in lowered or ".env" in lowered else STK_FAILED
    return text
