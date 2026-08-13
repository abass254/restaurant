from __future__ import annotations

import threading
import time

_lock = threading.Lock()
_participant: dict[str, float] = {}
_agent: dict[str, float] = {}


def _set(store: dict[str, float], conversation_id: str, *, duration_seconds: float = 8.0) -> None:
    expires_at = time.monotonic() + max(duration_seconds, 0.5)
    with _lock:
        current = store.get(conversation_id, 0.0)
        store[conversation_id] = max(current, expires_at)


def _clear(store: dict[str, float], conversation_id: str) -> None:
    with _lock:
        store.pop(conversation_id, None)


def _is_active(store: dict[str, float], conversation_id: str) -> bool:
    now = time.monotonic()
    with _lock:
        expires_at = store.get(conversation_id)
        if expires_at is None:
            return False
        if expires_at <= now:
            store.pop(conversation_id, None)
            return False
        return True


def set_typing(conversation_id: str, *, duration_seconds: float = 8.0) -> None:
    """Mark the customer as actively typing."""
    _set(_participant, conversation_id, duration_seconds=duration_seconds)


def clear_typing(conversation_id: str) -> None:
    _clear(_participant, conversation_id)


def is_typing(conversation_id: str) -> bool:
    return _is_active(_participant, conversation_id)


def set_agent_typing(conversation_id: str, *, duration_seconds: float = 4.0) -> None:
    """Mark the business/agent as composing a reply."""
    _set(_agent, conversation_id, duration_seconds=duration_seconds)


def clear_agent_typing(conversation_id: str) -> None:
    _clear(_agent, conversation_id)


def is_agent_typing(conversation_id: str) -> bool:
    return _is_active(_agent, conversation_id)
