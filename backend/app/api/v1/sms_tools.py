"""Internal tools — Africa's Talking SMS tester."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.services.africastalking_service import AfricasTalkingSmsService
from app.support.internal_tools_access import require_internal_tools_user
from app.support.merchant_permissions import assert_merchant_section_access

router = APIRouter(prefix="/sms-tools", tags=["sms-tools"])


class SmsToolsStatusOut(BaseModel):
    configured: bool
    sandbox: bool
    sender_id_set: bool
    ready: bool


class SmsTestSendRequest(BaseModel):
    phone: str = Field(min_length=7, max_length=32)
    text: str = Field(min_length=1, max_length=480)


class SmsTestSendResponse(BaseModel):
    sent: bool
    message: str
    message_id: str | None = None


@router.get("/status", response_model=SmsToolsStatusOut)
def sms_tools_status(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "tools")
    require_internal_tools_user(user)
    service = AfricasTalkingSmsService()
    return SmsToolsStatusOut(
        configured=service.configured,
        sandbox=service.sandbox,
        sender_id_set=bool((service.settings.africastalking_sender_id or "").strip()),
        ready=service.configured,
    )


@router.post("/send-message", response_model=SmsTestSendResponse)
def send_test_sms_message(
    request: Request,
    payload: SmsTestSendRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "tools")
    require_internal_tools_user(user)

    result = AfricasTalkingSmsService().send_text(
        to=payload.phone,
        text=payload.text,
    )
    if not result.ok:
        error = result.error or "Africa's Talking did not send the SMS."
        if "not configured" in error.lower():
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=error)
        if "required" in error.lower():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=error)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=error)
    return SmsTestSendResponse(
        sent=True,
        message="Message accepted by Africa's Talking.",
        message_id=result.message_id,
    )
