from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.models import InstagramAccount, User

# All channels the platform supports. Instagram is the only one with real
# OAuth + messaging today; the others use a lightweight manual-link flow
# and surface as "coming soon" for live messaging.
SUPPORTED_PLATFORMS: tuple[str, ...] = (
    "instagram",
    "instagram_beta",
    "facebook",
    "whatsapp",
    "tiktok",
)
DEFAULT_PLATFORM = "instagram"
MESSAGING_PLATFORMS: tuple[str, ...] = ("instagram", "instagram_beta", "whatsapp")
INSTAGRAM_BETA_PLATFORM = "instagram_beta"

# Internal preview platform for the bot modeler — not shown in Channels UI.
BOT_PLATFORM = "bot"
BOT_DM_PLATFORMS: tuple[str, ...] = ("instagram", BOT_PLATFORM)


class MerchantAccountRequired(RuntimeError):
    """Raised when an operation requires a shop (merchant) account_id."""


def require_merchant_account_id(user: User) -> str:
    from app.support.merchant_permissions import active_account_id

    try:
        account_id = active_account_id(user)
    except HTTPException:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "code": "merchant_account_required",
                "message": "This action requires a merchant shop account.",
            },
        )
    return str(account_id)


def _platform_query(db: Session, platform: str):
    return (
        db.query(InstagramAccount)
        .filter(InstagramAccount.platform == platform)
        .order_by(desc(InstagramAccount.updated_at), desc(InstagramAccount.id))
    )


def get_merchant_channel_account(
    db: Session,
    account_id: str,
    platform: str,
) -> InstagramAccount | None:
    """Return this merchant's connected channel for ``platform`` (at most one)."""
    if not account_id:
        return None
    return (
        db.query(InstagramAccount)
        .filter(
            InstagramAccount.account_id == account_id,
            InstagramAccount.platform == platform,
        )
        .order_by(desc(InstagramAccount.updated_at))
        .first()
    )


def get_merchant_instagram_account(db: Session, account_id: str) -> InstagramAccount | None:
    return get_merchant_channel_account(db, account_id, "instagram")


def get_merchant_instagram_beta_account(db: Session, account_id: str) -> InstagramAccount | None:
    return get_merchant_channel_account(db, account_id, INSTAGRAM_BETA_PLATFORM)


def get_merchant_bot_preview_account(db: Session, account_id: str) -> InstagramAccount | None:
    return get_merchant_channel_account(db, account_id, BOT_PLATFORM)


def supports_dm_bot(account: InstagramAccount) -> bool:
    """True when DmTicket/DmMenu bot pipeline applies to this account."""
    return (account.platform or DEFAULT_PLATFORM) in BOT_DM_PLATFORMS


def is_bot_preview_account(account: InstagramAccount) -> bool:
    return (account.platform or "") == BOT_PLATFORM


def channel_auto_replies_active(db: Session, account: InstagramAccount) -> bool:
    """Whether the bot should respond on this account (preview always on)."""
    if is_bot_preview_account(account):
        return True
    from app.services.platform_messaging_settings import auto_responses_paused

    if auto_responses_paused(db):
        return False
    return bool(getattr(account, "auto_replies_enabled", True))


def list_merchant_connected_channels(
    db: Session,
    account_id: str,
) -> dict[str, InstagramAccount | None]:
    if not account_id:
        return {platform: None for platform in SUPPORTED_PLATFORMS}
    rows = (
        db.query(InstagramAccount)
        .filter(InstagramAccount.account_id == account_id)
        .all()
    )
    by_platform = {row.platform: row for row in rows}
    return {platform: by_platform.get(platform) for platform in SUPPORTED_PLATFORMS}


def list_merchant_messaging_accounts(db: Session, account_id: str) -> list[InstagramAccount]:
    if not account_id:
        return []
    return (
        db.query(InstagramAccount)
        .filter(
            InstagramAccount.account_id == account_id,
            InstagramAccount.platform.in_(MESSAGING_PLATFORMS),
        )
        .order_by(desc(InstagramAccount.updated_at))
        .all()
    )


