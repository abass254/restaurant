"""Merchant store status — pause / busy / station heartbeat / push subscribe."""

from __future__ import annotations

import hashlib
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import Account, Order, PushSubscription, User
from app.support.merchant_permissions import (
    active_account_id,
    assert_merchant_section_access,
)
from app.support.store_status import (
    pause_store,
    record_station_heartbeat,
    resume_store,
    set_busy,
    store_status_payload,
    sync_store_status,
)

router = APIRouter(prefix="/store-status", tags=["store-status"])


def _auth_user(db: Session, session: dict) -> User:
    user = require_user(db, session)
    assert_merchant_section_access(user, "orders")
    return user


def _account(db: Session, user: User) -> Account:
    account_id = active_account_id(user)
    if not account_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No active shop.")
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Shop not found.")
    return account


def _endpoint_hash(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()


class PauseRequest(BaseModel):
    duration_minutes: int | None = Field(default=None, ge=1, le=24 * 60)


class BusyRequest(BaseModel):
    extra_prep_minutes: int = Field(ge=0, le=120)


class PrepDefaultsRequest(BaseModel):
    default_prep_minutes: int = Field(ge=5, le=180)


class HeartbeatRequest(BaseModel):
    device_label: str | None = Field(default=None, max_length=120)


class PushSubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=8, max_length=2000)
    keys: dict[str, str]


class PushUnsubscribeRequest(BaseModel):
    endpoint: str | None = Field(default=None, max_length=2000)


class OrderPrepRequest(BaseModel):
    prep_minutes: int = Field(ge=5, le=180)


@router.get("")
def get_store_status(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = _auth_user(db, session)
    account = _account(db, user)
    if sync_store_status(account):
        db.commit()
        db.refresh(account)
    return {"data": store_status_payload(account)}


@router.post("/pause")
def pause_orders(
    payload: PauseRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_user(db, session)
    account = _account(db, user)
    pause_store(account, duration_minutes=payload.duration_minutes)
    db.commit()
    db.refresh(account)
    return {
        "message": "Store paused — online orders will not be accepted.",
        "data": store_status_payload(account),
    }


@router.post("/resume")
def resume_orders(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_user(db, session)
    account = _account(db, user)
    resume_store(account)
    db.commit()
    db.refresh(account)
    return {
        "message": "Store resumed — accepting orders again.",
        "data": store_status_payload(account),
    }


@router.post("/busy")
def set_busy_mode(
    payload: BusyRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_user(db, session)
    account = _account(db, user)
    set_busy(account, extra_prep_minutes=payload.extra_prep_minutes)
    db.commit()
    db.refresh(account)
    label = (
        f"Busy mode on (+{payload.extra_prep_minutes} min prep)."
        if payload.extra_prep_minutes > 0
        else "Busy mode cleared."
    )
    return {"message": label, "data": store_status_payload(account)}


@router.patch("/prep-defaults")
def update_prep_defaults(
    payload: PrepDefaultsRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_user(db, session)
    account = _account(db, user)
    account.default_prep_minutes = payload.default_prep_minutes
    db.commit()
    db.refresh(account)
    return {
        "message": "Default prep time updated.",
        "data": store_status_payload(account),
    }


@router.post("/heartbeat")
def station_heartbeat(
    payload: HeartbeatRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_user(db, session)
    account = _account(db, user)
    record_station_heartbeat(account)
    db.commit()
    db.refresh(account)
    return {
        "message": "Heartbeat recorded.",
        "data": store_status_payload(account),
        "device_label": payload.device_label,
    }


@router.post("/push-subscribe")
def push_subscribe(
    payload: PushSubscribeRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_user(db, session)
    account = _account(db, user)
    p256dh = (payload.keys.get("p256dh") or "").strip()
    auth = (payload.keys.get("auth") or "").strip()
    if not p256dh or not auth:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Push subscription keys are required.",
        )

    now = datetime.utcnow()
    eh = _endpoint_hash(payload.endpoint)
    existing = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint_hash == eh)
        .first()
    )
    if existing:
        existing.account_id = account.id
        existing.user_id = user.id
        existing.endpoint = payload.endpoint
        existing.p256dh = p256dh
        existing.auth = auth
        existing.user_agent = (request.headers.get("user-agent") or "")[:512] or None
        existing.updated_at = now
    else:
        db.add(
            PushSubscription(
                account_id=account.id,
                user_id=user.id,
                endpoint=payload.endpoint,
                endpoint_hash=eh,
                p256dh=p256dh,
                auth=auth,
                user_agent=(request.headers.get("user-agent") or "")[:512] or None,
                created_at=now,
                updated_at=now,
            ),
        )
    db.commit()
    return {"message": "Push subscription saved.", "data": {"ok": True}}


@router.post("/push-unsubscribe")
def push_unsubscribe(
    payload: PushUnsubscribeRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_user(db, session)
    account = _account(db, user)
    q = db.query(PushSubscription).filter(
        PushSubscription.account_id == account.id,
        PushSubscription.user_id == user.id,
    )
    if payload.endpoint:
        q = q.filter(PushSubscription.endpoint_hash == _endpoint_hash(payload.endpoint))
    deleted = q.delete(synchronize_session=False)
    db.commit()
    return {"message": "Push subscription removed.", "data": {"deleted": deleted}}


@router.patch("/orders/{order_id}/prep")
def update_order_prep(
    order_id: str,
    payload: OrderPrepRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = _auth_user(db, session)
    account = _account(db, user)
    order = (
        db.query(Order)
        .filter(Order.id == order_id, Order.account_id == account.id)
        .first()
    )
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Order not found.")
    order.prep_minutes = payload.prep_minutes
    order.updated_at = datetime.utcnow()
    db.commit()
    return {
        "message": f"Prep time set to {payload.prep_minutes} min.",
        "data": {"id": order.id, "prep_minutes": order.prep_minutes},
    }
