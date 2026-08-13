"""Resolve the shared DukAI environment file (repo-root `.env` only)."""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def dukai_env_name() -> str:
    """Logical environment name for runtime behaviour (not for picking env files).

    Prefer ``APP_ENV`` / ``DUKAI_ENV`` when set; otherwise treat as ``dev``.
    """
    raw = os.environ.get("DUKAI_ENV", "").strip().lower()
    if raw in {"prod", "production"}:
        return "prod"
    if raw in {"dev", "development", "local", "uat"}:
        return "dev"
    app_env = os.environ.get("APP_ENV", "").strip().lower()
    if app_env in {"production", "prod"}:
        return "prod"
    return "dev"


def dukai_env_file() -> Path:
    return PROJECT_ROOT / ".env"


def dukai_env_files() -> tuple[str, ...]:
    return (str(dukai_env_file()),)
