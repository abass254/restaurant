"""Catalog of Instagram DM bot engines selectable from platform admin."""

from __future__ import annotations

from dataclasses import dataclass, field

DEFAULT_DM_BOT = "ai_agent"
VALID_DM_BOTS: frozenset[str] = frozenset({"ai_agent", "menu_bot", "sales_autopilot"})


@dataclass(frozen=True)
class DmBotDefinition:
    id: str
    label: str
    description: str
    icon: str = "fa-robot"
    tagline: str = ""
    capabilities: tuple[str, ...] = field(default_factory=tuple)
    flow_steps: tuple[str, ...] = field(default_factory=tuple)
    best_for: str = ""
    limitations: str = ""


DM_BOT_CATALOG: tuple[DmBotDefinition, ...] = (
    DmBotDefinition(
        id="ai_agent",
        label="AI sales agent",
        tagline="LLM-powered assistant that interprets free-text and uses commerce tools.",
        description=(
            "Customers can type naturally in English or Swahili. The model decides "
            "when to show products, start orders, or hand off to a human. "
            "Order payment and fulfillment updates are sent automatically after placement."
        ),
        icon="fa-wand-magic-sparkles",
        capabilities=(
            "Understands free-text and quick-reply chips",
            "Product catalogue with image carousels via tools",
            "Recommendations, order placement, and status tracking",
            "Live-agent handoff when the customer asks for a human",
            "Merchant script overrides (tone, opening line, payment rule)",
            "Bot sandbox allows typed messages (not chip-only)",
        ),
        flow_steps=(
            "Customer opens chat — ticket opens silently (no chip menu)",
            "Customer messages — AI interprets intent from context",
            "AI calls tools for prices, stock, orders, and catalogue carousels",
            "Order confirmed → shop sends payment and status updates automatically",
            "Human handoff pauses automation until merchant re-enables",
        ),
        best_for="Shops that want flexible, conversational sales with minimal rigid menus.",
        limitations=(
            "Requires a configured LLM provider (Gemini, Groq, OpenAI, or Ollama). "
            "DM_AGENT_ENABLED=false in .env disables AI even when selected here."
        ),
    ),
    DmBotDefinition(
        id="menu_bot",
        label="Menu bot",
        tagline="Deterministic chip and numbered-menu flow — no LLM.",
        description=(
            "Customers tap chips or reply 1/2/3 to order, enquire about products, "
            "or reach a live agent. Every step is scripted and predictable."
        ),
        icon="fa-list",
        capabilities=(
            "Greeting with three quick-reply options (order / enquire / live agent)",
            "Product catalogue carousels with “Order this” buttons",
            "Quantity selection, order confirmation, and completion prompts",
            "Order status and tracking replies for active orders",
            "Live-agent handoff disables auto-replies for merchant takeover",
            "Chip-only mode in bot sandbox (matches live Instagram behaviour)",
        ),
        flow_steps=(
            "Greeting ticket opens with three menu chips",
            "Customer picks order (1) or enquire (2) → catalogue is sent",
            "Product selected → quantity → confirm → M-PESA payment",
            "Tracking updates until delivery or pickup confirmation",
            "Option 3 or “live agent” → handoff to merchant inbox",
        ),
        best_for="Maximum predictability, lower cost, and no AI provider dependency.",
        limitations=(
            "No natural-language understanding — customers must use chips or menu numbers. "
            "Complex questions outside the menu may need live-agent handoff."
        ),
    ),
    DmBotDefinition(
        id="sales_autopilot",
        label="Sales autopilot",
        tagline="Rule-based sales engine with intent matching and saved customer profiles.",
        description=(
            "Keyword and pattern matching drives the conversation: buy intent, product "
            "enquiries, order tracking, and M-PESA checkout. Can remember customer "
            "details with consent for faster repeat orders."
        ),
        icon="fa-cart-shopping",
        capabilities=(
            "Intent detection for buy, price/info, and track requests",
            "Text catalogue listing (no product image carousel)",
            "Saved customer profiles with consent prompt",
            "M-PESA checkout and order status replies",
            "Resume interrupted sessions after inactivity timeout",
            "Live-agent handoff on request",
        ),
        flow_steps=(
            "Greeting → main menu or first-message pitch",
            "Customer names a product or asks for catalogue",
            "Phone number collected → order placed → M-PESA STK push",
            "Optional consent to save details for next visit",
            "Track intent returns latest order status on this chat",
        ),
        best_for="Text-first sales with repeat customers and consent-based profile saving.",
        limitations=(
            "No LLM — relies on keyword/pattern matching. "
            "Catalogue is plain text, not visual product cards."
        ),
    ),
)


def normalize_dm_bot(value: str | None) -> str:
    if value and value in VALID_DM_BOTS:
        return value
    return DEFAULT_DM_BOT


def dm_bot_catalog_payload() -> list[dict[str, object]]:
    return [
        {
            "id": bot.id,
            "label": bot.label,
            "tagline": bot.tagline,
            "description": bot.description,
            "icon": bot.icon,
            "capabilities": list(bot.capabilities),
            "flow_steps": list(bot.flow_steps),
            "best_for": bot.best_for,
            "limitations": bot.limitations,
        }
        for bot in DM_BOT_CATALOG
    ]
