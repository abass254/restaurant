"""Chat completion providers for the DM AI agent (Gemini-first free tier)."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.config import Settings
from app.env_files import dukai_env_name

logger = logging.getLogger(__name__)

_KNOWN_PROVIDERS = ("gemini", "groq", "cloudflare", "ollama", "openai")
_QUOTA_ERROR_TOKENS = ("rate limit", "429", "quota", "resource_exhausted")
_TRANSIENT_ERROR_TOKENS = (
    *_QUOTA_ERROR_TOKENS,
    "503",
    "unavailable",
    "high demand",
    "overloaded",
)


class DmChatDisabled(RuntimeError):
    """No usable chat provider configured."""


class DmChatError(RuntimeError):
    """Upstream chat provider returned an error."""


@dataclass
class ChatMessage:
    role: str  # system | user | assistant | tool
    content: str
    tool_call_id: str | None = None
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    name: str | None = None  # tool name for tool role


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ChatCompletion:
    content: str | None
    tool_calls: list[ToolCall]
    finish_reason: str | None = None


def _has_gemini(settings: Settings) -> bool:
    return bool(settings.gemini_api_key)


def _has_groq(settings: Settings) -> bool:
    return bool(settings.groq_api_key)


def _has_openai(settings: Settings) -> bool:
    return bool(settings.openai_api_key)


def _has_cloudflare(settings: Settings) -> bool:
    return bool(settings.cloudflare_account_id and settings.cloudflare_api_token)


def _has_cloud_chat_provider(settings: Settings) -> bool:
    return (
        _has_gemini(settings)
        or _has_groq(settings)
        or _has_cloudflare(settings)
        or _has_openai(settings)
    )


def _ollama_allowed() -> bool:
    """Local Ollama is dev-only; production must use a cloud LLM provider."""
    return dukai_env_name() != "prod"


def _auto_chat_provider_chain(settings: Settings) -> list[str]:
    """Preferred chat providers under `auto`, highest quality first."""
    chain: list[str] = []
    if _has_gemini(settings):
        chain.append("gemini")
    if _has_groq(settings):
        chain.append("groq")
    if _has_cloudflare(settings):
        chain.append("cloudflare")
    if _has_openai(settings):
        chain.append("openai")
    return chain


def resolve_chat_provider(settings: Settings) -> str:
    requested = (settings.dm_agent_provider or "auto").strip().lower()
    if requested not in (*_KNOWN_PROVIDERS, "auto"):
        requested = "auto"

    if requested == "gemini":
        if not _has_gemini(settings):
            raise DmChatDisabled("Gemini is selected but GEMINI_API_KEY is not configured.")
        return "gemini"
    if requested == "groq":
        if not _has_groq(settings):
            raise DmChatDisabled("Groq is selected but GROQ_API_KEY is not configured.")
        return "groq"
    if requested == "cloudflare":
        if not _has_cloudflare(settings):
            raise DmChatDisabled(
                "Cloudflare is selected but CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN "
                "are not configured.",
            )
        return "cloudflare"
    if requested == "ollama":
        if not _ollama_allowed():
            raise DmChatDisabled(
                "Ollama is not available in production. "
                "Set GEMINI_API_KEY, GROQ_API_KEY, or another cloud LLM key in .env.",
            )
        return "ollama"
    if requested == "openai":
        if not _has_openai(settings):
            raise DmChatDisabled("OpenAI is selected but OPENAI_API_KEY is not configured.")
        return "openai"

    chain = _auto_chat_provider_chain(settings)
    if chain:
        return chain[0]
    if _ollama_allowed():
        return "ollama"
    raise DmChatDisabled(
        "No cloud LLM API key is configured. "
        "Set GEMINI_API_KEY, GROQ_API_KEY, or another provider key in .env.",
    )


def chat_provider_available(settings: Settings) -> bool:
    try:
        resolve_chat_provider(settings)
        return True
    except DmChatDisabled:
        return False


def _openai_tools_payload(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool.get("description", ""),
                "parameters": tool.get("parameters", {"type": "object", "properties": {}}),
            },
        }
        for tool in tools
    ]


def _openai_messages(messages: list[ChatMessage]) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for message in messages:
        if message.role == "system":
            payload.append({"role": "system", "content": message.content})
            continue
        if message.role == "tool":
            payload.append(
                {
                    "role": "tool",
                    "tool_call_id": message.tool_call_id or message.name or "tool",
                    "content": message.content,
                },
            )
            continue
        if message.role == "assistant" and message.tool_calls:
            payload.append(
                {
                    "role": "assistant",
                    "content": message.content or None,
                    "tool_calls": message.tool_calls,
                },
            )
            continue
        payload.append({"role": message.role, "content": message.content})
    return payload


def _parse_openai_compatible_response(data: dict[str, Any]) -> ChatCompletion:
    if data.get("success") is False:
        errors = data.get("errors") or []
        msg = (
            errors[0].get("message")
            if errors and isinstance(errors[0], dict)
            else "Cloudflare Workers AI returned an error."
        )
        raise DmChatError(msg)

    choice = (data.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    raw_tool_calls = message.get("tool_calls") or []
    tool_calls: list[ToolCall] = []
    for index, raw in enumerate(raw_tool_calls):
        fn = raw.get("function") or {}
        args_raw = fn.get("arguments") or "{}"
        try:
            args = json.loads(args_raw) if isinstance(args_raw, str) else dict(args_raw)
        except json.JSONDecodeError:
            args = {}
        tool_calls.append(
            ToolCall(
                id=str(raw.get("id") or f"call_{index}"),
                name=str(fn.get("name") or ""),
                arguments=args if isinstance(args, dict) else {},
            ),
        )
    content = message.get("content")
    if isinstance(content, list):
        content = "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return ChatCompletion(
        content=(content or None),
        tool_calls=tool_calls,
        finish_reason=choice.get("finish_reason"),
    )


def _chat_openai_compatible(
    *,
    settings: Settings,
    provider: str,
    messages: list[ChatMessage],
    tools: list[dict[str, Any]],
) -> ChatCompletion:
    if provider == "groq":
        api_key = settings.groq_api_key
        base = settings.groq_api_base.rstrip("/")
        model = settings.dm_agent_model or settings.groq_chat_model
    elif provider == "openai":
        api_key = settings.openai_api_key
        base = settings.openai_api_base.rstrip("/")
        model = settings.dm_agent_model or settings.openai_chat_model
    elif provider == "cloudflare":
        api_key = settings.cloudflare_api_token
        base = (
            f"https://api.cloudflare.com/client/v4/accounts/"
            f"{settings.cloudflare_account_id}/ai/v1"
        )
        model = settings.dm_agent_model or settings.cloudflare_chat_model
    else:
        api_key = "ollama"
        base = settings.ollama_api_base.rstrip("/")
        model = settings.dm_agent_model or settings.ollama_chat_model

    url = f"{base}/chat/completions"
    body: dict[str, Any] = {
        "model": model,
        "messages": _openai_messages(messages),
        "temperature": 0.4,
    }
    if tools:
        body["tools"] = _openai_tools_payload(tools)
        body["tool_choice"] = "auto"

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    timeout = settings.dm_agent_timeout_seconds
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, headers=headers, json=body)
    except httpx.RequestError as exc:
        raise DmChatError(f"{provider} request failed: {exc}") from exc

    if response.status_code == 429:
        raise DmChatError(f"{provider} rate limit exceeded.")
    if response.status_code >= 400:
        raise DmChatError(f"{provider} error {response.status_code}: {response.text[:500]}")

    return _parse_openai_compatible_response(response.json())


def _gemini_tools_payload(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    declarations = []
    for tool in tools:
        declarations.append(
            {
                "name": tool["name"],
                "description": tool.get("description", ""),
                "parameters": tool.get("parameters", {"type": "object", "properties": {}}),
            },
        )
    return [{"functionDeclarations": declarations}] if declarations else []


def _gemini_contents(messages: list[ChatMessage]) -> tuple[str | None, list[dict[str, Any]]]:
    system_parts: list[str] = []
    contents: list[dict[str, Any]] = []
    for message in messages:
        if message.role == "system":
            if message.content.strip():
                system_parts.append(message.content.strip())
            continue
        if message.role == "tool":
            contents.append(
                {
                    "role": "user",
                    "parts": [
                        {
                            "functionResponse": {
                                "name": message.name or "tool",
                                "response": _parse_tool_content(message.content),
                            },
                        },
                    ],
                },
            )
            continue
        if message.role == "assistant" and message.tool_calls:
            parts: list[dict[str, Any]] = []
            if message.content:
                parts.append({"text": message.content})
            for call in message.tool_calls:
                fn = call.get("function") or {}
                args_raw = fn.get("arguments") or "{}"
                try:
                    args = json.loads(args_raw) if isinstance(args_raw, str) else dict(args_raw)
                except json.JSONDecodeError:
                    args = {}
                parts.append(
                    {
                        "functionCall": {
                            "name": fn.get("name"),
                            "args": args,
                        },
                    },
                )
            contents.append({"role": "model", "parts": parts})
            continue

        role = "user" if message.role == "user" else "model"
        contents.append({"role": role, "parts": [{"text": message.content}]})
    system_instruction = "\n\n".join(system_parts) if system_parts else None
    return system_instruction, contents


def _parse_tool_content(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
        return parsed if isinstance(parsed, dict) else {"result": parsed}
    except json.JSONDecodeError:
        return {"result": content}


def _chat_gemini(
    *,
    settings: Settings,
    messages: list[ChatMessage],
    tools: list[dict[str, Any]],
) -> ChatCompletion:
    model = settings.dm_agent_model or settings.gemini_chat_model
    url = (
        f"{settings.gemini_api_base.rstrip('/')}/models/{model}:generateContent"
        f"?key={settings.gemini_api_key}"
    )
    system_instruction, contents = _gemini_contents(messages)
    body: dict[str, Any] = {"contents": contents}
    if system_instruction:
        body["systemInstruction"] = {"parts": [{"text": system_instruction}]}
    gemini_tools = _gemini_tools_payload(tools)
    if gemini_tools:
        body["tools"] = gemini_tools

    timeout = settings.dm_agent_timeout_seconds
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=body)
    except httpx.RequestError as exc:
        raise DmChatError(f"gemini request failed: {exc}") from exc

    if response.status_code == 429:
        raise DmChatError("gemini rate limit exceeded.")
    if response.status_code >= 400:
        raise DmChatError(f"gemini error {response.status_code}: {response.text[:500]}")

    data = response.json()
    candidate = (data.get("candidates") or [{}])[0]
    parts = (candidate.get("content") or {}).get("parts") or []
    text_parts: list[str] = []
    tool_calls: list[ToolCall] = []
    for index, part in enumerate(parts):
        if "text" in part:
            text_parts.append(str(part["text"]))
        if "functionCall" in part:
            fn = part["functionCall"] or {}
            tool_calls.append(
                ToolCall(
                    id=f"gemini_call_{index}",
                    name=str(fn.get("name") or ""),
                    arguments=dict(fn.get("args") or {}),
                ),
            )
    return ChatCompletion(
        content="\n".join(text_parts).strip() or None,
        tool_calls=tool_calls,
        finish_reason=(candidate.get("finishReason") or None),
    )


def _provider_configured(settings: Settings, provider: str) -> bool:
    if provider == "gemini":
        return _has_gemini(settings)
    if provider == "groq":
        return _has_groq(settings)
    if provider == "cloudflare":
        return _has_cloudflare(settings)
    if provider == "openai":
        return _has_openai(settings)
    if provider == "ollama":
        return _ollama_allowed()
    return False


def _chat_fallback_providers(settings: Settings, primary: str) -> list[str]:
    """Providers to try after quota/rate-limit errors on the primary (auto mode)."""
    if primary == "ollama":
        return []
    chain = _auto_chat_provider_chain(settings)
    fallbacks = [provider for provider in chain if provider != primary]
    if _ollama_allowed() and "ollama" not in fallbacks:
        fallbacks.append("ollama")
    return fallbacks


def _is_transient_provider_error(exc: DmChatError) -> bool:
    err = str(exc).lower()
    return any(token in err for token in _TRANSIENT_ERROR_TOKENS)


def _invoke_chat_provider(
    settings: Settings,
    provider: str,
    messages: list[ChatMessage],
    tools: list[dict[str, Any]],
) -> ChatCompletion:
    if provider == "gemini":
        return _chat_gemini(settings=settings, messages=messages, tools=tools)
    return _chat_openai_compatible(
        settings=settings,
        provider=provider,
        messages=messages,
        tools=tools,
    )


def chat_completion(
    settings: Settings,
    messages: list[ChatMessage],
    tools: list[dict[str, Any]],
) -> ChatCompletion:
    provider = resolve_chat_provider(settings)
    try:
        return _invoke_chat_provider(settings, provider, messages, tools)
    except DmChatError as exc:
        if (settings.dm_agent_provider or "auto").strip().lower() != "auto":
            raise
        if not _is_transient_provider_error(exc):
            raise
        for fallback in _chat_fallback_providers(settings, provider):
            if not _provider_configured(settings, fallback):
                continue
            logger.warning(
                "DM chat provider %s failed (%s); trying %s",
                provider,
                exc,
                fallback,
            )
            try:
                return _invoke_chat_provider(settings, fallback, messages, tools)
            except DmChatError as retry_exc:
                if not _is_transient_provider_error(retry_exc):
                    raise
                exc = retry_exc
                continue
        raise exc


def user_facing_agent_error(exc: Exception) -> str:
    message = str(exc).lower()
    if any(token in message for token in _QUOTA_ERROR_TOKENS):
        return (
            "Our AI assistant has hit its API quota for now. "
            "Please try again in a few minutes, or ask for a live agent."
        )
    return (
        "Sorry, I'm having trouble connecting right now. "
        "Please try again in a moment, or ask for a live agent."
    )
