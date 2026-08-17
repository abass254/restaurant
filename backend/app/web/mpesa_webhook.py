"""
Public Safaricom callback for STK Push results.

Safaricom does NOT sign callbacks. The only protections are:
- a hard-to-guess callback URL (we expose `/mpesa/callback`)
- matching against an in-flight CheckoutRequestID we already saved
Any callback that doesn't match a known transaction is dropped.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Request

from app.database import get_db
from app.services import mpesa_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["mpesa-webhook"])


@router.post("/mpesa/callback")
async def mpesa_callback(request: Request, db=Depends(get_db)):
    payload: dict[str, Any]
    try:
        payload = await request.json()
    except Exception:
        body = (await request.body()).decode("utf-8", errors="ignore")
        logger.warning("M-PESA callback non-JSON body: %s", body[:500])
        return {"ResultCode": 0, "ResultDesc": "Accepted"}

    logger.info("M-PESA callback received: %s", payload)
    try:
        mpesa_service.apply_callback(db, payload)
    except Exception:
        logger.exception("Failed to apply M-PESA callback")

    # Safaricom expects a 200 response with this exact shape.
    return {"ResultCode": 0, "ResultDesc": "Accepted"}


@router.post("/mpesa/b2b/result")
async def mpesa_b2b_result(request: Request, db=Depends(get_db)):
    payload: dict[str, Any]
    try:
        payload = await request.json()
    except Exception:
        body = (await request.body()).decode("utf-8", errors="ignore")
        logger.warning("M-PESA B2B result non-JSON body: %s", body[:500])
        return {"ResultCode": 0, "ResultDesc": "Accepted"}

    logger.info("M-PESA B2B result received: %s", payload)
    try:
        from app.services import mpesa_payout_service

        mpesa_payout_service.apply_b2b_result(db, payload)
    except Exception:
        logger.exception("Failed to apply M-PESA B2B result")

    return {"ResultCode": 0, "ResultDesc": "Accepted"}


@router.post("/mpesa/b2b/timeout")
async def mpesa_b2b_timeout(request: Request, db=Depends(get_db)):
    payload: dict[str, Any]
    try:
        payload = await request.json()
    except Exception:
        body = (await request.body()).decode("utf-8", errors="ignore")
        logger.warning("M-PESA B2B timeout non-JSON body: %s", body[:500])
        return {"ResultCode": 0, "ResultDesc": "Accepted"}

    logger.info("M-PESA B2B timeout received: %s", payload)
    try:
        from app.services import mpesa_payout_service

        mpesa_payout_service.apply_b2b_timeout(db, payload)
    except Exception:
        logger.exception("Failed to apply M-PESA B2B timeout")

    return {"ResultCode": 0, "ResultDesc": "Accepted"}


@router.post("/mpesa/b2c/result")
async def mpesa_b2c_result(request: Request, db=Depends(get_db)):
    payload: dict[str, Any]
    try:
        payload = await request.json()
    except Exception:
        body = (await request.body()).decode("utf-8", errors="ignore")
        logger.warning("M-PESA B2C result non-JSON body: %s", body[:500])
        return {"ResultCode": 0, "ResultDesc": "Accepted"}

    logger.info("M-PESA B2C result received: %s", payload)
    try:
        from app.services import mpesa_payout_service

        mpesa_payout_service.apply_b2b_result(db, payload)
    except Exception:
        logger.exception("Failed to apply M-PESA B2C result")

    return {"ResultCode": 0, "ResultDesc": "Accepted"}


@router.post("/mpesa/b2c/timeout")
async def mpesa_b2c_timeout(request: Request, db=Depends(get_db)):
    payload: dict[str, Any]
    try:
        payload = await request.json()
    except Exception:
        body = (await request.body()).decode("utf-8", errors="ignore")
        logger.warning("M-PESA B2C timeout non-JSON body: %s", body[:500])
        return {"ResultCode": 0, "ResultDesc": "Accepted"}

    logger.info("M-PESA B2C timeout received: %s", payload)
    try:
        from app.services import mpesa_payout_service

        mpesa_payout_service.apply_b2b_timeout(db, payload)
    except Exception:
        logger.exception("Failed to apply M-PESA B2C timeout")

    return {"ResultCode": 0, "ResultDesc": "Accepted"}


@router.post("/mpesa/balance/result")
async def mpesa_balance_result(request: Request, db=Depends(get_db)):
    payload: dict[str, Any]
    try:
        payload = await request.json()
    except Exception:
        body = (await request.body()).decode("utf-8", errors="ignore")
        logger.warning("M-PESA balance result non-JSON body: %s", body[:500])
        return {"ResultCode": 0, "ResultDesc": "Accepted"}

    logger.info("M-PESA balance result received: %s", payload)
    try:
        from app.services import mpesa_balance_service

        mpesa_balance_service.apply_balance_result(db, payload)
    except Exception:
        logger.exception("Failed to apply M-PESA balance result")

    return {"ResultCode": 0, "ResultDesc": "Accepted"}


@router.post("/mpesa/balance/timeout")
async def mpesa_balance_timeout(request: Request, db=Depends(get_db)):
    payload: dict[str, Any]
    try:
        payload = await request.json()
    except Exception:
        body = (await request.body()).decode("utf-8", errors="ignore")
        logger.warning("M-PESA balance timeout non-JSON body: %s", body[:500])
        return {"ResultCode": 0, "ResultDesc": "Accepted"}

    logger.info("M-PESA balance timeout received: %s", payload)
    try:
        from app.services import mpesa_balance_service

        mpesa_balance_service.apply_balance_timeout(db, payload)
    except Exception:
        logger.exception("Failed to apply M-PESA balance timeout")

    return {"ResultCode": 0, "ResultDesc": "Accepted"}
