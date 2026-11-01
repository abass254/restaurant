"""Self-serve forgot-password requests and reset tokens."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.core.password_reset_tokens import (
    PasswordResetTokenInvalid,
    mint_password_reset_token,
    password_fingerprint,
    read_password_reset_token,
)
from app.services.password_reset_service import (
    GENERIC_MESSAGE,
    request_password_reset,
)


def test_password_reset_token_round_trip() -> None:
    token = mint_password_reset_token("user-1", "hashed-password")
    payload = read_password_reset_token(token)
    assert payload["uid"] == "user-1"
    assert payload["fp"] == password_fingerprint("hashed-password")


def test_password_reset_token_rejects_garbage() -> None:
    try:
        read_password_reset_token("not-a-real-token")
    except PasswordResetTokenInvalid:
        return
    raise AssertionError("expected PasswordResetTokenInvalid")


def _user(**overrides) -> MagicMock:
    user = MagicMock()
    user.id = "user-1"
    user.email = "shop@example.com"
    user.name = "Amina"
    user.password = "hashed"
    user.is_activated = True
    user.is_super_admin.return_value = False
    for key, value in overrides.items():
        setattr(user, key, value)
    return user


def _db_with(user: MagicMock | None) -> MagicMock:
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = user
    return db


@patch("app.services.password_reset_service.send_password_reset_email")
@patch("app.services.password_reset_service.mint_password_reset_token")
def test_unknown_email_does_not_send(mock_mint, mock_send) -> None:
    result = request_password_reset(_db_with(None), "nobody@example.com")
    assert result["message"] == GENERIC_MESSAGE
    assert result["reset_link"] is None
    mock_mint.assert_not_called()
    mock_send.assert_not_called()


@patch("app.services.password_reset_service.send_password_reset_email")
@patch("app.services.password_reset_service.mint_password_reset_token")
def test_inactive_user_does_not_send(mock_mint, mock_send) -> None:
    result = request_password_reset(
        _db_with(_user(is_activated=False)),
        "shop@example.com",
    )
    assert result["message"] == GENERIC_MESSAGE
    mock_mint.assert_not_called()
    mock_send.assert_not_called()


@patch("app.services.password_reset_service.send_password_reset_email")
@patch("app.services.password_reset_service.mint_password_reset_token")
def test_super_admin_does_not_send(mock_mint, mock_send) -> None:
    user = _user()
    user.is_super_admin.return_value = True
    result = request_password_reset(_db_with(user), "shop@example.com")
    assert result["message"] == GENERIC_MESSAGE
    mock_mint.assert_not_called()
    mock_send.assert_not_called()


@patch("app.services.password_reset_service.get_settings")
@patch(
    "app.services.password_reset_service.send_password_reset_email",
    return_value=True,
)
@patch(
    "app.services.password_reset_service.mint_password_reset_token",
    return_value="signed-token",
)
def test_activated_user_sends_email(mock_mint, mock_send, mock_settings) -> None:
    mock_settings.return_value.frontend_url = "https://transchap.app"
    mock_settings.return_value.app_debug = False
    result = request_password_reset(_db_with(_user()), "SHOP@example.com")
    assert result["message"] == GENERIC_MESSAGE
    assert result["reset_link"] is None
    mock_mint.assert_called_once_with("user-1", "hashed")
    mock_send.assert_called_once()
    kwargs = mock_send.call_args.kwargs
    assert kwargs["to_email"] == "shop@example.com"
    assert kwargs["reset_link"].endswith("/reset-password?token=signed-token")


@patch("app.services.password_reset_service.get_settings")
@patch(
    "app.services.password_reset_service.send_password_reset_email",
    return_value=False,
)
@patch(
    "app.services.password_reset_service.mint_password_reset_token",
    return_value="signed-token",
)
def test_debug_returns_link_when_mail_fails(
    mock_mint, mock_send, mock_settings
) -> None:
    mock_settings.return_value.frontend_url = "http://127.0.0.1:7000"
    mock_settings.return_value.app_debug = True
    result = request_password_reset(_db_with(_user()), "shop@example.com")
    assert result["reset_link"] == (
        "http://127.0.0.1:7000/reset-password?token=signed-token"
    )
    mock_mint.assert_called_once()
    mock_send.assert_called_once()
