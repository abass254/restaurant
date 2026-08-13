from __future__ import annotations

import re
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import ChannelCustomer, InstagramAccount, InstagramConversation
from app.services import mpesa_service
from app.support.sales_session import CONSENT_ACCEPTED, CONSENT_DECLINED, CONSENT_PENDING

PHONE_RE = re.compile(r"(?:\+?254|0)?[71]\d{8}")
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
CONSENT_YES_RE = re.compile(
    r"^(yes|y|yeah|yep|ok|okay|sure|agree|accept|1|ndio|sawa)\b",
    re.IGNORECASE,
)
CONSENT_NO_RE = re.compile(
    r"^(no|n|nope|decline|don't|dont|2|hapana)\b",
    re.IGNORECASE,
)


class CustomerProfileService:
    def __init__(self, db: Session):
        self.db = db

    def get_profile(
        self,
        account_id: str,
        platform: str,
        external_id: str,
    ) -> ChannelCustomer | None:
        if not account_id or not external_id:
            return None
        return (
            self.db.query(ChannelCustomer)
            .filter(
                ChannelCustomer.account_id == account_id,
                ChannelCustomer.platform == platform,
                ChannelCustomer.external_id == external_id,
            )
            .first()
        )

    def get_or_create(
        self,
        account_id: str,
        platform: str,
        external_id: str,
    ) -> ChannelCustomer:
        existing = self.get_profile(account_id, platform, external_id)
        if existing:
            return existing
        now = datetime.utcnow()
        row = ChannelCustomer(
            account_id=account_id,
            platform=platform,
            external_id=external_id,
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        self.db.flush()
        return row

    def extract_phone(self, text: str) -> str | None:
        match = PHONE_RE.search(text)
        if not match:
            return None
        return mpesa_service.normalize_msisdn(match.group(0))

    def extract_email(self, text: str) -> str | None:
        match = EMAIL_RE.search(text)
        return match.group(0).strip().lower() if match else None

    def merge_from_message(
        self,
        customer: ChannelCustomer,
        text: str,
        *,
        display_name: str | None = None,
    ) -> dict[str, str]:
        """Return fields newly detected in ``text`` (not yet persisted)."""
        found: dict[str, str] = {}
        phone = self.extract_phone(text)
        if phone:
            found["phone"] = phone
        email = self.extract_email(text)
        if email:
            found["email"] = email
        if display_name and not customer.display_name:
            found["display_name"] = display_name.strip()
        # Simple delivery hint: line starting with deliver/address
        lowered = text.lower()
        if any(kw in lowered for kw in ("deliver to", "delivery address", "my address is")):
            for prefix in ("deliver to", "delivery address", "my address is"):
                if prefix in lowered:
                    idx = lowered.index(prefix) + len(prefix)
                    address = text[idx:].strip(" :,-")
                    if len(address) >= 8:
                        found["delivery_address"] = address[:500]
                    break
        return found

    def apply_pending_fields(
        self,
        customer: ChannelCustomer,
        fields: dict[str, str],
    ) -> None:
        now = datetime.utcnow()
        if "phone" in fields:
            customer.phone = fields["phone"]
        if "email" in fields:
            customer.email = fields["email"]
        if "display_name" in fields:
            customer.display_name = fields["display_name"]
        if "delivery_address" in fields:
            customer.delivery_address = fields["delivery_address"]
        customer.updated_at = now

    def needs_consent_prompt(self, customer: ChannelCustomer, fields: dict[str, str]) -> bool:
        if customer.consent_status == CONSENT_ACCEPTED:
            return False
        if customer.consent_status == CONSENT_DECLINED:
            return False
        if not fields:
            return False
        return True

    def ask_consent_message(self, custom_prompt: str | None = None) -> str:
        if custom_prompt and custom_prompt.strip():
            return custom_prompt.strip()
        return (
            "Before we continue — may we save your name, phone, and delivery details "
            "for faster checkout next time?\n\n"
            "Reply **YES** to agree, or **NO** to skip (we won't store your details)."
        )

    def parse_consent_reply(self, text: str) -> str | None:
        stripped = (text or "").strip()
        if CONSENT_YES_RE.match(stripped):
            return CONSENT_ACCEPTED
        if CONSENT_NO_RE.match(stripped):
            return CONSENT_DECLINED
        return None

    def record_consent(self, customer: ChannelCustomer, accepted: bool) -> None:
        now = datetime.utcnow()
        customer.consent_status = CONSENT_ACCEPTED if accepted else CONSENT_DECLINED
        customer.consent_asked_at = customer.consent_asked_at or now
        customer.consent_given_at = now if accepted else None
        customer.updated_at = now

    def mark_consent_asked(self, customer: ChannelCustomer) -> None:
        if customer.consent_status == "none":
            customer.consent_status = CONSENT_PENDING
        customer.consent_asked_at = datetime.utcnow()
        customer.updated_at = datetime.utcnow()

    def welcome_back_message(self, customer: ChannelCustomer) -> str | None:
        if not customer.has_usable_profile():
            return None
        name = customer.display_name or "there"
        phone_tail = (customer.phone or "")[-4:]
        return (
            f"Welcome back, {name}! We have your details on file "
            f"(phone ending {phone_tail}).\n"
            "Tell us what you'd like to order, or reply **TRACK** to follow an active order."
        )

    def apply_to_order(self, customer: ChannelCustomer, order) -> None:
        if customer.consent_status != CONSENT_ACCEPTED:
            return
        if customer.display_name and not order.customer_name:
            order.customer_name = customer.display_name
        if customer.phone and not order.customer_phone:
            order.customer_phone = customer.phone
        if customer.email and not order.customer_email:
            order.customer_email = customer.email
        if customer.delivery_address and not order.delivery_address:
            order.delivery_address = customer.delivery_address

    def identity(
        self,
        account: InstagramAccount,
        conversation: InstagramConversation,
    ) -> tuple[str, str, str]:
        """Return (merchant_account_id, platform, external_id)."""
        account_id = str(account.account_id or "")
        if not account_id:
            from app.models import InventoryItem

            row = (
                self.db.query(InventoryItem.account_id)
                .filter(InventoryItem.is_active.is_(True))
                .first()
            )
            account_id = str(row[0]) if row else ""
        external_id = str(conversation.participant_ig_id or "")
        platform = account.platform or "instagram"
        return account_id, platform, external_id
