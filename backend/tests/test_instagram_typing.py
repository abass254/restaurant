from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.models import InstagramAccount, InstagramConversation
from app.services.agent_typing_signals import signal_agent_typing
from app.services.messaging_service import InstagramOutboundService


def test_signal_agent_typing_updates_inbox_and_sends_instagram_typing_on() -> None:
    account = InstagramAccount(platform="instagram", username="shop")
    account.access_token = MagicMock(return_value="token")  # type: ignore[method-assign]
    conversation = InstagramConversation(id="conv-1", participant_ig_id="customer-123")
    settings = MagicMock()
    instagram_api = MagicMock()

    with (
        patch("app.services.agent_typing_signals.set_agent_typing") as mock_inbox_typing,
        patch("app.services.agent_typing_signals.InstagramOutboundService") as mock_outbound_cls,
    ):
        mock_outbound = mock_outbound_cls.return_value
        signal_agent_typing(
            account,
            conversation,
            settings=settings,
            instagram_api=instagram_api,
            duration_seconds=3.0,
        )

    mock_inbox_typing.assert_called_once_with("conv-1", duration_seconds=3.0)
    mock_outbound.send_typing_on.assert_called_once_with(account, "customer-123")


def test_signal_agent_typing_skips_instagram_for_non_instagram_platform() -> None:
    account = InstagramAccount(platform="whatsapp", username="shop")
    conversation = InstagramConversation(id="conv-2", participant_ig_id="customer-456")
    settings = MagicMock()
    instagram_api = MagicMock()

    with (
        patch("app.services.agent_typing_signals.set_agent_typing") as mock_inbox_typing,
        patch("app.services.agent_typing_signals.InstagramOutboundService") as mock_outbound_cls,
    ):
        signal_agent_typing(
            account,
            conversation,
            settings=settings,
            instagram_api=instagram_api,
        )

    mock_inbox_typing.assert_called_once()
    mock_outbound_cls.assert_not_called()


def test_send_text_ends_instagram_typing_before_message() -> None:
    settings = MagicMock(instagram_fake_messaging=False)
    instagram_api = MagicMock()
    account = InstagramAccount(platform="instagram", username="shop")
    account.access_token = MagicMock(return_value="token")  # type: ignore[method-assign]
    instagram_api.send_text_message.return_value = {"message_id": "mid-1"}

    outbound = InstagramOutboundService(settings, instagram_api)
    outbound.send_text(
        account,
        "customer-123",
        "Hello",
        conversation_id="conv-3",
    )

    assert instagram_api.send_sender_action.call_args_list[0].args == (
        "customer-123",
        "typing_off",
        "token",
    )
    instagram_api.send_text_message.assert_called_once()


def test_send_typing_on_skips_fake_mode() -> None:
    settings = MagicMock(instagram_fake_messaging=True)
    instagram_api = MagicMock()
    account = InstagramAccount(platform="instagram", username="shop")

    with patch(
        "app.services.messaging_service.should_fake_instagram_outbound",
        return_value=True,
    ):
        outbound = InstagramOutboundService(settings, instagram_api)
        outbound.send_typing_on(account, "customer-123")

    instagram_api.send_sender_action.assert_not_called()
