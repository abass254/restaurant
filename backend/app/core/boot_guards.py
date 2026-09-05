"""Fail closed when production env still has placeholder secrets."""

from __future__ import annotations

from app.config import Settings, env_is_production

WEAK_SESSION_SECRETS = frozenset(
    {
        "",
        "change-me",
        "change-me-in-production",
        "change-me-same-value-on-uat-and-prod",
    }
)
WEAK_DB_PASSWORDS = frozenset({"", "dukai", "root", "password"})

_MIN_SESSION_SECRET_LEN = 16


class BootConfigError(RuntimeError):
    """Raised when production settings are unsafe to boot."""


def fastapi_docs_kwargs(*, debug: bool) -> dict:
    if debug:
        return {}
    return {"docs_url": None, "redoc_url": None, "openapi_url": None}


def assert_production_secrets(settings: Settings) -> None:
    if not env_is_production(settings.app_env):
        return

    secret = (settings.session_secret or "").strip()
    if secret.lower() in WEAK_SESSION_SECRETS or len(secret) < _MIN_SESSION_SECRET_LEN:
        raise BootConfigError(
            "SESSION_SECRET is missing or too weak for production. "
            "Set a long random value in .env."
        )

    if settings.db_connection.strip().lower() == "sqlite":
        return

    password = (settings.db_password or "").strip()
    if password.lower() in WEAK_DB_PASSWORDS:
        raise BootConfigError(
            "DB_PASSWORD is missing or too weak for production. "
            "Do not use dukai, root, or password."
        )
