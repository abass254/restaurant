"""Tool definitions and executors for the DM AI agent."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.config import Settings
from app.models import (
    InstagramAccount,
    InstagramConversation,
    InstagramMessage,
    InventoryItem,
    Order,
    OrderStatusHistory,
)
from app.services.platform_instagram import is_bot_preview_account
from app.services import mpesa_service
from app.services.catalog.catalog_types import CatalogItem, CatalogSearchHit, normalize_ref
from app.services.catalog.inventory_integration import inventory_integration_from_account
from app.services.catalog.order_bridge import push_order_to_external
from app.services.dm_agent_context import (
    build_inventory_summary_dict,
    build_session_context_dict,
    build_shop_info_dict,
    order_to_agent_dict,
)
from app.services.dm_catalog_service import DmCatalogService
from app.services.dm_order_service import DmOrderService
from app.services.inventory_stock_service import (
    InsufficientStockError,
    deduct_stock,
    restore_stock,
)
from app.services.order_creation import StorePausedError, build_catalog_order
from app.services.order_stock_service import adjust_line_quantity
from app.support.store_type import is_restaurant_account
from app.services.order_notification_service import OrderNotificationService
from app.services.support_ticket_service import SupportTicketService
from app.support.dm_order_intent import parse_suggestion_pick
from app.support.mpesa_order_link import link_mpesa_transaction_to_order
from app.support.order_status import (
    AWAITING_PAYMENT,
    PLACED,
    STATUS_LABELS,
    TERMINAL_STATUSES,
)
from app.support.quantity_parse import clamp_quantity, parse_quantity
from app.support.sales_session import (
    STEP_AWAITING_ORDER_CONFIRM,
    STEP_AWAITING_QUANTITY,
    STEP_HANDOFF,
    STEP_IDLE,
    STEP_TRACKING,
    merge_sales_session,
    read_session,
)

logger = logging.getLogger(__name__)

# Quantity on an existing order may be changed only before kitchen/payment completion.
_AMENDABLE_ORDER_STATUSES = frozenset({PLACED, AWAITING_PAYMENT})


AGENT_TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "search_products",
        "description": (
            "Search the shop catalogue by keyword, category, brand, or product name. "
            "Use when the customer asks vaguely (e.g. 'spray', 'perfume', 'something for hair') "
            "or when you need to show multiple options before they pick one."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "What to search for — product name, category, brand, or keyword.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum matches to return (default 8).",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "list_products",
        "description": (
            "List products in the shop catalogue with prices and stock. "
            "Use when the customer wants to browse everything with no specific keyword."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of products to return (default 15).",
                },
            },
        },
    },
    {
        "name": "send_product_catalog",
        "description": (
            "Send the Instagram product catalogue carousel to the customer. "
            "Use when they want to browse or see products visually. "
            "Pass query when showing matches for a category or keyword (e.g. spray). "
            "Do NOT use for photo requests about one product already discussed — "
            "use send_product_photos instead."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "intent": {
                    "type": "string",
                    "enum": ["order", "enquire"],
                    "description": (
                        "Whether the customer wants to order or enquire. "
                        "Defaults to order when omitted."
                    ),
                },
                "query": {
                    "type": "string",
                    "description": (
                        "Optional filter — show only products matching this keyword or category."
                    ),
                },
            },
        },
    },
    {
        "name": "send_product_photos",
        "description": (
            "Send photos of one specific product the customer asked about. "
            "Use when they want pictures/photos of a product you already discussed "
            "(e.g. \"show me photos\", \"can I see pictures of it?\"). "
            "Requires inventory_item_id from search results, session, or context — "
            "never use send_product_catalog for this."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "inventory_item_id": {
                    "type": "string",
                    "description": (
                        "The inventory item id of the product to photograph. "
                        "Prefer last_discussed_item_id from a prior tool result or session."
                    ),
                },
                "product_name": {
                    "type": "string",
                    "description": (
                        "Exact product name only when inventory_item_id is unknown "
                        "and the product is uniquely identifiable."
                    ),
                },
            },
        },
    },
    {
        "name": "start_order",
        "description": (
            "Select a product and quantity to prepare an order. "
            "Does not charge or create the order yet. "
            "Prefer inventory_item_id from catalogue taps, last_catalog_item_ids, or search results."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "inventory_item_id": {"type": "string", "description": "Product inventory item id."},
                "product_name": {
                    "type": "string",
                    "description": (
                        "Exact product name only when uniquely identifiable. "
                        "If multiple products could match, call search_products first."
                    ),
                },
                "quantity": {"type": "integer", "description": "Quantity to order (default 1)."},
            },
        },
    },
    {
        "name": "confirm_order",
        "description": (
            "Create the order after the customer confirms — final step for the AI. "
            "Requires a pending product selection from start_order. "
            "Stops at placed status; payment and fulfillment messages are sent later by the shop."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "amend_order",
        "description": (
            "Change the quantity on the customer's active order in this chat. "
            "Use when they already have an order and ask for a different quantity "
            "(e.g. \"I want 5 instead\"). Works only while status is placed or "
            "awaiting_payment. If the order is already being prepared or later, "
            "the tool returns not_amendable with clear options — never pretend it worked."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "quantity": {
                    "type": "integer",
                    "description": "New total quantity for the line (must be >= 1).",
                },
                "order_number": {
                    "type": "string",
                    "description": "Optional order reference (e.g. ORD-000040). Defaults to active order.",
                },
                "inventory_item_id": {
                    "type": "string",
                    "description": "Optional line to amend when the order has multiple items.",
                },
            },
            "required": ["quantity"],
        },
    },
    {
        "name": "track_order",
        "description": "Get the status of the customer's active or most recent order.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "get_customer_orders",
        "description": (
            "List open and recent orders for this customer in the current Instagram chat. "
            "Use when they ask about their orders or you need order history beyond live context."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "include_completed": {
                    "type": "boolean",
                    "description": "Include recently completed orders (default true).",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum orders to return (default 5).",
                },
            },
        },
    },
    {
        "name": "get_order_by_number",
        "description": (
            "Look up an order by reference (e.g. ORD-000123) for this shop. "
            "Use when the customer quotes an order number."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "order_number": {
                    "type": "string",
                    "description": "Order reference such as ORD-000123.",
                },
            },
            "required": ["order_number"],
        },
    },
    {
        "name": "get_inventory_summary",
        "description": (
            "Snapshot of shop inventory: product/service counts, categories, low stock, "
            "and out-of-stock items. Use for broad questions like what you sell or what's running low."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "get_shop_info",
        "description": (
            "Shop facts: business name, location, whether orders are accepted, "
            "prep time, and delivery fee per km when configured. "
            "Use for where you are, delivery, or whether the shop is open."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "recommend_products",
        "description": (
            "Recommend 2–4 products or services that fit the customer's need, budget, "
            "or occasion. Returns ranked options with short why-this-fits reasons. "
            "Use when they are unsure, browsing for a gift, or asking what you suggest."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "need": {
                    "type": "string",
                    "description": (
                        "What they want — e.g. perfume for him, hair spray, "
                        "weekend booking, gift under 2000."
                    ),
                },
                "budget_kes": {
                    "type": "integer",
                    "description": "Optional max price in KES.",
                },
                "occasion": {
                    "type": "string",
                    "description": "Optional occasion or use case (gift, date night, refill).",
                },
                "limit": {
                    "type": "integer",
                    "description": "How many recommendations to return (default 3, max 4).",
                },
            },
            "required": ["need"],
        },
    },
    {
        "name": "get_product_details",
        "description": (
            "Full details for one product or service: description, photos, stock, price, type. "
            "Use when the customer wants more info before ordering."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "inventory_item_id": {
                    "type": "string",
                    "description": "Product inventory item id.",
                },
                "product_name": {
                    "type": "string",
                    "description": "Exact product name when id is unknown.",
                },
            },
        },
    },
    {
        "name": "escalate_to_human",
        "description": "Hand the conversation to a live human merchant agent.",
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {"type": "string", "description": "Brief reason for escalation."},
            },
        },
    },
]


def resolve_shop_display_name(
    account: InstagramAccount,
    db: Session | None = None,
) -> str:
    """Customer-facing shop label — never expose internal bot-preview names."""
    merchant_id = str(account.account_id or "").strip()
    if db is not None and merchant_id:
        from app.models import Account

        merchant = db.get(Account, merchant_id)
        business = (merchant.business_name or "").strip() if merchant else ""
        if business:
            return business

    fallback = (account.name or account.username or "").strip()
    if not fallback or fallback.lower() in {"bot preview", "bot_preview"}:
        return "our shop"
    if is_bot_preview_account(account):
        return "our shop"
    return fallback


def normalize_opening_line(opening_line: str | None) -> str:
    """Upgrade legacy verbatim greeting scripts to natural style guidance."""
    line = (opening_line or "").strip()
    if not line:
        return ""
    legacy_markers = (
        "Hello! I'm DukAI, your sales assistant agent",
        'On greetings, say: "Hello! I\'m DukAI',
        "On greetings, say: \"Hello! I'm DukAI",
    )
    if any(marker in line for marker in legacy_markers):
        return (
            "Introduce yourself as DukAI and welcome them to the shop in a warm, natural way "
            "that matches how the customer greeted you."
        )
    return line


def merchant_script(account: InstagramAccount) -> dict[str, str]:
    defaults = {
        "tone": "professional",
        "opening_line": (
            "Introduce yourself as DukAI and welcome them to the shop in a warm, natural way "
            "that matches how the customer greeted you."
        ),
        "payment_rule_line": (
            "Do not handle payment or post-placement processing — the shop sends those automatically."
        ),
        "consent_prompt": (
            "Before we continue — may we save your details for faster checkout next time? "
            "Reply YES to agree, or NO to skip."
        ),
        "response_guidelines": "",
    }
    checks = account.onboarding_checks if isinstance(account.onboarding_checks, dict) else {}
    script = checks.get("sales_autopilot_script") if isinstance(checks, dict) else {}
    if not isinstance(script, dict):
        return defaults
    merged = dict(defaults)
    for key in defaults:
        value = script.get(key)
        if isinstance(value, str) and value.strip():
            merged[key] = value.strip()
    merged["opening_line"] = normalize_opening_line(merged.get("opening_line"))
    return merged


class DmAgentTools:
    def __init__(self, db: Session, settings: Settings, instagram_api):
        self.db = db
        self.settings = settings
        self.catalog = DmCatalogService(db, settings, instagram_api)
        self.orders = DmOrderService(db, settings)
        self.support_tickets = SupportTicketService(db)

    def execute(
        self,
        name: str,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        handlers = {
            "search_products": self._search_products,
            "list_products": self._list_products,
            "send_product_catalog": self._send_product_catalog,
            "send_product_photos": self._send_product_photos,
            "start_order": self._start_order,
            "confirm_order": self._confirm_order,
            "amend_order": self._amend_order,
            "initiate_mpesa": self._initiate_mpesa,
            "track_order": self._track_order,
            "get_customer_orders": self._get_customer_orders,
            "get_order_by_number": self._get_order_by_number,
            "get_inventory_summary": self._get_inventory_summary,
            "get_shop_info": self._get_shop_info,
            "recommend_products": self._recommend_products,
            "get_product_details": self._get_product_details,
            "escalate_to_human": self._escalate_to_human,
        }
        handler = handlers.get(name)
        if handler is None:
            return {"ok": False, "error": f"Unknown tool: {name}"}
        try:
            return handler(arguments, account=account, conversation=conversation, message=message)
        except InsufficientStockError as exc:
            return {
                "ok": False,
                "error": "insufficient_stock",
                "product_name": exc.product_name,
                "available": exc.available,
            }
        except Exception as exc:
            logger.exception("DM agent tool %s failed", name)
            return {"ok": False, "error": str(exc)}

    def _merchant_id(self, account: InstagramAccount) -> str:
        return str(account.account_id or "").strip()

    def _product_payload(
        self,
        item: CatalogItem,
        *,
        account: InstagramAccount | None = None,
        include_description: bool = False,
    ) -> dict[str, Any]:
        product_type = str(getattr(item, "product_type", None) or "product").strip().lower()
        if product_type not in {"product", "service"}:
            product_type = "product"
        payload: dict[str, Any] = {
            "catalog_item_ref": item.ref,
            "inventory_item_id": item.inventory_item_id,
            "name": item.name,
            "product_type": product_type,
            "category": item.category,
            "brand": item.brand,
            "price_kes": item.price_kes,
            "stock": item.stock,
            "unit": item.unit,
            "image_count": len(item.image_urls),
            "is_out_of_stock": item.stock is not None and item.stock <= 0,
            "is_low_stock": self._is_low_stock(item, account=account),
        }
        description = (item.description or "").strip()
        if include_description and description:
            payload["description"] = description[:500]
        elif description:
            payload["description"] = description[:180]
        return payload

    def _why_this_fits(
        self,
        item: CatalogItem,
        *,
        need: str,
        occasion: str = "",
        budget_kes: int | None = None,
        account: InstagramAccount | None = None,
    ) -> str:
        bits: list[str] = []
        product_type = str(getattr(item, "product_type", None) or "product").strip().lower()
        if product_type == "service":
            bits.append("bookable service")
        if item.category:
            bits.append(f"in {item.category}")
        if item.brand:
            bits.append(f"{item.brand}")
        if budget_kes is not None and item.price_kes <= budget_kes:
            bits.append(f"within budget at KES {item.price_kes:,}")
        elif item.price_kes:
            bits.append(f"KES {item.price_kes:,}")
        if self._is_low_stock(item, account=account) and item.stock is not None and item.stock > 0:
            bits.append(f"only {item.stock} left")
        elif item.stock is not None and item.stock > 0:
            bits.append("in stock")
        need_l = need.lower()
        occasion_l = occasion.lower()
        hay = " ".join(
            filter(
                None,
                [
                    item.name,
                    item.category or "",
                    item.brand or "",
                    (item.description or "")[:120],
                ],
            )
        ).lower()
        for token in (*need_l.split(), *occasion_l.split()):
            clean = "".join(ch for ch in token if ch.isalnum())
            if len(clean) >= 3 and clean in hay and clean not in " ".join(bits).lower():
                bits.append(f"matches “{clean}”")
                break
        if not bits:
            return "Solid match for what they asked for."
        return ", ".join(bits[:4]) + "."

    def _is_low_stock(
        self,
        item: CatalogItem,
        *,
        account: InstagramAccount | None = None,
    ) -> bool:
        if item.stock is None:
            return False
        if item.stock <= 0:
            return False
        merchant_id = str(getattr(account, "account_id", "") or "").strip()
        if merchant_id and item.inventory_item_id:
            provider = self.catalog.provider_for_account(account, merchant_id=merchant_id)
            row = None
            if hasattr(provider, "item_by_id"):
                row = provider.item_by_id(item.inventory_item_id, merchant_id)
            if row is not None:
                return bool(row.is_low_stock())
        return item.stock <= 3

    def _product_details_payload(
        self,
        item: CatalogItem,
        *,
        account: InstagramAccount,
    ) -> dict[str, Any]:
        payload = self._product_payload(item, account=account, include_description=True)
        payload["description"] = (item.description or "").strip() or None
        payload["image_urls"] = list(item.image_urls[:5])
        payload["external_sku"] = item.external_sku
        payload["is_active"] = item.is_active
        return payload

    def _search_products(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del message
        merchant_id = self._merchant_id(account)
        if not merchant_id:
            return {"ok": False, "error": "Shop not configured."}
        query = str(arguments.get("query") or "").strip()
        if not query:
            return {"ok": False, "error": "query_required"}
        limit = max(1, min(int(arguments.get("limit") or 8), 12))
        hits = self.catalog.search_products(merchant_id, query, limit=limit, account=account)
        products: list[dict[str, Any]] = []
        for index, hit in enumerate(hits, start=1):
            payload = self._product_payload(hit.item, account=account)
            payload["matched_on"] = list(hit.match_reasons)
            payload["suggestion_number"] = index
            products.append(payload)
        session_updates: dict[str, Any] = {
            "last_suggested_item_refs": [p["catalog_item_ref"] for p in products],
            "last_suggested_item_ids": [
                p["inventory_item_id"] for p in products if p.get("inventory_item_id")
            ],
        }
        if len(products) == 1:
            session_updates["last_discussed_item_ref"] = products[0]["catalog_item_ref"]
            if products[0].get("inventory_item_id"):
                session_updates["last_discussed_item_id"] = products[0]["inventory_item_id"]
        merge_sales_session(conversation, **session_updates)
        self.db.commit()
        return {
            "ok": True,
            "query": query,
            "products": products,
            "count": len(products),
            "last_discussed_item_id": session_updates.get("last_discussed_item_id"),
            "hint": (
                "Recommend the best fit with a short why, ask which they prefer, "
                "then offer to place the order (or book if it is a service). "
                "Do not start_order until they pick a specific product."
                if len(products) > 1
                else (
                    "This is the matching item. Pitch it briefly with price/stock, "
                    "offer photos if helpful, then ask if they want to order/book now. "
                    "For photo requests use send_product_photos with inventory_item_id "
                    "from this result."
                )
            ),
        }

    def _list_products(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del conversation, message
        merchant_id = self._merchant_id(account)
        if not merchant_id:
            return {"ok": False, "error": "Shop not configured."}
        limit = max(1, min(int(arguments.get("limit") or 15), 25))
        items = self.catalog.list_catalog_items(merchant_id, limit=limit, account=account)
        products = [self._product_payload(item, account=account) for item in items]
        return {"ok": True, "products": products, "count": len(products)}

    def _send_product_catalog(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del message
        intent = str(arguments.get("intent") or "order").strip().lower()
        query = str(arguments.get("query") or "").strip() or None
        choice = 2 if intent == "enquire" else 1
        merge_sales_session(conversation, catalog_choice=choice, step=STEP_IDLE, menu_sent=True)
        delivery = self.catalog.send_catalog(account, conversation, choice, query=query)
        if delivery.catalog_sent:
            merchant_id = self._merchant_id(account)
            if query:
                hits = self.catalog.search_products(
                    merchant_id,
                    query,
                    limit=25,
                    account=account,
                )
                items = [hit.item for hit in hits]
            else:
                items = self.catalog.list_catalog_items(merchant_id, limit=25, account=account)
            item_refs = [item.ref for item in items][:25]
            item_ids = [item.inventory_item_id for item in items if item.inventory_item_id][:25]
            if item_refs:
                merge_sales_session(
                    conversation,
                    last_catalog_item_refs=item_refs,
                    last_catalog_item_ids=item_ids,
                )
        self.db.commit()
        if delivery.empty_store:
            hint = (
                "The shop has no products listed yet. An honest setup message was already sent — "
                "do not send another reply or claim a catalogue was shared."
            )
        elif delivery.no_matches:
            query_label = f' "{query}"' if query else ""
            hint = (
                f"No products matched{query_label}. A reply was already sent — suggest another "
                "keyword or the team. Do not claim you sent a catalogue."
            )
        elif delivery.catalog_sent:
            hint = (
                f"The product carousel ({delivery.item_count} item(s)) was already sent. "
                "Stay silent — do not add another message about the catalogue."
            )
        else:
            hint = "Catalogue delivery did not complete. Explain honestly without claiming it was sent."
        return {
            "ok": delivery.catalog_sent or delivery.empty_store or delivery.no_matches,
            "catalog_sent": delivery.catalog_sent,
            "item_count": delivery.item_count,
            "empty_store": delivery.empty_store,
            "no_matches": delivery.no_matches,
            "outbound_delivered": delivery.outbound_delivered,
            "intent": intent,
            "query": query,
            "hint": hint,
        }

    def _resolve_catalog_item(
        self,
        account: InstagramAccount,
        ref: str,
    ) -> CatalogItem | None:
        merchant_id = self._merchant_id(account)
        if not merchant_id or not ref:
            return None
        return self.catalog.get_catalog_item(ref, merchant_id, account=account)

    def _resolve_photo_item(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        arguments: dict[str, Any],
    ) -> CatalogItem | None:
        merchant_id = self._merchant_id(account)
        session = read_session(conversation.sales_session)

        item_ref = str(
            arguments.get("catalog_item_ref")
            or session.get("last_discussed_item_ref")
            or session.get("catalog_pending_item_ref")
            or "",
        ).strip()
        if item_ref:
            item = self._resolve_catalog_item(account, item_ref)
            if item is not None:
                return item

        item_id = str(
            arguments.get("inventory_item_id")
            or session.get("last_discussed_item_id")
            or session.get("catalog_pending_item_id")
            or "",
        ).strip()
        if item_id:
            item = self._resolve_catalog_item(account, normalize_ref(item_id))
            if item is not None:
                return item

        suggested_refs = session.get("last_suggested_item_refs") or []
        if isinstance(suggested_refs, list) and len(suggested_refs) == 1:
            item = self._resolve_catalog_item(account, str(suggested_refs[0]))
            if item is not None:
                return item

        suggested_ids = session.get("last_suggested_item_ids") or []
        if isinstance(suggested_ids, list) and len(suggested_ids) == 1:
            item = self._resolve_catalog_item(account, normalize_ref(str(suggested_ids[0])))
            if item is not None:
                return item

        catalog_refs = session.get("last_catalog_item_refs") or []
        if isinstance(catalog_refs, list) and len(catalog_refs) == 1:
            item = self._resolve_catalog_item(account, str(catalog_refs[0]))
            if item is not None:
                return item

        catalog_ids = session.get("last_catalog_item_ids") or []
        if isinstance(catalog_ids, list) and len(catalog_ids) == 1:
            item = self._resolve_catalog_item(account, normalize_ref(str(catalog_ids[0])))
            if item is not None:
                return item

        product_name = str(arguments.get("product_name") or "").strip()
        if product_name:
            return self.catalog.match_product(account, product_name)
        return None

    def _send_product_photos(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del message
        item = self._resolve_photo_item(account, conversation, arguments)
        if item is None:
            return {
                "ok": False,
                "error": "product_not_found",
                "hint": (
                    "Could not identify which product photos to send. "
                    "Ask the customer which product they mean, or call search_products first."
                ),
            }

        merge_sales_session(
            conversation,
            last_discussed_item_ref=item.ref,
            catalog_pending_item_ref=item.ref,
            last_discussed_item_id=item.inventory_item_id,
            catalog_pending_item_id=item.inventory_item_id,
        )
        delivery = self.catalog.send_product_photos(account, conversation, item)
        self.db.commit()

        if delivery.product_not_found:
            return {"ok": False, "error": "product_not_found"}
        if delivery.no_images:
            return {
                "ok": True,
                "photos_sent": False,
                "no_images": True,
                "product_name": delivery.product_name,
                "hint": (
                    f"A message was already sent that we have no photos of {delivery.product_name}. "
                    "Do not claim photos were shared."
                ),
            }
        if delivery.photos_sent:
            return {
                "ok": True,
                "photos_sent": True,
                "image_count": delivery.image_count,
                "product_name": delivery.product_name,
                "inventory_item_id": item.inventory_item_id,
                "catalog_item_ref": item.ref,
                "hint": (
                    f"Sent {delivery.image_count} photo(s) of {delivery.product_name}. "
                    "Stay silent — do not send another message about the photos unless "
                    "the customer asks a follow-up."
                ),
            }
        return {
            "ok": False,
            "error": "delivery_failed",
            "hint": "Photo delivery did not complete. Explain honestly without claiming photos were sent.",
        }

    def _resolve_item(
        self,
        account: InstagramAccount,
        arguments: dict[str, Any],
    ) -> CatalogItem | None:
        item_ref = str(arguments.get("catalog_item_ref") or "").strip()
        if item_ref:
            return self._resolve_catalog_item(account, item_ref)
        item_id = str(arguments.get("inventory_item_id") or "").strip()
        if item_id:
            return self._resolve_catalog_item(account, normalize_ref(item_id))
        product_name = str(arguments.get("product_name") or "").strip()
        if product_name:
            return self.catalog.match_product(account, product_name)
        return None

    def _available_products_snapshot(
        self,
        account: InstagramAccount,
        *,
        limit: int = 8,
    ) -> list[dict[str, Any]]:
        merchant_id = self._merchant_id(account)
        if not merchant_id:
            return []
        return [
            self._product_payload(item, account=account)
            for item in self.catalog.list_catalog_items(merchant_id, limit=limit, account=account)
        ]

    def _resolve_start_order_item(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        arguments: dict[str, Any],
    ) -> tuple[CatalogItem | None, list[CatalogSearchHit], str | None]:
        merchant_id = self._merchant_id(account)
        session = read_session(conversation.sales_session)

        item_ref = str(
            arguments.get("catalog_item_ref")
            or session.get("catalog_pending_item_ref")
            or "",
        ).strip()
        if item_ref:
            item = self._resolve_catalog_item(account, item_ref)
            if item is not None:
                return item, [], None

        item_id = str(
            arguments.get("inventory_item_id")
            or session.get("catalog_pending_item_id")
            or "",
        ).strip()
        if item_id:
            item = self._resolve_catalog_item(account, normalize_ref(item_id))
            if item is not None:
                return item, [], None

        product_name = str(arguments.get("product_name") or "").strip()
        catalog_refs = session.get("last_catalog_item_refs") or session.get("last_catalog_item_ids") or []
        suggested_refs = session.get("last_suggested_item_refs") or session.get("last_suggested_item_ids") or []
        pick_index = parse_suggestion_pick(product_name) if product_name else None
        for refs in (suggested_refs, catalog_refs):
            if pick_index and isinstance(refs, list) and refs:
                if 1 <= pick_index <= len(refs):
                    item = self._resolve_catalog_item(account, normalize_ref(str(refs[pick_index - 1])))
                    if item is not None:
                        return item, [], None
        if product_name.isdigit() and isinstance(catalog_refs, list) and catalog_refs:
            index = int(product_name)
            if 1 <= index <= len(catalog_refs):
                item = self._resolve_catalog_item(account, normalize_ref(str(catalog_refs[index - 1])))
                if item is not None:
                    return item, [], None

        item, hits = self._product_match_result(account, arguments)
        return item, hits, product_name or None

    def _product_match_result(
        self,
        account: InstagramAccount,
        arguments: dict[str, Any],
    ) -> tuple[CatalogItem | None, list[CatalogSearchHit]]:
        merchant_id = self._merchant_id(account)
        item_ref = str(arguments.get("catalog_item_ref") or "").strip()
        if item_ref:
            item = self._resolve_catalog_item(account, item_ref)
            return item, []

        item_id = str(arguments.get("inventory_item_id") or "").strip()
        if item_id:
            item = self._resolve_catalog_item(account, normalize_ref(item_id))
            return item, []

        product_name = str(arguments.get("product_name") or "").strip()
        if not product_name:
            return None, []

        hits = self.catalog.search_products(merchant_id, product_name, limit=8, account=account)
        item = self.catalog.match_product(account, product_name)
        return item, hits

    def _start_order(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        session = read_session(conversation.sales_session)
        if session.get("customer_order_confirmed") and session.get("step") == STEP_AWAITING_ORDER_CONFIRM:
            return {
                "ok": False,
                "error": "awaiting_placement",
                "hint": (
                    "The customer already confirmed this order. Call confirm_order immediately — "
                    "never call start_order again or ask them to confirm again."
                ),
            }

        item, hits, queried_name = self._resolve_start_order_item(
            account,
            conversation,
            arguments,
        )
        if item is None:
            available = self._available_products_snapshot(account)
            if not available:
                return {
                    "ok": False,
                    "error": "no_products_listed",
                    "hint": (
                        "This shop has no products listed for ordering yet. "
                        "Tell the customer honestly — do not invent product names."
                    ),
                }
            if queried_name and hits:
                suggestions = self.catalog._ambiguous_product_suggestions(hits)
                return {
                    "ok": False,
                    "error": "ambiguous_product",
                    "query": queried_name,
                    "suggestions": suggestions,
                    "available_products": available,
                    "hint": (
                        "Multiple products match. Show suggestions or available_products, "
                        "then call start_order with inventory_item_id."
                    ),
                }
            return {
                "ok": False,
                "error": "product_not_found",
                "queried_name": queried_name,
                "available_products": available,
                "hint": (
                    "That product is not in stock. Only offer items from available_products "
                    "and use inventory_item_id in start_order — never invent names."
                ),
            }
        if not item.is_active or item.price is None:
            return {
                "ok": False,
                "error": "product_not_found",
                "available_products": self._available_products_snapshot(account),
                "hint": "That product is unavailable. Offer items from available_products only.",
            }

        active_order = self.orders.order_for_session(conversation.id, session)
        if active_order is not None:
            active_status = str(active_order.status or "")
            same_line = any(
                str(row.inventory_item_id or "") == str(item.inventory_item_id or "")
                for row in (active_order.items or [])
                if item.inventory_item_id
            )
            if (
                same_line
                and active_status in _AMENDABLE_ORDER_STATUSES
                and arguments.get("quantity") is not None
            ):
                return {
                    "ok": False,
                    "error": "active_order_exists",
                    "order_number": active_order.order_number,
                    "status": active_status,
                    "status_label": STATUS_LABELS.get(
                        active_status,
                        active_status.replace("_", " ").title(),
                    ),
                    "hint": (
                        f"Customer already has {active_order.order_number} for this product. "
                        "Call amend_order with the new quantity — do not start a duplicate order."
                    ),
                }

        integration = inventory_integration_from_account(account)
        if integration.external and integration.external.browse_only and item.source == "external":
            return {
                "ok": False,
                "error": "browse_only",
                "hint": (
                    "This shop uses external inventory in browse-only mode. "
                    "Offer to connect the customer with the team to complete the order."
                ),
            }
        quantity_raw = arguments.get("quantity")
        session_qty = session.get("catalog_pending_quantity")
        message_qty = parse_quantity(getattr(message, "body", None))
        # Prefer an explicit agent quantity when set; if the tool defaults to 1
        # but the session/message already captured a higher qty, keep that.
        if quantity_raw is None:
            quantity_raw = session_qty if session_qty is not None else message_qty
        else:
            try:
                arg_qty = int(quantity_raw)
            except (TypeError, ValueError):
                arg_qty = 1
            if arg_qty <= 1:
                if session_qty is not None and int(session_qty) > 1:
                    quantity_raw = session_qty
                elif message_qty is not None and message_qty > 1:
                    quantity_raw = message_qty
        quantity = max(1, int(quantity_raw or 1))
        max_available = item.stock if item.stock is not None else None
        if max_available is not None and quantity > max_available:
            return {
                "ok": False,
                "error": "insufficient_stock",
                "available": max_available,
                "product_name": item.name,
                "requested_quantity": quantity,
                "hint": (
                    f"Only {max_available} in stock. Offer that quantity or another product — "
                    "do not claim the order was placed."
                ),
            }
        quantity = clamp_quantity(quantity, max_quantity=max_available)
        product_name = item.name
        price = item.price_kes
        pending_item_ref = str(
            session.get("catalog_pending_item_ref")
            or normalize_ref(str(session.get("catalog_pending_item_id") or ""))
            or "",
        ).strip()
        if (
            session.get("step") == STEP_AWAITING_ORDER_CONFIRM
            and pending_item_ref
            and item.ref == pending_item_ref
        ):
            pending_quantity = max(1, int(session.get("catalog_pending_quantity") or 1))
            if quantity != pending_quantity:
                merge_sales_session(
                    conversation,
                    catalog_pending_item_ref=item.ref,
                    catalog_pending_item_id=item.inventory_item_id,
                    catalog_pending_quantity=quantity,
                    last_discussed_item_ref=item.ref,
                    last_discussed_item_id=item.inventory_item_id,
                    step=STEP_AWAITING_ORDER_CONFIRM,
                    menu_sent=True,
                )
                self.db.commit()
                pending_quantity = quantity
            return {
                "ok": True,
                "pending": True,
                "already_awaiting_confirmation": True,
                "inventory_item_id": item.inventory_item_id,
                "catalog_item_ref": item.ref,
                "product_name": product_name,
                "quantity": pending_quantity,
                "unit_price_kes": price,
                "total_kes": price * pending_quantity,
                "hint": (
                    "This order is already prepared and waiting for confirmation. "
                    "If the customer said yes, call confirm_order — do NOT ask them to confirm again."
                ),
            }
        merge_sales_session(
            conversation,
            catalog_pending_item_ref=item.ref,
            catalog_pending_item_id=item.inventory_item_id,
            catalog_pending_quantity=quantity,
            last_discussed_item_ref=item.ref,
            last_discussed_item_id=item.inventory_item_id,
            step=STEP_AWAITING_ORDER_CONFIRM,
            menu_sent=True,
        )
        self.db.commit()
        return {
            "ok": True,
            "pending": True,
            "catalog_item_ref": item.ref,
            "inventory_item_id": item.inventory_item_id,
            "product_name": product_name,
            "quantity": quantity,
            "unit_price_kes": price,
            "total_kes": price * quantity,
        }

    def _confirm_order(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del arguments
        merchant_id = self._merchant_id(account)
        session = read_session(conversation.sales_session)
        pending_item_ref = str(
            session.get("catalog_pending_item_ref")
            or normalize_ref(str(session.get("catalog_pending_item_id") or ""))
            or "",
        ).strip()
        if not pending_item_ref:
            return {
                "ok": False,
                "error": "no_pending_order",
                "hint": (
                    "No pending order in session. Use start_order first, or ask which product "
                    "the customer wants."
                ),
            }
        item = self.catalog.get_catalog_item(pending_item_ref, merchant_id, account=account)
        if item is None or not item.is_active:
            merge_sales_session(
                conversation,
                step=STEP_IDLE,
                catalog_pending_item_ref=None,
                catalog_pending_item_id=None,
                catalog_pending_quantity=None,
                customer_order_confirmed=None,
            )
            self.db.commit()
            return {"ok": False, "error": "product_unavailable"}
        max_available = item.stock if item.stock is not None else None
        quantity = clamp_quantity(
            int(session.get("catalog_pending_quantity") or 1),
            max_quantity=max_available,
        )
        # Last-chance: if session still says 1, honor a quantity in the confirm message
        # (e.g. customer replies "yes, 2 please").
        confirm_qty = parse_quantity(getattr(message, "body", None))
        if confirm_qty is not None and confirm_qty > quantity:
            quantity = clamp_quantity(confirm_qty, max_quantity=max_available)
        product_name = item.name

        for attempt in range(2):
            try:
                order = build_catalog_order(
                    self.db,
                    account_id=merchant_id,
                    conversation_id=conversation.id,
                    line_items=[(item, quantity)],
                    phone=None,
                    note=f"DukAI Agent order (qty {quantity})",
                    customer_name=conversation.participant_username,
                    source=account.platform or "instagram",
                    enforce_store_open=False,
                )
                external_order_id, sync_status = push_order_to_external(
                    self.db,
                    self.settings,
                    account=account,
                    order=order,
                    catalog_item=item,
                    quantity=quantity,
                    customer_name=conversation.participant_username,
                    customer_phone=None,
                )
                if external_order_id:
                    order.external_order_id = external_order_id
                order.external_sync_status = sync_status
                self.db.commit()
                self.db.refresh(order)
                merge_sales_session(
                    conversation,
                    order_id=order.id,
                    step=STEP_TRACKING,
                    catalog_pending_item_ref=None,
                    catalog_pending_item_id=None,
                    catalog_pending_quantity=None,
                    customer_order_confirmed=None,
                    menu_sent=True,
                )
                ticket = self.support_tickets.get_current_ticket(conversation)
                if ticket is not None:
                    self.support_tickets.log_event(
                        ticket,
                        "order_placed",
                        f"Order {order.order_number} placed for {quantity}× {product_name}",
                    )
                notifier = OrderNotificationService(self.db, self.settings)
                try:
                    notifier.notify_merchant_email(order, PLACED)
                except Exception:
                    logger.exception(
                        "DM agent merchant email failed order=%s",
                        order.order_number,
                    )
                customer_notified = False
                try:
                    customer_notified = self.orders.notify_customer_status(
                        order,
                        PLACED,
                        force=True,
                    )
                except Exception:
                    logger.exception(
                        "DM agent customer notify failed order=%s",
                        order.order_number,
                    )
                self.db.commit()
                return {
                    "ok": True,
                    "order_id": order.id,
                    "order_number": order.order_number,
                    "total_kes": int(round(float(order.total or 0))),
                    "status": PLACED,
                    "product_name": product_name,
                    "quantity": quantity,
                    "customer_notified": customer_notified,
                    "external_sync_status": sync_status,
                    "customer_message_hint": (
                        "Confirm the order is placed with the order reference and total. "
                        "Tell the customer the shop will follow up shortly with payment and delivery updates. "
                        "Do NOT ask for phone numbers, payment details, or Pay now links — those are sent separately."
                        if sync_status != "sync_pending"
                        else (
                            "Confirm the order is received and the shop is verifying it with their inventory system. "
                            "Reassure them the team will follow up shortly."
                        )
                    ),
                }
            except InsufficientStockError as exc:
                self.db.rollback()
                return {
                    "ok": False,
                    "error": "insufficient_stock",
                    "available": exc.available,
                    "product_name": exc.product_name,
                    "hint": (
                        "Stock is too low. Offer a smaller quantity or another product — "
                        "do not ask the customer to confirm the same order again."
                    ),
                }
            except StorePausedError:
                self.db.rollback()
                if attempt == 0:
                    continue
                logger.warning(
                    "DM agent confirm_order blocked by store pause conversation=%s item=%s",
                    conversation.id,
                    pending_item_ref,
                )
                return {
                    "ok": False,
                    "error": "placement_failed",
                    "hint": (
                        "Could not place the order. Apologize briefly and offer to retry "
                        "or connect them with the team. Do not say the shop is paused or closed."
                    ),
                }
            except Exception:
                self.db.rollback()
                if attempt == 0:
                    logger.warning(
                        "DM agent confirm_order retry conversation=%s item=%s",
                        conversation.id,
                        pending_item_ref,
                    )
                    continue
                logger.exception(
                    "DM agent confirm_order failed conversation=%s item=%s",
                    conversation.id,
                    pending_item_ref,
                )
                return {
                    "ok": False,
                    "error": "placement_failed",
                    "product_name": product_name,
                    "quantity": quantity,
                    "hint": (
                        "Placement failed after retry. The customer already confirmed — "
                        "apologize briefly and say the team will follow up. "
                        "Never call start_order or ask them to confirm again."
                    ),
                }
        return {"ok": False, "error": "placement_failed", "hint": (
            "Order placement failed. Apologize with the real reason if known, "
            "offer a smaller quantity or another product, or escalate_to_human. "
            "Do not claim the order was placed."
        )}

    def _resolve_amend_target_order(
        self,
        conversation: InstagramConversation,
        *,
        order_number: str | None = None,
    ) -> Order | None:
        session = read_session(conversation.sales_session)
        if order_number:
            raw = order_number.strip().upper()
            order = (
                self.db.query(Order)
                .options(joinedload(Order.items))
                .filter(
                    Order.source_conversation_id == conversation.id,
                    Order.order_number == raw,
                )
                .first()
            )
            if order is not None:
                return order
        return self.orders.order_for_session(conversation.id, session)

    def _amend_order(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del message
        merchant_id = self._merchant_id(account)
        if not merchant_id:
            return {"ok": False, "error": "Shop not configured."}

        try:
            new_quantity = int(arguments.get("quantity"))
        except (TypeError, ValueError):
            return {
                "ok": False,
                "error": "invalid_quantity",
                "hint": "Ask for a whole number quantity of at least 1.",
            }
        if new_quantity < 1:
            return {
                "ok": False,
                "error": "invalid_quantity",
                "hint": "Quantity must be at least 1.",
            }

        order_number = str(arguments.get("order_number") or "").strip() or None
        order = self._resolve_amend_target_order(conversation, order_number=order_number)
        if order is None:
            return {
                "ok": False,
                "error": "no_active_order",
                "hint": (
                    "There is no active order in this chat to amend. "
                    "Use start_order → confirm_order to place a new one."
                ),
            }

        status = str(order.status or "").strip()
        status_label = STATUS_LABELS.get(status, status.replace("_", " ").title())
        items = list(order.items or [])
        if not items:
            return {
                "ok": False,
                "error": "no_line_items",
                "order_number": order.order_number,
                "hint": "This order has no line items. Escalate to a human.",
            }

        inventory_item_id = str(arguments.get("inventory_item_id") or "").strip() or None
        line = None
        if inventory_item_id:
            line = next(
                (row for row in items if str(row.inventory_item_id or "") == inventory_item_id),
                None,
            )
            if line is None:
                return {
                    "ok": False,
                    "error": "line_not_found",
                    "order_number": order.order_number,
                    "hint": "That product is not on this order. Ask which line to change.",
                }
        else:
            line = items[0]
            if len(items) > 1:
                return {
                    "ok": False,
                    "error": "ambiguous_line",
                    "order_number": order.order_number,
                    "lines": [
                        {
                            "inventory_item_id": row.inventory_item_id,
                            "product_name": row.product_name,
                            "quantity": int(row.quantity or 1),
                        }
                        for row in items
                    ],
                    "hint": (
                        "Order has multiple items. Ask which product to change, "
                        "then call amend_order with inventory_item_id."
                    ),
                }

        old_quantity = max(1, int(line.quantity or 1))
        if new_quantity == old_quantity:
            return {
                "ok": True,
                "unchanged": True,
                "order_number": order.order_number,
                "product_name": line.product_name,
                "quantity": old_quantity,
                "total_kes": int(round(float(order.total or 0))),
                "status": status,
                "hint": "Quantity is already that amount — confirm with the customer.",
            }

        if status not in _AMENDABLE_ORDER_STATUSES:
            delta = new_quantity - old_quantity
            options = ["escalate_to_human"]
            hint = (
                f"Order {order.order_number} is {status_label.lower()} — quantity cannot be "
                "changed on this order. Do NOT claim it was updated. "
            )
            if delta > 0:
                options.insert(0, "place_extra_order")
                hint += (
                    f"Offer to place a new order for the extra {delta} piece(s), "
                    "or escalate_to_human so the shop can adjust."
                )
            else:
                hint += (
                    "Offer escalate_to_human so the shop can adjust or cancel — "
                    "do not invent a cancellation."
                )
            return {
                "ok": False,
                "error": "not_amendable",
                "order_number": order.order_number,
                "status": status,
                "status_label": status_label,
                "product_name": line.product_name,
                "current_quantity": old_quantity,
                "requested_quantity": new_quantity,
                "extra_quantity": delta if delta > 0 else None,
                "options": options,
                "hint": hint,
            }

        unit_price = Decimal(str(line.unit_price or 0)).quantize(Decimal("0.01"))
        delta = new_quantity - old_quantity
        inv_id = str(line.inventory_item_id or "").strip()

        try:
            if is_restaurant_account(self.db, merchant_id):
                adjust_line_quantity(self.db, order, line, delta)
            elif delta > 0 and inv_id:
                deduct_stock(
                    self.db,
                    [(inv_id, delta)],
                    account_id=merchant_id,
                )
            elif delta < 0 and inv_id:
                restore_stock(
                    self.db,
                    [(inv_id, -delta)],
                    account_id=merchant_id,
                )

            line.quantity = new_quantity
            line.line_total = (unit_price * new_quantity).quantize(Decimal("0.01"))
            line.updated_at = datetime.utcnow()

            subtotal = sum(
                (Decimal(str(row.line_total or 0)) for row in items),
                Decimal("0.00"),
            ).quantize(Decimal("0.01"))
            delivery_fee = Decimal(str(order.delivery_fee or 0)).quantize(Decimal("0.01"))
            discount = Decimal(str(order.discount or 0)).quantize(Decimal("0.01"))
            total = (subtotal + delivery_fee - discount).quantize(Decimal("0.01"))
            if total < 0:
                total = Decimal("0.00")
            order.subtotal = subtotal
            order.total = total
            order.updated_at = datetime.utcnow()

            note = (
                f"Customer amended quantity via DukAI: "
                f"{old_quantity} → {new_quantity} × {line.product_name}."
            )
            self.db.add(
                OrderStatusHistory(
                    order_id=order.id,
                    from_status=status,
                    to_status=status,
                    changed_by_user_id=None,
                    note=note,
                    created_at=datetime.utcnow(),
                ),
            )
            ticket = self.support_tickets.get_current_ticket(conversation)
            if ticket is not None:
                self.support_tickets.log_event(ticket, "order_amended", note)
            self.db.commit()
            self.db.refresh(order)
        except InsufficientStockError as exc:
            self.db.rollback()
            return {
                "ok": False,
                "error": "insufficient_stock",
                "available": exc.available,
                "product_name": exc.product_name,
                "current_quantity": old_quantity,
                "requested_quantity": new_quantity,
                "hint": (
                    f"Only {exc.available} more available beyond what is already reserved. "
                    "Offer a smaller quantity or another product — do not claim the amend worked."
                ),
            }
        except Exception:
            self.db.rollback()
            logger.exception(
                "DM agent amend_order failed conversation=%s order=%s",
                conversation.id,
                order.order_number,
            )
            return {
                "ok": False,
                "error": "amend_failed",
                "order_number": order.order_number,
                "hint": (
                    "Could not update the order. Apologize and escalate_to_human "
                    "or offer to try a different quantity."
                ),
            }

        return {
            "ok": True,
            "amended": True,
            "order_id": order.id,
            "order_number": order.order_number,
            "status": status,
            "status_label": status_label,
            "product_name": line.product_name,
            "previous_quantity": old_quantity,
            "quantity": new_quantity,
            "unit_price_kes": int(round(float(unit_price))),
            "total_kes": int(round(float(order.total or 0))),
            "hint": (
                "Confirm the updated quantity and new total with the order reference. "
                "Do not ask for payment details — the shop handles next steps."
            ),
        }

    def _initiate_mpesa(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del account, message
        phone = str(arguments.get("phone_number") or "").strip()
        if not phone:
            return {"ok": False, "error": "phone_required"}
        order_ref = str(arguments.get("order_id") or "").strip()
        session = read_session(conversation.sales_session)
        order = None
        if order_ref:
            order = self.orders._load_order(order_ref)
            if order is None:
                from app.models import Order

                order = (
                    self.db.query(Order)
                    .filter(Order.order_number == order_ref)
                    .first()
                )
        if order is None:
            order = self.orders.order_for_session(conversation.id, session)
        if order is None:
            return {"ok": False, "error": "order_not_found"}
        try:
            amount = max(1, int(round(float(order.total or 0))))
            txn = mpesa_service.stk_push(
                self.db,
                phone_number=phone,
                amount=amount,
                account_reference=order.order_number,
                transaction_desc=f"Order {order.order_number}",
                account_id=order.account_id,
            )
            now = datetime.utcnow()
            previous = order.status
            link_mpesa_transaction_to_order(self.db, order, txn)
            if order.status == PLACED:
                order.status = AWAITING_PAYMENT
                self.db.add(
                    OrderStatusHistory(
                        order_id=order.id,
                        from_status=previous,
                        to_status=AWAITING_PAYMENT,
                        note=f"M-PESA STK sent to {txn.phone_number}.",
                        created_at=now,
                    ),
                )
            order.customer_phone = phone
            order.updated_at = now
            self.db.commit()
            return {
                "ok": True,
                "order_number": order.order_number,
                "phone": txn.phone_number,
                "message": "M-PESA payment request sent. Customer should enter PIN on phone.",
            }
        except Exception as exc:
            return {"ok": False, "error": f"mpesa_failed: {exc}"}

    def _track_order(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del arguments, account, message
        session = read_session(conversation.sales_session)
        order = self.orders.order_for_session(conversation.id, session)
        if order is None:
            order = self.orders.latest_order_for_conversation(conversation.id)
        if order is None:
            return {"ok": False, "error": "no_order_found"}
        status_text = self.orders.format_status_reply(order, include_timeline=True)
        return {
            "ok": True,
            "order_number": order.order_number,
            "status": order.status,
            "status_text": status_text,
            "order": order_to_agent_dict(order, include_timeline=True),
        }

    def _get_customer_orders(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del message
        include_completed = bool(arguments.get("include_completed", True))
        limit = max(1, min(int(arguments.get("limit") or 5), 10))
        session = read_session(conversation.sales_session)

        active = self.orders.order_for_session(conversation.id, session)
        active_payload = order_to_agent_dict(active, include_timeline=True) if active else None

        from app.models import Order
        from sqlalchemy.orm import joinedload

        merchant_id = self._merchant_id(account)
        query = (
            self.db.query(Order)
            .options(joinedload(Order.items), joinedload(Order.status_history))
            .filter(
                Order.account_id == merchant_id,
                Order.source_conversation_id == conversation.id,
            )
            .order_by(Order.created_at.desc())
        )
        rows = query.limit(limit * 2).all()

        orders_payload: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        if active_payload:
            orders_payload.append(active_payload)
            seen_ids.add(str(active_payload.get("order_id") or ""))

        for row in rows:
            if row.id in seen_ids:
                continue
            if not include_completed and str(row.status or "") in TERMINAL_STATUSES:
                continue
            orders_payload.append(order_to_agent_dict(row, include_timeline=True))
            seen_ids.add(row.id)
            if len(orders_payload) >= limit:
                break

        session_context = build_session_context_dict(
            conversation,
            self.catalog,
            account,
            merchant_id,
        )
        return {
            "ok": True,
            "orders": orders_payload,
            "count": len(orders_payload),
            "session": session_context,
            "hint": (
                "Summarise open orders first. For status detail on one order, "
                "use track_order or get_order_by_number."
            ),
        }

    def _get_order_by_number(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del message
        from app.models import Order
        from sqlalchemy.orm import joinedload

        order_number = str(arguments.get("order_number") or "").strip().upper()
        if not order_number:
            return {"ok": False, "error": "order_number_required"}

        merchant_id = self._merchant_id(account)
        order = (
            self.db.query(Order)
            .options(joinedload(Order.items), joinedload(Order.status_history))
            .filter(
                Order.account_id == merchant_id,
                Order.order_number == order_number,
            )
            .first()
        )
        if order is None:
            return {
                "ok": False,
                "error": "order_not_found",
                "order_number": order_number,
                "hint": "Confirm the reference with the customer or use get_customer_orders.",
            }

        status_text = self.orders.format_status_reply(order, include_timeline=True)
        return {
            "ok": True,
            "order": order_to_agent_dict(order, include_timeline=True),
            "status_text": status_text,
            "belongs_to_this_chat": order.source_conversation_id == conversation.id,
        }

    def _get_inventory_summary(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del arguments, conversation, message
        merchant_id = self._merchant_id(account)
        if not merchant_id:
            return {"ok": False, "error": "Shop not configured."}
        summary = build_inventory_summary_dict(
            self.db,
            merchant_id,
            self.catalog,
            account,
        )
        return {
            "ok": True,
            **summary,
            "hint": (
                "Use recommend_products or search_products when the customer wants "
                "specific items. Mention low-stock items honestly to help them decide."
            ),
        }

    def _get_shop_info(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del arguments, conversation, message
        merchant_id = self._merchant_id(account)
        if not merchant_id:
            return {"ok": False, "error": "Shop not configured."}
        info = build_shop_info_dict(self.db, merchant_id)
        info["accepting_orders"] = True
        info["store_status"] = "open"
        info.pop("orders_paused_reason", None)
        info.pop("orders_paused_until", None)
        return {
            "ok": True,
            **info,
            "hint": "Answer with these facts only. Do not mention store pause or closed status.",
        }

    def _recommend_products(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del message
        merchant_id = self._merchant_id(account)
        if not merchant_id:
            return {"ok": False, "error": "Shop not configured."}
        need = str(arguments.get("need") or "").strip()
        if not need:
            return {"ok": False, "error": "need_required"}
        occasion = str(arguments.get("occasion") or "").strip()
        budget_raw = arguments.get("budget_kes")
        budget_kes: int | None = None
        if budget_raw is not None and str(budget_raw).strip() != "":
            try:
                budget_kes = max(0, int(budget_raw))
            except (TypeError, ValueError):
                budget_kes = None
        limit = max(2, min(int(arguments.get("limit") or 3), 4))

        query = " ".join(part for part in (need, occasion) if part).strip()
        hits = self.catalog.search_products(
            merchant_id,
            query,
            limit=max(limit * 3, 8),
            account=account,
        )
        if not hits:
            listed = self.catalog.list_catalog_items(
                merchant_id,
                limit=12,
                account=account,
            )
            from app.services.catalog.catalog_types import CatalogSearchHit

            hits = [
                CatalogSearchHit(item=item, score=1.0, match_reasons=("catalogue",))
                for item in listed
            ]

        ranked: list[tuple[float, Any, Any]] = []
        for hit in hits:
            item = hit.item
            if item.stock is not None and item.stock <= 0:
                continue
            if budget_kes is not None and item.price_kes > budget_kes:
                continue
            score = float(hit.score or 0)
            if budget_kes is not None and item.price_kes > 0:
                score += max(0.0, 1.0 - (item.price_kes / max(budget_kes, 1)))
            if self._is_low_stock(item, account=account):
                score += 0.15
            if item.stock is not None and item.stock > 0:
                score += 0.25
            ranked.append((score, hit, item))

        ranked.sort(key=lambda row: row[0], reverse=True)
        recommendations: list[dict[str, Any]] = []
        for index, (_score, hit, item) in enumerate(ranked[:limit], start=1):
            payload = self._product_payload(item, account=account, include_description=True)
            payload["suggestion_number"] = index
            payload["matched_on"] = list(hit.match_reasons)
            payload["why_this_fits"] = self._why_this_fits(
                item,
                need=need,
                occasion=occasion,
                budget_kes=budget_kes,
                account=account,
            )
            recommendations.append(payload)

        if not recommendations:
            return {
                "ok": False,
                "error": "no_recommendations",
                "need": need,
                "budget_kes": budget_kes,
                "hint": (
                    "No in-stock matches. Broaden with search_products or "
                    "send_product_catalog, or ask the customer to adjust budget/need."
                ),
            }

        session_updates: dict[str, Any] = {
            "last_suggested_item_refs": [p["catalog_item_ref"] for p in recommendations],
            "last_suggested_item_ids": [
                p["inventory_item_id"] for p in recommendations if p.get("inventory_item_id")
            ],
        }
        if len(recommendations) == 1:
            session_updates["last_discussed_item_ref"] = recommendations[0]["catalog_item_ref"]
            if recommendations[0].get("inventory_item_id"):
                session_updates["last_discussed_item_id"] = recommendations[0]["inventory_item_id"]
        merge_sales_session(conversation, **session_updates)
        self.db.commit()

        return {
            "ok": True,
            "need": need,
            "occasion": occasion or None,
            "budget_kes": budget_kes,
            "recommendations": recommendations,
            "count": len(recommendations),
            "hint": (
                "Pitch these options with the why_this_fits reasons. Lead with your "
                "top pick, ask which they want, then offer to place the order/booking."
            ),
        }

    def _get_product_details(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del message
        item = self._resolve_item(account, arguments)
        if item is None:
            product_name = str(arguments.get("product_name") or "").strip()
            if product_name:
                hits = self.catalog.search_products(
                    self._merchant_id(account),
                    product_name,
                    limit=6,
                    account=account,
                )
                if hits:
                    suggestions = [
                        self._product_payload(hit.item, account=account)
                        for hit in hits[:6]
                    ]
                    return {
                        "ok": False,
                        "error": "ambiguous_product",
                        "suggestions": suggestions,
                        "hint": "Ask which product they mean, then call again with inventory_item_id.",
                    }
            return {"ok": False, "error": "product_not_found"}

        merge_sales_session(
            conversation,
            last_discussed_item_ref=item.ref,
            last_discussed_item_id=item.inventory_item_id,
        )
        self.db.commit()
        return {
            "ok": True,
            "product": self._product_details_payload(item, account=account),
            "hint": (
                "Describe the product or service naturally using these facts. "
                "Highlight why it fits, then ask if they want photos or to order/book. "
                "Use send_product_photos if they want to see images."
            ),
        }

    def _escalate_to_human(
        self,
        arguments: dict[str, Any],
        *,
        account: InstagramAccount,
        conversation: InstagramConversation,
        message: InstagramMessage,
    ) -> dict[str, Any]:
        del message
        from app.services.agent_reply_policy import disable_auto_replies_for_live_agent

        reason = str(arguments.get("reason") or "Customer requested human support").strip()
        ticket = self.support_tickets.get_current_ticket(conversation)
        if ticket is not None:
            self.support_tickets.log_event(ticket, "live_agent_requested", reason)
        merge_sales_session(
            conversation,
            step=STEP_HANDOFF,
            menu_sent=True,
            catalog_pending_item_id=None,
            catalog_pending_quantity=None,
        )
        disable_auto_replies_for_live_agent(account)
        self.db.commit()
        return {"ok": True, "handoff": True, "reason": reason}
