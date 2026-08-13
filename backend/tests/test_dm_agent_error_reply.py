from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

from app.services.dm_agent_service import DmAgentService
from app.support.datetime_utils import utc_now


def _service() -> DmAgentService:
    return DmAgentService.__new__(DmAgentService)


def test_should_send_error_reply_when_no_prior_error_message() -> None:
    service = _service()
    conversation = SimpleNamespace(messages=[])
    assert service._should_send_error_reply(conversation, "temporary outage")


def test_should_not_repeat_error_reply_within_dedup_window() -> None:
    service = _service()
    now = utc_now()
    conversation = SimpleNamespace(
        messages=[
            SimpleNamespace(
                direction="outbound",
                body="temporary outage",
                sent_at=now - timedelta(seconds=30),
                created_at=now - timedelta(seconds=30),
            ),
        ],
    )
    assert not service._should_send_error_reply(conversation, "temporary outage")


def test_should_allow_error_reply_after_dedup_window() -> None:
    service = _service()
    now = utc_now()
    conversation = SimpleNamespace(
        messages=[
            SimpleNamespace(
                direction="outbound",
                body="temporary outage",
                sent_at=now - timedelta(minutes=3),
                created_at=now - timedelta(minutes=3),
            ),
        ],
    )
    assert service._should_send_error_reply(conversation, "temporary outage")
