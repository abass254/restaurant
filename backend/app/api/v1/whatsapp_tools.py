"""Deprecated merchant WhatsApp tools — platform openWA lives under /admin/whatsapp."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.session import require_user
from app.database import get_db
from app.dependencies import get_request_session
from app.support.internal_tools_access import require_internal_tools_user
from app.support.merchant_permissions import assert_merchant_section_access

router = APIRouter(prefix="/whatsapp-tools", tags=["whatsapp-tools"])


class WhatsappToolsStatusOut(BaseModel):
    enabled: bool
    configured: bool
    ready: bool
    message: str


@router.get("/status", response_model=WhatsappToolsStatusOut)
def whatsapp_tools_status(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "tools")
    require_internal_tools_user(user)
    return WhatsappToolsStatusOut(
        enabled=False,
        configured=False,
        ready=False,
        message=(
            "Customer WhatsApp notifications are managed from platform Admin → WhatsApp "
            "(openWA). Merchants do not connect a WhatsApp account."
        ),
    )


@router.post("/send-message")
def send_test_whatsapp_message(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    assert_merchant_section_access(user, "tools")
    require_internal_tools_user(user)
    raise HTTPException(
        status.HTTP_410_GONE,
        detail="Use Admin → WhatsApp to send test messages from the platform session.",
    )
