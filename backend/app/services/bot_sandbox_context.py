"""Bot sandbox request scope — keeps Meta API calls out of dev training."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models import InstagramAccount

SANDBOX_LOGIN_PROVIDER = "bot_preview"

_bot_sandbox_messaging: ContextVar[bool] = ContextVar("bot_sandbox_messaging", default=False)


def is_bot_sandbox_messaging() -> bool:
    """True while handling /bot-sandbox API requests (never call Meta)."""
    return _bot_sandbox_messaging.get()


def is_bot_sandbox_account(account: InstagramAccount) -> bool:
    if (account.platform or "") == "bot":
        return True
    provider = (account.login_provider or "").strip().lower()
    if provider in (SANDBOX_LOGIN_PROVIDER, "bot_sandbox"):
        return True
    ig_id = str(account.instagram_user_id or "")
    return ig_id.startswith("bot_preview_") or ig_id.startswith("bot_sandbox_")


@contextmanager
def bot_sandbox_messaging_context():
    token = _bot_sandbox_messaging.set(True)
    try:
        yield
    finally:
        _bot_sandbox_messaging.reset(token)


def should_fake_instagram_outbound(account: InstagramAccount, *, fake_messaging_setting: bool) -> bool:
    return fake_messaging_setting or is_bot_sandbox_messaging() or is_bot_sandbox_account(account)
