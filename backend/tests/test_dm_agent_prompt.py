"""Tests for DM agent greeting / sales-closer prompt behaviour."""

from __future__ import annotations

from types import SimpleNamespace

from app.config import Settings
from app.services.dm_agent_service import build_system_prompt
from app.services.dm_agent_tools import merchant_script, normalize_opening_line


def test_normalize_opening_line_upgrades_legacy_template():
    legacy = (
        'On greetings, say: "Hello! I\'m DukAI, your sales assistant agent. '
        'Welcome to our shop!" then ask how you can help.'
    )
    normalized = normalize_opening_line(legacy)
    assert "Hello! I'm DukAI, your sales assistant agent" not in normalized
    assert "natural way" in normalized


def test_build_system_prompt_encourages_contextual_greetings():
    account = SimpleNamespace(
        username="testshop",
        display_name="Test Shop",
        name="Test Shop",
        account_id=None,
        platform="instagram",
        onboarding_checks={},
    )
    prompt = build_system_prompt(account)
    assert "wagwan" in prompt
    assert "uko aje" in prompt
    assert "Do NOT repeat the same canned English intro" in prompt
    assert 'reply in this style:\n  "Hello! I\'m DukAI' not in prompt


def test_build_system_prompt_includes_closer_playbook():
    account = SimpleNamespace(
        username="testshop",
        display_name="Test Shop",
        name="Test Shop",
        account_id=None,
        platform="instagram",
        onboarding_checks={},
    )
    prompt = build_system_prompt(account)
    assert "Mission:" in prompt
    assert "Own the conversation end-to-end" in prompt
    assert "Sales playbook:" in prompt
    assert "Ask clearly to order or book" in prompt
    assert "let me know if you need anything" in prompt
    assert "recommend_products" in prompt
    assert "Accuracy is mandatory" in prompt
    assert "gentle and straight to the point" in prompt
    assert "Work independently" in prompt


def test_build_system_prompt_includes_amend_order_rules():
    account = SimpleNamespace(
        username="testshop",
        display_name="Test Shop",
        name="Test Shop",
        account_id=None,
        platform="instagram",
        onboarding_checks={},
    )
    prompt = build_system_prompt(account)
    assert "amend_order" in prompt
    assert "Quantity changes on an existing order" in prompt
    assert "not_amendable" in prompt
    assert "never a vague" in prompt


def test_build_system_prompt_includes_response_guidelines():
    account = SimpleNamespace(
        username="testshop",
        display_name="Test Shop",
        name="Test Shop",
        account_id=None,
        platform="instagram",
        onboarding_checks={
            "sales_autopilot_script": {
                "response_guidelines": "Always mention same-day pickup.",
            },
        },
    )
    prompt = build_system_prompt(account)
    assert "Merchant instructions:" in prompt
    assert "Always mention same-day pickup." in prompt


def test_build_system_prompt_includes_tone_and_custom_payment_rule():
    account = SimpleNamespace(
        username="testshop",
        display_name="Test Shop",
        name="Test Shop",
        account_id=None,
        platform="instagram",
        onboarding_checks={
            "sales_autopilot_script": {
                "tone": "playful",
                "payment_rule_line": "Remind them pickup is cash only after placement.",
                "response_guidelines": "Be playful and use slang.",
            },
        },
    )
    prompt = build_system_prompt(account)
    assert "Tone: playful." in prompt
    assert "Remind them pickup is cash only after placement." in prompt
    assert "Be playful and use slang." in prompt


def test_build_system_prompt_omits_default_payment_rule_from_merchant_block():
    account = SimpleNamespace(
        username="testshop",
        display_name="Test Shop",
        name="Test Shop",
        account_id=None,
        platform="instagram",
        onboarding_checks={
            "sales_autopilot_script": {
                "payment_rule_line": (
                    "Do not handle payment or post-placement processing — "
                    "the shop sends those automatically."
                ),
            },
        },
    )
    prompt = build_system_prompt(account)
    merchant_block = prompt.split("Mission:")[0]
    assert "Do not handle payment or post-placement processing" not in merchant_block



def test_merchant_script_normalizes_stored_legacy_opening():
    account = SimpleNamespace(
        onboarding_checks={
            "sales_autopilot_script": {
                "opening_line": (
                    "On greetings, say: \"Hello! I'm DukAI, your sales assistant agent. "
                    "Welcome to our shop!\" then ask how you can help."
                ),
            },
        },
    )
    script = merchant_script(account)
    assert "Hello! I'm DukAI, your sales assistant agent" not in script["opening_line"]


def test_dm_agent_max_tool_rounds_default_is_six():
    settings = Settings()
    assert settings.dm_agent_max_tool_rounds == 6
