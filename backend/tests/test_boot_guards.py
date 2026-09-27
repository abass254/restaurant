"""Production debug lock and secret boot guards."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.config import Settings, effective_app_debug, env_is_production
from app.core.boot_guards import (
    BootConfigError,
    assert_production_secrets,
    fastapi_docs_kwargs,
)


def test_env_is_production() -> None:
    assert env_is_production("production") is True
    assert env_is_production("PROD") is True
    assert env_is_production("local") is False


def test_effective_app_debug_locked_in_production() -> None:
    assert effective_app_debug("production", True) is False
    assert effective_app_debug("local", True) is True
    assert effective_app_debug("local", False) is False


def test_settings_production_forces_debug_off() -> None:
    settings = Settings(app_env="production", app_debug=True)
    assert settings.app_debug is False
    assert settings.is_production is True


def test_database_pool_defaults_are_safe_for_shared_mysql() -> None:
    settings = Settings()
    assert settings.db_pool_size == 4
    assert settings.db_max_overflow == 1
    assert settings.db_pool_timeout_seconds == 15
    assert settings.db_connect_timeout_seconds == 10
    assert settings.db_read_timeout_seconds == 15
    assert settings.db_write_timeout_seconds == 15


def test_boot_guard_skips_local() -> None:
    settings = MagicMock()
    settings.app_env = "local"
    settings.session_secret = "change-me-in-production"
    settings.db_connection = "mysql"
    settings.db_password = "dukai"
    assert_production_secrets(settings)


def test_boot_guard_rejects_placeholder_session_secret() -> None:
    settings = MagicMock()
    settings.app_env = "production"
    settings.session_secret = "change-me-same-value-on-uat-and-prod"
    settings.db_connection = "mysql"
    settings.db_password = "correct-horse-battery"
    with pytest.raises(BootConfigError, match="SESSION_SECRET"):
        assert_production_secrets(settings)


def test_boot_guard_rejects_weak_mysql_password() -> None:
    settings = MagicMock()
    settings.app_env = "production"
    settings.session_secret = "a-sufficiently-long-secret"
    settings.db_connection = "mysql"
    settings.db_password = "dukai"
    with pytest.raises(BootConfigError, match="DB_PASSWORD"):
        assert_production_secrets(settings)


def test_boot_guard_allows_sqlite_without_mysql_password() -> None:
    settings = MagicMock()
    settings.app_env = "production"
    settings.session_secret = "a-sufficiently-long-secret"
    settings.db_connection = "sqlite"
    settings.db_password = ""
    assert_production_secrets(settings)


def test_fastapi_docs_hidden_when_not_debug() -> None:
    hidden = fastapi_docs_kwargs(debug=False)
    assert hidden == {"docs_url": None, "redoc_url": None, "openapi_url": None}
    assert fastapi_docs_kwargs(debug=True) == {}
