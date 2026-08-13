"""OpenAI (ChatGPT) configuration for the platform AI agent."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import AiAgentConfiguration, User
from app.services.ai_agent_config import get_active_config, resolve_openai_api_key
from app.services.openai_verify import verify_openai_api_key

router = APIRouter(prefix="/ai-agent", tags=["ai-agent"])


def _require_super_admin(user: User) -> None:
    if not user.is_super_admin():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only super admins can manage the AI agent configuration.",
        )


def _mask(value: str | None, keep: int = 6) -> str | None:
    if not value:
        return None
    if len(value) <= keep:
        return "*" * len(value)
    return value[:keep] + ("*" * (len(value) - keep))


class AiAgentConfigPayload(BaseModel):
    api_key: str = Field(min_length=1, max_length=500)
    chat_model: str | None = Field(default=None, max_length=120)


class AiAgentConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    api_key_masked: str | None
    chat_model: str | None
    is_active: bool
    is_configured: bool

    @classmethod
    def from_model(cls, config: AiAgentConfiguration | None) -> "AiAgentConfigOut | None":
        if not config:
            return None
        return cls(
            id=config.id,
            api_key_masked=_mask(config.api_key),
            chat_model=config.chat_model,
            is_active=bool(config.is_active),
            is_configured=True,
        )


class AiAgentTestPayload(BaseModel):
    api_key: str | None = Field(default=None, max_length=500)
    chat_model: str | None = Field(default=None, max_length=120)


class AiAgentTestOut(BaseModel):
    ok: bool
    message: str
    model: str | None = None


@router.get("/config")
def show_config(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    user = require_user(db, session)
    _require_super_admin(user)
    config = get_active_config(db)
    env_key = get_settings().openai_api_key.strip()
    return {
        "config": AiAgentConfigOut.from_model(config),
        "env_configured": bool(env_key),
        "active": bool(resolve_openai_api_key(db)),
        "provider": "openai" if resolve_openai_api_key(db) else None,
    }


@router.put("/config")
def upsert_config(
    payload: AiAgentConfigPayload,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    _require_super_admin(user)

    settings = get_settings()
    model = (payload.chat_model or "").strip() or settings.openai_chat_model

    config = get_active_config(db)
    now = datetime.utcnow()
    if config is None:
        config = AiAgentConfiguration(created_at=now)
        db.add(config)

    config.api_key = payload.api_key.strip()
    config.chat_model = model
    config.is_active = True
    config.updated_at = now

    db.commit()
    db.refresh(config)

    return {
        "message": "ChatGPT API key saved. The DM and comment agents will use OpenAI.",
        "config": AiAgentConfigOut.from_model(config),
    }


@router.delete("/config")
def delete_config(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    _require_super_admin(user)
    config = get_active_config(db)
    if config:
        db.delete(config)
        db.commit()
    return {"message": "AI agent configuration removed."}


@router.post("/test", response_model=AiAgentTestOut)
def test_config(
    request: Request,
    payload: AiAgentTestPayload,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(db, session)
    _require_super_admin(user)

    settings = get_settings()
    api_key = (payload.api_key or "").strip() or resolve_openai_api_key(db)
    if not api_key:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Save an API key or set OPENAI_API_KEY before running the test.",
        )

    model = (payload.chat_model or "").strip()
    if not model:
        config = get_active_config(db)
        model = (config.chat_model if config else None) or settings.openai_chat_model

    result = verify_openai_api_key(
        api_key,
        api_base=settings.openai_api_base,
        model=model,
    )
    return AiAgentTestOut(**result)
