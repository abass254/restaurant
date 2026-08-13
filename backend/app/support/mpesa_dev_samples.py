"""Sample M-PESA config and transactions for platform dev runtime mode."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.support.daraja_sandbox import SANDBOX_TEST_MSISDN


def dev_merchant_config(account_id: str) -> dict:
    return {
        "id": "dev-sandbox",
        "account_id": account_id or "dev",
        "shortcode": "5575731",
        "shortcode_type": "till",
        "account_number": "DEVSHOP",
        "is_configured": True,
    }


def dev_transactions() -> list[dict]:
    """Representative STK push rows for the payments dashboard in dev mode."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return [
        {
            "id": "dev-txn-001",
            "phone_number": SANDBOX_TEST_MSISDN,
            "amount": 2500,
            "account_reference": "DEVSHOP",
            "transaction_desc": "Order pay",
            "status": "success",
            "result_code": 0,
            "result_desc": "The service request is processed successfully.",
            "mpesa_receipt_number": "QJK7ABC123",
            "merchant_request_id": "dev-mr-001",
            "checkout_request_id": "dev-co-001",
            "completed_at": now - timedelta(hours=2, minutes=14),
            "created_at": now - timedelta(hours=2, minutes=15),
            "transaction_account": "DEVSHOP",
            "payout_destination_shortcode": "5575731",
            "payout_destination_type": "till",
            "payout_status": "success",
            "payout_shortcode": "5575731",
            "payout_shortcode_type": "till",
            "payout_amount": 2500,
            "payout_receipt_number": "B2B9XYZ456",
            "payout_result_desc": "The service request is processed successfully.",
            "payout_completed_at": now - timedelta(hours=2, minutes=10),
        },
        {
            "id": "dev-txn-002",
            "phone_number": "254712345678",
            "amount": 850,
            "account_reference": "INV-0048",
            "transaction_desc": "Balance",
            "status": "pending",
            "result_code": None,
            "result_desc": "STK push sent. Awaiting customer PIN.",
            "mpesa_receipt_number": None,
            "merchant_request_id": "dev-mr-002",
            "checkout_request_id": "dev-co-002",
            "completed_at": None,
            "created_at": now - timedelta(minutes=8),
        },
        {
            "id": "dev-txn-003",
            "phone_number": "254722334455",
            "amount": 1200,
            "account_reference": "ORD-000139",
            "transaction_desc": "Order pay",
            "status": "failed",
            "result_code": 1,
            "result_desc": "Insufficient balance for the transaction.",
            "mpesa_receipt_number": None,
            "merchant_request_id": "dev-mr-003",
            "checkout_request_id": "dev-co-003",
            "completed_at": now - timedelta(days=1, hours=3),
            "created_at": now - timedelta(days=1, hours=3, minutes=2),
        },
        {
            "id": "dev-txn-004",
            "phone_number": "254733445566",
            "amount": 499,
            "account_reference": "WALK-IN",
            "transaction_desc": "POS sale",
            "status": "cancelled",
            "result_code": 1032,
            "result_desc": "Request cancelled by user.",
            "mpesa_receipt_number": None,
            "merchant_request_id": "dev-mr-004",
            "checkout_request_id": "dev-co-004",
            "completed_at": now - timedelta(days=2, hours=5),
            "created_at": now - timedelta(days=2, hours=5, minutes=1),
        },
    ]
