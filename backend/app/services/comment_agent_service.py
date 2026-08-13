"""LLM-powered replies to Instagram post comments."""

from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import InstagramAccount, InstagramCommentEvent
from app.services.agent_reply_policy import platform_bot_is_ai_agent
from app.services.bot_sandbox_context import should_fake_instagram_outbound
from app.services.ai_agent_config import effective_agent_settings
from app.services.ai_agent_config import effective_agent_settings
from app.services.comment_agent_tools import COMMENT_AGENT_TOOL_DEFINITIONS, CommentAgentTools
from app.services.comment_product_context import (
    detect_mentioned_products,
    linked_product_catalog,
)
from app.services.dm_agent_tools import resolve_shop_display_name
from app.services.dm_chat_provider import (
    ChatMessage,
    DmChatDisabled,
    DmChatError,
    chat_completion,
    chat_provider_available,
)
from app.services.platform_instagram import channel_auto_replies_active
from app.services.platform_messaging_settings import auto_responses_paused
from app.support.datetime_utils import utc_now

logger = logging.getLogger(__name__)

_MAX_REPLY_CHARS = 500


def build_comment_system_prompt(
    account: InstagramAccount,
    *,
    db: Session,
    post_id: str,
    linked_products: list[dict],
    mentioned_products: list[dict],
) -> str:
    shop_name = resolve_shop_display_name(account, db)
    linked_lines = []
    for index, product in enumerate(linked_products, start=1):
        category = product.get("category") or "uncategorised"
        linked_lines.append(
            f"{index}. {product['name']} — KES {product['price_kes']:,} ({category}) "
            f"[id={product['inventory_item_id']}]",
        )
    linked_block = "\n".join(linked_lines) if linked_lines else "(none linked — search the shop if needed)"

    mention_block = ""
    if mentioned_products:
        names = ", ".join(str(p.get("name") or "") for p in mentioned_products)
        mention_block = f"\nProducts likely referenced in the comment: {names}.\n"

    return (
        f"You are DukAI, the public comment assistant for {shop_name} on Instagram.\n"
        f"This comment is on post {post_id}.\n"
        f"Products linked to this post:\n{linked_block}\n"
        f"{mention_block}"
        "Rules:\n"
        "- Reply publicly under the customer's comment — keep it short (1-3 sentences).\n"
        "- Map casual wording in the comment to the correct linked product names and prices.\n"
        "- If several linked products could match (e.g. different sprays), list the options "
        "with names and prices and ask which one they mean.\n"
        "- Use tools to verify prices and stock — never invent product details.\n"
        "- Do not collect payment, phone numbers, or personal data in comments.\n"
        "- To buy, invite them to DM the shop (e.g. \"DM us to order\").\n"
        "- Be friendly and professional. English and Swahili are fine.\n"
        "- Skip spam, offensive, or empty comments — reply with a brief polite redirect or skip.\n"
        "- Do not mention tools or that you are an AI."
    )


