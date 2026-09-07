"""Internal tools — WasenderAPI send-message tester."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.services.wasender_service import WasenderApiService
from app.support.internal_tools_access import require_internal_tools_user
from app.support.merchant_permissions import assert_merchant_section_access

router = APIRouter(prefix="/whatsapp-tools", tags=["whatsapp-tools"])


class WhatsappToolsStatusOut(BaseModel):
    enabled: bool
    configured: bool
    ready: bool


class WhatsappTestSendRequest(BaseModel):
    phone: str = Field(min_length=7, max_length=32)
    text: str = Field(min_length=1, max_length=2000)


class WhatsappTestSendResponse(BaseModel):
    sent: bool
    message: str
    message_id: str | None = None


@router.get("/status", response_model=WhatsappToolsStatusOut)
def whatsapp_tools_status(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "tools")
    require_internal_tools_user(user)
    service = WasenderApiService()
    return WhatsappToolsStatusOut(
        enabled=bool(service.settings.wasender_enabled),
        configured=service.configured,
        ready=service.configured,
    )


@router.post("/send-message", response_model=WhatsappTestSendResponse)
def send_test_whatsapp_message(
    request: Request,
    payload: WhatsappTestSendRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_access(user, "tools")
    require_internal_tools_user(user)

    result = WasenderApiService().send_text(
        to=payload.phone,
        text=payload.text,
    )
    if not result.ok:
        error = result.error or "Wasender did not send the message."
        if "not configured" in error.lower():
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=error)
        if "required" in error.lower():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=error)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=error)
    return WhatsappTestSendResponse(
        sent=True,
        message="Message accepted by WasenderAPI.",
        message_id=result.message_id,
    )
