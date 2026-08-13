"""Tests for bot training chat coach."""

from __future__ import annotations

from app.services.bot_training_chat_service import split_training_reply


def test_split_training_reply_extracts_instructions_block():
    raw = (
        "Sounds good — I'll keep greetings short and warm.\n\n"
        "INSTRUCTIONS_UPDATE\n"
        "```\n"
        "• Greet in Swahili when they write in Swahili.\n"
        "• Keep replies under 3 sentences.\n"
        "```"
    )
    reply, instructions = split_training_reply(raw)
    assert reply == "Sounds good — I'll keep greetings short and warm."
    assert "Swahili" in (instructions or "")
    assert "3 sentences" in (instructions or "")


def test_split_training_reply_without_marker():
    raw = "What tone would you like for greetings?"
    reply, instructions = split_training_reply(raw)
    assert reply == raw
    assert instructions is None
