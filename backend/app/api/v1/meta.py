from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import JSONResponse

from app.config import Settings, get_settings
from app.core.meta_signed_request import parse_signed_request
from app.dependencies import ServiceContainer, get_services
from app.services.instagram_data_purge import InstagramDataPurgeService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/meta", tags=["meta"])


def _app_secret(settings: Settings) -> str:
    return settings.instagram_app_secret or settings.meta_app_secret


def _status_url(settings: Settings, confirmation_code: str) -> str:
    base = settings.frontend_url.rstrip("/")
    return f"{base}/data-deletion?code={confirmation_code}"


@router.post("/data-deletion")
async def meta_data_deletion_callback(
    request: Request,
    signed_request: str | None = Form(default=None),
    services: ServiceContainer = Depends(get_services),
    settings: Settings = Depends(get_settings),
):
    """Meta user data deletion callback (App Dashboard → Data deletion)."""
    secret = _app_secret(settings)
    if not secret:
        raise HTTPException(status_code=503, detail="Meta app secret is not configured.")

    payload_value = signed_request
    if not payload_value:
        form = await request.form()
        payload_value = form.get("signed_request")
        if isinstance(payload_value, bytes):
            payload_value = payload_value.decode("utf-8")

    if not payload_value or not isinstance(payload_value, str):
        raise HTTPException(status_code=400, detail="Missing signed_request.")

    payload = parse_signed_request(payload_value, secret)
    if not payload:
        raise HTTPException(status_code=400, detail="Invalid signed_request.")

    meta_user_id = str(payload.get("user_id") or "")
    if not meta_user_id:
        raise HTTPException(status_code=400, detail="Missing user_id in signed_request.")

    purge = InstagramDataPurgeService(services.db, settings, services.instagram_api)
    confirmation_code = purge.purge_by_meta_user_id(meta_user_id, source="meta_data_deletion")

    if not confirmation_code:
        confirmation_code = purge.record_noop_deletion(meta_user_id)

    logger.info(
        "Meta data deletion processed meta_user_id=%s confirmation=%s",
        meta_user_id,
        confirmation_code,
    )

    return JSONResponse(
        {
            "url": _status_url(settings, confirmation_code),
            "confirmation_code": confirmation_code,
        },
    )
