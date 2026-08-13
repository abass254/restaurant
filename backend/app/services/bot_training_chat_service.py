"""Conversational coach for refining merchant DM agent instructions."""


from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount
from app.services.ai_agent_config import effective_agent_settings
from app.services.dm_agent_tools import resolve_shop_display_name
from app.services.dm_chat_provider import (
    ChatMessage,
    DmChatDisabled,
    DmChatError,
    chat_completion,
    user_facing_agent_error,
)

INSTRUCTIONS_MARKER = "INSTRUCTIONS_UPDATE"
_MAX_STORED_MESSAGES = 60


def split_training_reply(content: str) -> tuple[str, str | None]:
    """Separate the coach reply shown to the admin from saved instructions."""
    if INSTRUCTIONS_MARKER not in content:
        return content.strip(), None

    before, _, after = content.partition(INSTRUCTIONS_MARKER)
    reply = before.strip()
    block = after.strip()
    if block.startswith("```"):
        lines = block.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        block = "\n".join(lines).strip()
    return reply, block or None


def _training_history(checks: dict[str, Any]) -> list[dict[str, str]]:
    raw = checks.get("bot_training_messages")
    if not isinstance(raw, list):
        return []
    messages: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        content = str(item.get("content") or "").strip()
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content})
    return messages[-_MAX_STORED_MESSAGES:]


def _coach_system_prompt(
    *,
    shop_name: str,
    current_instructions: str,
) -> str:
    instructions_block = current_instructions.strip() or "(none yet — start fresh)"
    return (
        f"You are DukAI's training coach. A shop admin is teaching you how DukAI "
        f"should talk to Instagram customers at {shop_name}.\n\n"
        "Current saved instructions for the customer-facing sales bot:\n"
        f"---\n{instructions_block}\n---\n\n"
        "Your job:\n"
        "1. Chat naturally with the admin. Ask short clarifying questions when helpful.\n"
        "2. When they give guidance (tone, greetings, products, phrases, language), "
        "acknowledge briefly and refine the instructions.\n"
        "3. ALWAYS end your message with the full updated instruction set in exactly "
        "this format (saved automatically — keep the coach reply above it friendly "
        "and concise):\n\n"
        f"{INSTRUCTIONS_MARKER}\n"
        "```\n"
        "<complete bullet-point instructions incorporating everything discussed>\n"
        "```\n\n"
        "Rules for INSTRUCTIONS_UPDATE:\n"
        "- Include the COMPLETE current instructions each time, not just the delta.\n"
        "- Use concise bullet points the sales bot can follow.\n"
        "- Do not duplicate built-in order, payment, or catalogue mechanics.\n"
        "- If the admin only asks a question, still output the current instructions unchanged."
    )


def _save_training_state(
    account: InstagramAccount,
    *,
    messages: list[dict[str, str]],
    instructions: str | None,
) -> None:
    checks = account.onboarding_checks if isinstance(account.onboarding_checks, dict) else {}
    checks = dict(checks)
    stamped = [
        {
            "role": item["role"],
            "content": item["content"],
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }
        for item in messages[-_MAX_STORED_MESSAGES:]
    ]
    checks["bot_training_messages"] = stamped
    if instructions is not None:
        script = checks.get("sales_autopilot_script")
        if not isinstance(script, dict):
            script = {}
        else:
            script = dict(script)
        script["tone"] = ""
        script["opening_line"] = ""
        script["response_guidelines"] = instructions.strip()
        checks["sales_autopilot_script"] = script
    account.onboarding_checks = checks


class BotTrainingChatService:
    def __init__(self, db: Session, settings: Settings) -> None:
        self.db = db
        self.settings = settings

    def get_state(self, account: InstagramAccount) -> dict[str, Any]:
        checks = account.onboarding_checks if isinstance(account.onboarding_checks, dict) else {}
        script = checks.get("sales_autopilot_script") if isinstance(checks, dict) else {}
        guidelines = ""
        if isinstance(script, dict):
            guidelines = str(script.get("response_guidelines") or "").strip()
        return {
            "messages": _training_history(checks),
            "current_instructions": guidelines,
        }

    def clear_history(self, account: InstagramAccount) -> None:
        checks = account.onboarding_checks if isinstance(account.onboarding_checks, dict) else {}
        checks = dict(checks)
        checks["bot_training_messages"] = []
        account.onboarding_checks = checks

    def chat(self, account: InstagramAccount, user_text: str) -> dict[str, Any]:
        text = user_text.strip()
        if not text:
            raise ValueError("Message cannot be empty.")

        checks = account.onboarding_checks if isinstance(account.onboarding_checks, dict) else {}
        history = _training_history(checks)
        script = checks.get("sales_autopilot_script") if isinstance(checks, dict) else {}
        current_instructions = ""
        if isinstance(script, dict):
            current_instructions = str(script.get("response_guidelines") or "").strip()

        shop_name = resolve_shop_display_name(account, self.db)
        messages: list[ChatMessage] = [
            ChatMessage(
                role="system",
                content=_coach_system_prompt(
                    shop_name=shop_name,
                    current_instructions=current_instructions,
                ),
            ),
        ]
        for item in history:
            messages.append(ChatMessage(role=item["role"], content=item["content"]))
        messages.append(ChatMessage(role="user", content=text))

        agent = effective_agent_settings(self.settings, self.db)
        try:
            completion = chat_completion(agent, messages, [])
        except DmChatDisabled as exc:
            raise RuntimeError(
                "No AI provider is configured. Set up an LLM in Admin → Settings → AI agent."
            ) from exc
        except DmChatError as exc:
            raise RuntimeError(user_facing_agent_error(exc)) from exc

        raw = (completion.content or "").strip()
        if not raw:
            raise RuntimeError("The training coach returned an empty response.")

        reply, updated_instructions = split_training_reply(raw)
        if not reply:
            reply = "Got it — I've updated the instructions."

        new_history = [*history, {"role": "user", "content": text}]
        new_history.append({"role": "assistant", "content": reply})

        save_instructions = updated_instructions if updated_instructions is not None else current_instructions
        _save_training_state(
            account,
            messages=new_history,
            instructions=save_instructions,
        )
        self.db.commit()
        self.db.refresh(account)

        return {
            "reply": reply,
            "messages": new_history,
            "current_instructions": save_instructions,
        }
