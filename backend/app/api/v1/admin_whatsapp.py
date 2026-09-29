"""Platform admin — openWA WhatsApp session for notifications/alerts."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.v1.admin_auth import require_super_admin
from app.core.session import validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import User
from app.services.openwa_service import OpenWaAgentService

router = APIRouter(prefix="/admin/whatsapp", tags=["admin-whatsapp"])


class AdminWhatsappStatusOut(BaseModel):
    enabled: bool
    configured: bool
    reachable: bool
    ready: bool
    starting: bool
    state: str
    host_number: str | None = None
    host_name: str | None = None
    host_username: str | None = None
    connected_at: str | None = None
    has_qr: bool = False
    qr: str | None = None
    error: str | None = None
    session_id: str | None = None
    agent_error: str | None = None
    agent_url: str


class AdminWhatsappTestSendRequest(BaseModel):
    phone: str = Field(min_length=7, max_length=32)
    text: str = Field(min_length=1, max_length=2000)


class AdminWhatsappTestSendResponse(BaseModel):
    sent: bool
    message: str
    message_id: str | None = None


class AdminWhatsappActionResponse(BaseModel):
    ok: bool
    message: str


@router.get("/status", response_model=AdminWhatsappStatusOut)
def admin_whatsapp_status(
    _: User = Depends(require_super_admin),
):
    service = OpenWaAgentService()
    st = service.status()
    return AdminWhatsappStatusOut(
        enabled=bool(service.settings.openwa_enabled),
        configured=service.configured,
        reachable=st.reachable,
        ready=st.ready,
        starting=st.starting,
        state=st.state,
        host_number=st.host_number,
        host_name=st.host_name or st.host_username,
        host_username=st.host_username or st.host_name,
        connected_at=st.connected_at,
        has_qr=st.has_qr,
        qr=st.qr,
        error=st.error,
        session_id=st.session_id,
        agent_error=st.agent_error,
        agent_url=(service.settings.openwa_agent_url or "").rstrip("/")
        or "http://127.0.0.1:7010",
    )


@router.post("/send-message", response_model=AdminWhatsappTestSendResponse)
def admin_whatsapp_send_message(
    request: Request,
    payload: AdminWhatsappTestSendRequest,
    _: User = Depends(require_super_admin),
    session: dict = Depends(get_request_session),
    db: Session = Depends(get_db),
):
    del db  # auth dependency only
    validate_csrf(request, session)
    result = OpenWaAgentService().send_text(to=payload.phone, text=payload.text)
    if not result.ok:
        error = result.error or "WhatsApp agent did not send the message."
        if "not configured" in error.lower():
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=error)
        if "required" in error.lower():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=error)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=error)
    return AdminWhatsappTestSendResponse(
        sent=True,
        message="Message accepted by the WhatsApp agent.",
        message_id=result.message_id,
    )


@router.post("/logout", response_model=AdminWhatsappActionResponse)
def admin_whatsapp_logout(
    request: Request,
    _: User = Depends(require_super_admin),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    ok, message = OpenWaAgentService().logout()
    if not ok:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=message)
    return AdminWhatsappActionResponse(ok=True, message=message)


@router.post("/restart", response_model=AdminWhatsappActionResponse)
def admin_whatsapp_restart(
    request: Request,
    _: User = Depends(require_super_admin),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    ok, message = OpenWaAgentService().restart()
    if not ok:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=message)
    return AdminWhatsappActionResponse(ok=True, message=message)