class CommentAgentService:
    def __init__(self, db: Session, settings: Settings, instagram_api):
        self.db = db
        self.settings = settings
        self.instagram_api = instagram_api

    def _agent_settings(self) -> Settings:
        return effective_agent_settings(self.settings, self.db)

    def is_available(self) -> bool:
        agent = self._agent_settings()
        return (
            bool(agent.comment_agent_enabled)
            and bool(agent.dm_agent_enabled)
            and chat_provider_available(agent)
        )

    def process_inbound_comment(
        self,
        account: InstagramAccount,
        *,
        comment_id: str,
        post_id: str,
        commenter_id: str,
        commenter_username: str | None,
        text: str,
        parent_comment_id: str | None = None,
    ) -> bool:
        if not self.is_available():
            return False
        if not platform_bot_is_ai_agent(self.db):
            return False
        if auto_responses_paused(self.db):
            return False
        if not channel_auto_replies_active(self.db, account):
            return False
        if not getattr(account, "auto_replies_enabled", True):
            return False

        body = (text or "").strip()
        if not body or not comment_id or not post_id:
            return False

        my_id = str(account.instagram_user_id or "")
        if commenter_id and commenter_id == my_id:
            return False

        existing = (
            self.db.query(InstagramCommentEvent)
            .filter(InstagramCommentEvent.external_comment_id == comment_id)
            .first()
        )
        if existing is not None and existing.auto_replied:
            return False

        merchant_id = str(account.account_id or "").strip()
        if not merchant_id:
            return False

        linked_products = linked_product_catalog(
            self.db,
            merchant_account_id=merchant_id,
            post_id=post_id,
        )
        mentioned = detect_mentioned_products(body, linked_products)

        event = existing or InstagramCommentEvent(
            instagram_account_id=account.id,
            external_comment_id=comment_id,
            external_post_id=post_id,
            parent_comment_id=parent_comment_id,
            commenter_ig_id=commenter_id or None,
            commenter_username=commenter_username,
            body=body,
            auto_replied=False,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        if existing is None:
            self.db.add(event)
        else:
            event.body = body
            event.updated_at = utc_now()

        try:
            reply = self._generate_reply(
                account,
                post_id=post_id,
                comment_text=body,
                linked_products=linked_products,
                mentioned_products=mentioned,
                merchant_id=merchant_id,
            )
        except (DmChatDisabled, DmChatError) as exc:
            logger.warning("Comment agent unavailable comment=%s error=%s", comment_id, exc)
            self.db.commit()
            return False

        if not reply or not reply.strip():
            self.db.commit()
            return False

        reply = reply.strip()[:_MAX_REPLY_CHARS]
        reply_id = self._send_reply(account, comment_id, reply)
        event.reply_body = reply
        event.reply_comment_id = reply_id
        event.auto_replied = True
        event.updated_at = utc_now()
        self.db.commit()
        logger.info(
            "Comment agent replied comment=%s post=%s account=%s",
            comment_id,
            post_id,
            account.username,
        )
        return True

    def _generate_reply(
        self,
        account: InstagramAccount,
        *,
        post_id: str,
        comment_text: str,
        linked_products: list[dict],
        mentioned_products: list[dict],
        merchant_id: str,
    ) -> str:
        tools = CommentAgentTools(
            self.db,
            self.settings,
            self.instagram_api,
            merchant_account_id=merchant_id,
            post_id=post_id,
            comment_text=comment_text,
        )
        messages: list[ChatMessage] = [
            ChatMessage(
                role="system",
                content=build_comment_system_prompt(
                    account,
                    db=self.db,
                    post_id=post_id,
                    linked_products=linked_products,
                    mentioned_products=mentioned_products,
                ),
            ),
            ChatMessage(role="user", content=comment_text),
        ]
        max_rounds = max(1, int(self.settings.dm_agent_max_tool_rounds))
        agent = self._agent_settings()

        for _ in range(max_rounds):
            completion = chat_completion(agent, messages, COMMENT_AGENT_TOOL_DEFINITIONS)
            if completion.tool_calls:
                assistant_tool_calls = []
                for call in completion.tool_calls:
                    assistant_tool_calls.append(
                        {
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                "arguments": json.dumps(call.arguments),
                            },
                        },
                    )
                messages.append(
                    ChatMessage(
                        role="assistant",
                        content=completion.content or "",
                        tool_calls=assistant_tool_calls,
                    ),
                )
                for call in completion.tool_calls:
                    result = tools.execute(call.name, call.arguments)
                    messages.append(
                        ChatMessage(
                            role="tool",
                            name=call.name,
                            tool_call_id=call.id,
                            content=json.dumps(result),
                        ),
                    )
                continue

            if completion.content and completion.content.strip():
                return completion.content.strip()

        completion = chat_completion(agent, messages, [])
        if completion.content and completion.content.strip():
            return completion.content.strip()

        if mentioned_products:
            names = ", ".join(str(p.get("name") or "") for p in mentioned_products[:3])
            return (
                f"Thanks for your interest! We have {names} available. "
                "DM us and we'll help you order."
            )
        if linked_products:
            return (
                "Thanks for commenting! DM us with the product you'd like "
                "and we'll get your order started."
            )
        return "Thanks for reaching out! DM us anytime and we'll be happy to help."

    def _send_reply(self, account: InstagramAccount, comment_id: str, text: str) -> str | None:
        if should_fake_instagram_outbound(account, fake_messaging_setting=self.settings.instagram_fake_messaging):
            logger.info(
                "Comment reply (fake mode) account=%s comment=%s preview=%s",
                account.username,
                comment_id,
                text[:120],
            )
            return f"fake_reply_{comment_id}"

        token = account.access_token()
        response = self.instagram_api.reply_to_comment(comment_id, text, token)
        return str(response.get("id") or response.get("comment_id") or "")
