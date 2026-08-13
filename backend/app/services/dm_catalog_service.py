from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Literal
from urllib.parse import urljoin

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount, InstagramConversation, InstagramMessage, InventoryItem
from app.services.catalog.catalog_search import search_catalog_items
from app.services.catalog.catalog_types import CatalogItem, CatalogSearchHit, normalize_ref
from app.services.catalog.factory import resolve_catalog_provider
from app.services.dm_chips_only import dm_chips_only_active, dm_offer_quick_replies, product_select_quick_replies
from app.services.dm_templates import (
    format_catalog_follow_up,
    format_empty_store_message,
    format_no_catalog_matches_message,
    live_agent_quick_replies,
    menu_back_quick_replies,
)
from app.services.messaging_service import InstagramOutboundService
from app.services.storefront_service import StorefrontService
from app.support.datetime_utils import utc_now

logger = logging.getLogger(__name__)

# Cap catalogue size for DM readability; overflow points customers to the shop link.
MAX_CATALOG_ITEMS = 25
# Instagram generic-template carousels support up to 10 cards in one message.
MAX_CAROUSEL_ITEMS = 10

PRODUCT_CARD_PREFIX = "[product_card]"
PRODUCT_CATALOG_PREFIX = "[product_catalog]"


@dataclass
class CatalogDeliveryStep:
    kind: Literal["text", "image", "product", "catalog"]
    body: str
    quick_replies: list[dict[str, str]] | None = None


@dataclass
class CatalogSendResult:
    """Outcome of attempting to deliver a catalogue in DM."""

    catalog_sent: bool = False
    item_count: int = 0
    empty_store: bool = False
    no_matches: bool = False
    outbound_delivered: bool = False
    query: str | None = None
    summary: str = ""


@dataclass
class ProductPhotosSendResult:
    """Outcome of sending photos for a single catalogue item."""

    photos_sent: bool = False
    image_count: int = 0
    no_images: bool = False
    product_not_found: bool = False
    outbound_delivered: bool = False
    product_name: str = ""


