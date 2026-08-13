"""Tool definitions for the Instagram post comment AI agent."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount
from app.services.comment_product_context import (
    detect_mentioned_products,
    linked_product_catalog,
    load_linked_inventory_items,
    search_linked_products,
    search_shop_products,
)
from app.services.dm_catalog_service import DmCatalogService

logger = logging.getLogger(__name__)

COMMENT_AGENT_TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "get_linked_post_products",
        "description": (
            "List all inventory products linked to this Instagram post. "
            "These are the primary products featured in the post."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "search_linked_products",
        "description": (
            "Search products linked to this post by keyword, category, or name. "
            "Use when the comment mentions a product type (e.g. spray, perfume)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Keyword or product name fragment to search for.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max results (default 6).",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "search_shop_products",
        "description": (
            "Search the wider shop catalogue when nothing linked to the post matches. "
            "Prefer search_linked_products first."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search keyword."},
                "limit": {"type": "integer", "description": "Max results (default 6)."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "match_comment_mentions",
        "description": (
            "Detect which linked post products are mentioned by name in the customer's comment."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
]


class CommentAgentTools:
    def __init__(
        self,
        db: Session,
        settings: Settings,
        instagram_api,
        *,
        merchant_account_id: str,
        post_id: str,
        comment_text: str,
    ):
        self.db = db
        self.settings = settings
        self.merchant_account_id = merchant_account_id
        self.post_id = post_id
        self.comment_text = comment_text
        self.catalog = DmCatalogService(db, settings, instagram_api)
        self._linked_items: list | None = None
        self._linked_products: list[dict[str, Any]] | None = None

    def _linked_inventory(self):
        if self._linked_items is None:
            self._linked_items = load_linked_inventory_items(
                self.db,
                merchant_account_id=self.merchant_account_id,
                post_id=self.post_id,
            )
        return self._linked_items

    def _linked_catalog(self) -> list[dict[str, Any]]:
        if self._linked_products is None:
            self._linked_products = linked_product_catalog(
                self.db,
                merchant_account_id=self.merchant_account_id,
                post_id=self.post_id,
            )
        return self._linked_products

    def execute(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        handlers = {
            "get_linked_post_products": self._get_linked_post_products,
            "search_linked_products": self._search_linked_products,
            "search_shop_products": self._search_shop_products,
            "match_comment_mentions": self._match_comment_mentions,
        }
        handler = handlers.get(name)
        if handler is None:
            return {"ok": False, "error": f"Unknown tool: {name}"}
        try:
            return handler(arguments)
        except Exception as exc:
            logger.exception("Comment agent tool %s failed", name)
            return {"ok": False, "error": str(exc)}

    def _get_linked_post_products(self, arguments: dict[str, Any]) -> dict[str, Any]:
        del arguments
        products = self._linked_catalog()
        return {
            "ok": True,
            "products": products,
            "count": len(products),
            "post_id": self.post_id,
            "hint": (
                "These products are linked to the post. Match customer wording to these names."
                if products
                else "No products are linked to this post — use search_shop_products if needed."
            ),
        }

    def _search_linked_products(self, arguments: dict[str, Any]) -> dict[str, Any]:
        query = str(arguments.get("query") or "").strip()
        if not query:
            return {"ok": False, "error": "query_required"}
        limit = max(1, min(int(arguments.get("limit") or 6), 10))
        products = search_linked_products(self._linked_inventory(), query, limit=limit)
        return {
            "ok": True,
            "query": query,
            "products": products,
            "count": len(products),
            "hint": (
                "Suggest these options in your public reply. Invite them to DM to order."
                if len(products) > 1
                else "Confirm this is the product they mean, then invite them to DM to order."
            ),
        }

    def _search_shop_products(self, arguments: dict[str, Any]) -> dict[str, Any]:
        query = str(arguments.get("query") or "").strip()
        if not query:
            return {"ok": False, "error": "query_required"}
        limit = max(1, min(int(arguments.get("limit") or 6), 10))
        linked_ids = {item.id for item in self._linked_inventory()}
        products = search_shop_products(
            self.catalog,
            self.merchant_account_id,
            query,
            limit=limit,
            linked_item_ids=linked_ids,
        )
        return {
            "ok": True,
            "query": query,
            "products": products,
            "count": len(products),
        }

    def _match_comment_mentions(self, arguments: dict[str, Any]) -> dict[str, Any]:
        del arguments
        products = detect_mentioned_products(self.comment_text, self._linked_catalog())
        return {
            "ok": True,
            "comment_text": self.comment_text,
            "mentioned_products": products,
            "count": len(products),
        }
