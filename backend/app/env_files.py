"""Resolve the shared TransChap environment files (repo-root `.env` + optional `.env.local`)."""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def TransChap_env_name() -> str:
    """Logical environment name for runtime behaviour (not for picking env files).

    Prefer ``APP_ENV`` / ``TRANSCHAP_ENV`` when set; otherwise treat as ``dev``.
    """
    raw = os.environ.get("TRANSCHAP_ENV", "").strip().lower()
    if raw in {"prod", "production"}:
        return "prod"
    if raw in {"dev", "development", "local", "uat"}:
        return "dev"
    app_env = os.environ.get("APP_ENV", "").strip().lower()
    if app_env in {"production", "prod"}:
        return "prod"
    return "dev"


def TransChap_env_file() -> Path:
    return PROJECT_ROOT / ".env"


def TransChap_local_env_file() -> Path:
    return PROJECT_ROOT / ".env.local"


def TransChap_env_files() -> tuple[str, ...]:
    # pydantic-settings lets later files override earlier ones.
    files = [TransChap_env_file()]
    if TransChap_local_env_file().exists():
        files.append(TransChap_local_env_file())
    return tuple(str(f) for f in files)