class DmCatalogService:
    """Build and send product catalogues for Instagram DM menu options."""

    def __init__(self, db: Session, settings: Settings, instagram_api):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api

    def provider_for_account(self, account: InstagramAccount | None = None, *, merchant_id: str = ""):
        account_id = merchant_id or str(getattr(account, "account_id", "") or "").strip()
        return resolve_catalog_provider(
            self.db,
            self.settings,
            account_id,
            instagram_account=account,
        )

    def match_product(
        self,
        account: InstagramAccount,
        text: str,
    ) -> CatalogItem | None:
        merchant_id = str(account.account_id or "").strip()
        if not merchant_id:
            return None
        return self.provider_for_account(account, merchant_id=merchant_id).match_product(merchant_id, text)

    def search_products(
        self,
        merchant_id: str,
        query: str,
        *,
        limit: int = 8,
        account: InstagramAccount | None = None,
    ) -> list[CatalogSearchHit]:
        return self.provider_for_account(account, merchant_id=merchant_id).search(
            merchant_id,
            query,
            limit=limit,
        )

    @classmethod
    def _score_product_match(cls, query: str, item: InventoryItem) -> CatalogSearchHit | None:
        from app.services.catalog.platform_provider import inventory_item_to_catalog
        from app.services.catalog.catalog_search import score_catalog_match

        catalog_item = inventory_item_to_catalog(item)
        if catalog_item is None:
            return None
        return score_catalog_match(query, catalog_item)

    @classmethod
    def _search_items(
        cls,
        query: str,
        items: list[InventoryItem],
        *,
        limit: int = 8,
    ) -> list[CatalogSearchHit]:
        from app.services.catalog.platform_provider import inventory_item_to_catalog

        catalog_items = [
            mapped
            for mapped in (inventory_item_to_catalog(item) for item in items)
            if mapped is not None
        ]
        return search_catalog_items(query, catalog_items, limit=limit)

    @classmethod
    def _match_item_from_text(cls, text: str, items: list[InventoryItem]) -> InventoryItem | None:
        from app.services.catalog.catalog_search import match_item_from_text
        from app.services.catalog.platform_provider import inventory_item_to_catalog

        catalog_items = [
            mapped
            for mapped in (inventory_item_to_catalog(item) for item in items)
            if mapped is not None
        ]
        matched = match_item_from_text(text, catalog_items)
        if matched is None or matched.inventory_item_id is None:
            return None
        for item in items:
            if str(item.id) == matched.inventory_item_id:
                return item
        return None

    @classmethod
    def _ambiguous_product_suggestions(
        cls,
        hits: list[CatalogSearchHit],
        *,
        limit: int = 6,
    ) -> list[dict[str, object]]:
        suggestions: list[dict[str, object]] = []
        for hit in hits[:limit]:
            item = hit.item
            suggestions.append(
                {
                    "catalog_item_ref": item.ref,
                    "inventory_item_id": item.inventory_item_id,
                    "name": item.name,
                    "category": item.category,
                    "brand": item.brand,
                    "price_kes": item.price_kes,
                    "stock": item.stock,
                    "unit": item.unit,
                    "matched_on": list(hit.match_reasons),
                },
            )
        return suggestions

    def get_catalog_item(
        self,
        ref: str,
        account_id: str,
        *,
        account: InstagramAccount | None = None,
    ) -> CatalogItem | None:
        return self.provider_for_account(account, merchant_id=account_id).get_item(
            account_id,
            normalize_ref(ref),
        )

    def item_by_id(self, item_id: str, account_id: str, *, account: InstagramAccount | None = None) -> InventoryItem | None:
        provider = self.provider_for_account(account, merchant_id=account_id)
        catalog_item = provider.get_item(account_id, normalize_ref(item_id))
        if catalog_item is None or catalog_item.inventory_item_id is None:
            return None
        if hasattr(provider, "platform"):
            return provider.platform.item_by_id(catalog_item.inventory_item_id, account_id)
        return (
            self.db.query(InventoryItem)
            .filter(InventoryItem.id == catalog_item.inventory_item_id, InventoryItem.account_id == account_id)
            .first()
        )

    def list_catalog_items(
        self,
        merchant_id: str,
        *,
        limit: int = 25,
        account: InstagramAccount | None = None,
    ) -> list[CatalogItem]:
        return self.provider_for_account(account, merchant_id=merchant_id).list_items(
            merchant_id,
            limit=limit,
        )

    def _load_items(self, merchant_id: str, *, account: InstagramAccount | None = None) -> list[InventoryItem]:
        provider = self.provider_for_account(account, merchant_id=merchant_id)
        rows: list[InventoryItem] = []
        for item in provider.list_items(merchant_id, limit=MAX_CATALOG_ITEMS):
            if item.inventory_item_id is None:
                continue
            row = provider.platform.item_by_id(item.inventory_item_id, merchant_id)
            if row is not None:
                rows.append(row)
        return rows

    def send_catalog(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        choice: int,
        *,
        query: str | None = None,
    ) -> CatalogSendResult:
        merchant_id = str(account.account_id or "").strip()
        provider = self.provider_for_account(account, merchant_id=merchant_id)
        all_items = provider.list_items(merchant_id, limit=MAX_CATALOG_ITEMS) if merchant_id else []
        all_sellable = [item for item in all_items if item.is_active and item.price is not None]
        normalized_query = (query or "").strip() or None

        items = all_items
        if normalized_query:
            hits = provider.search(merchant_id, normalized_query, limit=MAX_CATALOG_ITEMS)
            items = [hit.item for hit in hits]

        sellable = [item for item in items if item.is_active and item.price is not None]
        empty_store = len(all_sellable) == 0
        no_matches = not empty_store and bool(normalized_query) and len(sellable) == 0

        steps = self._compose_steps(
            conversation,
            sellable if normalized_query else all_sellable,
            choice,
            account=account,
            query=normalized_query,
        )
        summary, messages_sent = self._deliver(account, conversation, steps)
        item_count = sum(
            len(json.loads(step.body).get("items") or [])
            for step in steps
            if step.kind == "catalog"
        )
        return CatalogSendResult(
            catalog_sent=item_count > 0,
            item_count=item_count,
            empty_store=empty_store and not normalized_query,
            no_matches=no_matches,
            outbound_delivered=messages_sent > 0,
            query=normalized_query,
            summary=summary,
        )

    def _compose_steps(
        self,
        conversation: InstagramConversation,
        items: list[CatalogItem],
        choice: int,
        *,
        account: InstagramAccount | None = None,
        query: str | None = None,
    ) -> list[CatalogDeliveryStep]:
        shop_name = None
        if account is not None:
            from app.services.dm_agent_tools import resolve_shop_display_name

            shop_name = resolve_shop_display_name(account, self.db)
        if not items:
            if query and query.strip():
                return [
                    CatalogDeliveryStep(
                        "text",
                        format_no_catalog_matches_message(query.strip()),
                        quick_replies=live_agent_quick_replies(),
                    ),
                ]
            return [
                CatalogDeliveryStep(
                    "text",
                    format_empty_store_message(shop_name),
                    quick_replies=live_agent_quick_replies(),
                ),
            ]

        shop_link = ""
        if choice == 1:
            storefront = StorefrontService(self.db, self.settings)
            shop_link = storefront.mint_link(conversation) or ""

        catalog_items: list[dict[str, object]] = []
        overflow_count = 0
        index = 1
        for item in items:
            if len(catalog_items) >= MAX_CATALOG_ITEMS:
                overflow_count += 1
                index += 1
                continue
            catalog_items.append(
                {
                    "index": index,
                    "name": item.name,
                    "price": item.price_kes,
                    "image_url": self._absolute_media_url(item.primary_image_url) or "",
                    "category": item.category or "",
                    "brand": item.brand or "",
                    "unit": item.unit,
                    "catalog_item_ref": item.ref,
                },
            )
            index += 1

        title = "What we have in stock"
        footer = "Tap a product to continue."
        if query and query.strip():
            title = f"Matches for \"{query.strip()}\""
            footer = "Tap the one you want, or tell me which to order."

        payload = {
            "title": title,
            "items": catalog_items,
            "shop_link": shop_link,
            "footer": footer,
            "overflow_count": overflow_count,
        }
        steps = [
            CatalogDeliveryStep("catalog", json.dumps(payload)),
        ]
        offer_chips = account is not None and dm_offer_quick_replies(
            self.settings,
            account,
            db=self.db,
        )
        follow_up = format_catalog_follow_up(
            filtered=bool(query and query.strip()),
            item_count=len(catalog_items),
        )
        if offer_chips:
            product_rows = [
                (item.ref, item.name)
                for item in items
            ][:11]
            steps.append(
                CatalogDeliveryStep(
                    "text",
                    follow_up,
                    quick_replies=product_select_quick_replies(product_rows),
                ),
            )
        else:
            steps.append(
                CatalogDeliveryStep(
                    "text",
                    follow_up,
                    quick_replies=menu_back_quick_replies(),
                ),
            )
        return steps

    @staticmethod
    def _format_category_label(category: str) -> str:
        cleaned = category.replace("_", " ").replace("-", " ").strip()
        return cleaned.lower() if cleaned else ""

    @classmethod
    def _format_item_meta(cls, item: dict) -> str:
        category = cls._format_category_label(str(item.get("category") or ""))
        brand = str(item.get("brand") or "").strip()
        if category and brand:
            return f"{category} • {brand}"
        return category or brand or ""

    @classmethod
    def _format_item_price_line(cls, item: dict) -> str:
        price = int(item.get("price") or 0)
        unit = str(item.get("unit") or "pack").strip() or "pack"
        return f"KES {price:,} /{unit}"

    @classmethod
    def _format_item_subtitle(cls, item: dict) -> str:
        meta = cls._format_item_meta(item)
        price_line = cls._format_item_price_line(item)
        return f"{meta} · {price_line}" if meta else price_line

    @classmethod
    def _build_carousel_elements(cls, payload: dict) -> list[dict[str, str]]:
        overflow_count = int(payload.get("overflow_count") or 0)
        elements: list[dict[str, str]] = []
        for item in payload.get("items") or []:
            if not isinstance(item, dict):
                continue
            if len(elements) >= MAX_CAROUSEL_ITEMS:
                break
            index_n = int(item.get("index") or 0)
            name = str(item.get("name") or "Product")
            title = f"{index_n}. {name}"[:80]
            subtitle = cls._format_item_subtitle(item)[:80]
            element: dict[str, str] = {"title": title, "subtitle": subtitle}
            image_url = str(item.get("image_url") or "").strip()
            if image_url:
                element["image_url"] = image_url
            if title and (subtitle or image_url):
                elements.append(element)

        if overflow_count > 0 and elements:
            suffix = f" · +{overflow_count} more in shop"
            last = elements[-1]
            room = max(0, 80 - len(suffix))
            last["subtitle"] = f"{last.get('subtitle', '')[:room]}{suffix}"[:80]

        shop_link = str(payload.get("shop_link") or "").strip()
        footer = str(payload.get("footer") or "").strip()
        if elements and (shop_link or footer):
            hint_parts = [part for part in (footer, f"Shop: {shop_link}" if shop_link else "") if part]
            hint = " · ".join(hint_parts)[:80]
            last = elements[-1]
            room = max(0, 80 - len(hint) - 3)
            last["subtitle"] = f"{last.get('subtitle', '')[:room]} · {hint}"[:80]

        return elements

    @classmethod
    def _format_catalog_for_instagram(cls, payload: dict) -> str:
        lines = [str(payload.get("title") or "Our catalogue"), ""]
        for item in payload.get("items") or []:
            if not isinstance(item, dict):
                continue
            index_n = int(item.get("index") or 0)
            name = str(item.get("name") or "Product")
            lines.append(f"{index_n}. {name}")
            lines.append(f"   {cls._format_item_subtitle(item)}")
            lines.append("")
        overflow_count = int(payload.get("overflow_count") or 0)
        if overflow_count > 0:
            lines.append(f"+ {overflow_count} more item{'s' if overflow_count != 1 else ''} in our shop.")
        footer = str(payload.get("footer") or "").strip()
        if footer:
            lines.extend(["", footer])
        shop_link = str(payload.get("shop_link") or "").strip()
        if shop_link:
            lines.append(f"Browse & order: {shop_link}")
        return "\n".join(lines).strip()

    def _send_catalog_to_instagram(
        self,
        outbound: InstagramOutboundService,
        account: InstagramAccount,
        recipient_id: str,
        payload: dict,
        *,
        conversation_id: str | None = None,
    ) -> str:
        elements = self._build_carousel_elements(payload)
        if elements:
            try:
                return outbound.send_generic_template(
                    account,
                    recipient_id,
                    elements,
                    conversation_id=conversation_id,
                )
            except Exception as exc:
                logger.warning(
                    "DM catalog carousel failed conversation=%s cards=%s error=%s",
                    recipient_id,
                    len(elements),
                    exc,
                )
        return outbound.send_text(
            account,
            recipient_id,
            self._format_catalog_for_instagram(payload),
            conversation_id=conversation_id,
        )

    def _absolute_media_url(self, relative: str | None) -> str | None:
        if not relative:
            return None
        if relative.startswith(("http://", "https://")):
            return relative
        if relative.startswith("/"):
            base = (self.settings.frontend_url or "").rstrip("/")
            if base:
                return urljoin(base + "/", relative.lstrip("/"))
        return relative

    def send_product_photos(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        item: CatalogItem | InventoryItem,
    ) -> ProductPhotosSendResult:
        if isinstance(item, InventoryItem):
            from app.services.catalog.platform_provider import inventory_item_to_catalog

            catalog_item = inventory_item_to_catalog(item)
        else:
            catalog_item = item
        if catalog_item is None:
            return ProductPhotosSendResult(product_not_found=True)

        name = catalog_item.name
        image_urls = [self._absolute_media_url(url) or url for url in catalog_item.image_urls]
        image_urls = [url for url in image_urls if url]
        if not image_urls:
            steps = [
                CatalogDeliveryStep(
                    "text",
                    (
                        f"We don't have photos of {name} in our catalogue right now. "
                        "I can still confirm price and stock if you'd like to order."
                    ),
                ),
            ]
            _, messages_sent = self._deliver(account, conversation, steps)
            return ProductPhotosSendResult(
                no_images=True,
                product_name=name,
                outbound_delivered=messages_sent > 0,
            )

        steps: list[CatalogDeliveryStep] = [
            CatalogDeliveryStep("text", f"Here are photos of {name}:"),
        ]
        for url in image_urls:
            steps.append(CatalogDeliveryStep("image", url))

        _, messages_sent = self._deliver(account, conversation, steps)
        return ProductPhotosSendResult(
            photos_sent=True,
            image_count=len(image_urls),
            product_name=name,
            outbound_delivered=messages_sent > 0,
        )

    def _deliver(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
        steps: list[CatalogDeliveryStep],
    ) -> tuple[str, int]:
        recipient_id = str(conversation.participant_ig_id or "")
        if not recipient_id:
            logger.warning(
                "DM catalog skipped: missing participant_ig_id conversation=%s",
                conversation.id,
            )
            lines: list[str] = []
            for step in steps:
                if step.kind == "text":
                    lines.append(step.body)
                elif step.kind == "catalog":
                    lines.append(self._format_catalog_for_instagram(json.loads(step.body)))
                elif step.kind == "product":
                    payload = json.loads(step.body)
                    index_n = int(payload.get("index") or 0)
                    name = str(payload.get("name") or "Product")
                    price = int(payload.get("price") or 0)
                    lines.append(f"{index_n}. {name} — KES {price:,}.")
            return "\n".join(lines), 0

        outbound = InstagramOutboundService(self.settings, self.instagram_api, db=self.db)
        now = utc_now()
        stored_lines: list[str] = []
        step_index = 0

        for step in steps:
            sent_at = now + timedelta(milliseconds=step_index * 150)
            if step.kind == "image":
                try:
                    outbound_id = outbound.send_image(
                        account,
                        recipient_id,
                        step.body,
                        conversation_id=conversation.id,
                    )
                    stored_lines.append(f"[image] {step.body}")
                except Exception as exc:
                    logger.warning(
                        "DM catalog image send failed conversation=%s url=%s error=%s",
                        conversation.id,
                        step.body[:120],
                        exc,
                    )
                    step_index += 1
                    continue
            elif step.kind == "catalog":
                payload = json.loads(step.body)
                outbound_id = self._send_catalog_to_instagram(
                    outbound,
                    account,
                    recipient_id,
                    payload,
                    conversation_id=conversation.id,
                )
                stored_body = f"{PRODUCT_CATALOG_PREFIX}{step.body}"
                stored_lines.append(stored_body)
            elif step.kind == "product":
                payload = json.loads(step.body)
                index_n = int(payload.get("index") or 0)
                name = str(payload.get("name") or "Product")
                price = int(payload.get("price") or 0)
                ig_text = f"{index_n}. {name} — KES {price:,}."
                outbound_id = outbound.send_text(
                    account,
                    recipient_id,
                    ig_text,
                    conversation_id=conversation.id,
                )
                stored_body = f"{PRODUCT_CARD_PREFIX}{step.body}"
                stored_lines.append(stored_body)
            else:
                outbound_id = outbound.send_text(
                    account,
                    recipient_id,
                    step.body,
                    quick_replies=step.quick_replies,
                    conversation_id=conversation.id,
                )
                stored_lines.append(step.body)

            self.db.add(
                InstagramMessage(
                    instagram_conversation_id=conversation.id,
                    instagram_message_id=outbound_id,
                    direction="outbound",
                    sender_ig_id=account.instagram_user_id,
                    sender_username=account.username,
                    body=stored_lines[-1],
                    sent_at=sent_at,
                    auto_replied=False,
                    created_at=sent_at,
                    updated_at=sent_at,
                ),
            )
            step_index += 1

        combined = "\n\n".join(stored_lines)
        logger.info(
            "DM catalog delivered conversation=%s steps=%s items=%s",
            conversation.id,
            len(steps),
            sum(
                len(json.loads(step.body).get("items") or [])
                for step in steps
                if step.kind == "catalog"
            ),
        )
        return combined, step_index
