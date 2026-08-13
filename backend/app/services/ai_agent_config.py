"""Resolve platform OpenAI (ChatGPT) credentials for DM and comment agents."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.models import AiAgentConfiguration


def get_active_config(db: Session) -> AiAgentConfiguration | None:
    return (
        db.query(AiAgentConfiguration)
        .filter(AiAgentConfiguration.is_active.is_(True))
        .order_by(AiAgentConfiguration.id.desc())
        .first()
    )


def resolve_openai_api_key(db: Session) -> str | None:
    config = get_active_config(db)
    if config and config.api_key.strip():
        return config.api_key.strip()
    env_key = get_settings().openai_api_key.strip()
    return env_key or None


def resolve_chat_model(db: Session, settings: Settings | None = None) -> str:
    base = settings or get_settings()
    config = get_active_config(db)
    if config and config.chat_model and config.chat_model.strip():
        return config.chat_model.strip()
    if base.dm_agent_model.strip():
        return base.dm_agent_model.strip()
    return base.openai_chat_model


def effective_agent_settings(settings: Settings, db: Session) -> Settings:
    """Apply database OpenAI config so saved admin keys drive the DM agent."""
    config = get_active_config(db)
    if not config or not config.api_key.strip():
        return settings
    updates: dict[str, str] = {
        "openai_api_key": config.api_key.strip(),
        "dm_agent_provider": "openai",
    }
    if config.chat_model and config.chat_model.strip():
        updates["dm_agent_model"] = config.chat_model.strip()
    return settings.model_copy(update=updates)