def find_channel_account_by_external_id(
    db: Session,
    platform: str,
    external_id: str,
) -> InstagramAccount | None:
    """Resolve a webhook/API id to exactly one merchant channel row."""
    if not external_id:
        return None
    matches = (
        db.query(InstagramAccount)
        .filter(
            InstagramAccount.platform == platform,
            (
                (InstagramAccount.instagram_user_id == external_id)
                | (InstagramAccount.instagram_scoped_id == external_id)
                | (InstagramAccount.instagram_webhook_ig_id == external_id)
            ),
        )
        .all()
    )
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    for row in matches:
        if str(row.instagram_user_id or "") == external_id:
            return row
    return matches[0]


def instagram_user_id_taken_by_other_merchant(
    db: Session,
    *,
    platform: str,
    instagram_user_id: str,
    account_id: str,
) -> InstagramAccount | None:
    if not instagram_user_id or str(instagram_user_id).startswith("manual_"):
        return None
    return (
        db.query(InstagramAccount)
        .filter(
            InstagramAccount.platform == platform,
            InstagramAccount.instagram_user_id == str(instagram_user_id),
            InstagramAccount.account_id != account_id,
        )
        .first()
    )


# --- Legacy platform-wide helpers (deprecated; prefer merchant-scoped) -----


def get_channel_account(
    db: Session,
    platform: str,
    settings: Settings | None = None,
) -> InstagramAccount | None:
    """Deprecated global lookup. Use :func:`get_merchant_channel_account`."""
    settings = settings or get_settings()
    if platform == "instagram" and settings.platform_instagram_account_id:
        row = db.get(InstagramAccount, settings.platform_instagram_account_id)
        if row is not None and row.platform == "instagram":
            return row
    return _platform_query(db, platform).first()


def get_platform_instagram_account(
    db: Session,
    settings: Settings | None = None,
    *,
    account_id: str | None = None,
) -> InstagramAccount | None:
    if account_id:
        return get_merchant_instagram_account(db, account_id)
    return get_channel_account(db, "instagram", settings)


def get_platform_messaging_account(
    db: Session,
    settings: Settings | None = None,
    *,
    account_id: str | None = None,
) -> InstagramAccount | None:
    if account_id:
        for platform in MESSAGING_PLATFORMS:
            account = get_merchant_channel_account(db, account_id, platform)
            if account is not None:
                return account
        return None
    settings = settings or get_settings()
    for platform in MESSAGING_PLATFORMS:
        account = get_channel_account(db, platform, settings)
        if account is not None:
            return account
    return None


def list_connected_channels(db: Session) -> dict[str, InstagramAccount | None]:
    """Deprecated global map. Use :func:`list_merchant_connected_channels`."""
    return {platform: get_channel_account(db, platform) for platform in SUPPORTED_PLATFORMS}


def require_merchant_instagram_account(db: Session, user: User) -> InstagramAccount:
    account_id = require_merchant_account_id(user)
    account = get_merchant_instagram_account(db, account_id)
    if account is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "code": "no_channel_connected",
                "message": "Connect your shop's Instagram account in Settings first.",
            },
        )
    return account


def require_platform_instagram_account(
    db: Session,
    settings: Settings | None = None,
    *,
    user: User | None = None,
) -> InstagramAccount:
    if user is not None:
        try:
            require_merchant_account_id(user)
            return require_merchant_instagram_account(db, user)
        except HTTPException:
            pass
    account = get_platform_instagram_account(db, settings)
    if account is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Platform Instagram account is not connected.",
        )
    return account


def user_can_manage_platform_instagram(user: User) -> bool:
    """Backwards-compatible helper — admins may manage any channel."""
    return user_can_manage_channels(user)


def user_can_manage_channels(user: User) -> bool:
    """Only shop owners can connect or disconnect channels."""
    return user.is_system_admin()


def normalize_platform(platform: str) -> str:
    value = (platform or "").strip().lower()
    if value not in SUPPORTED_PLATFORMS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported platform '{platform}'. Choose one of: {', '.join(SUPPORTED_PLATFORMS)}.",
        )
    return value


def channel_counts(db: Session) -> dict[str, int]:
    rows = (
        db.query(InstagramAccount.platform, func.count(InstagramAccount.id))
        .group_by(InstagramAccount.platform)
        .all()
    )
    return {platform: 0 for platform in SUPPORTED_PLATFORMS} | dict(rows)
