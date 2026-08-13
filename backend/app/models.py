from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _new_uuid() -> str:
    """Generate a UUIDv4 string for use as a primary key.

    36-character form with hyphens (``8-4-4-4-12``) so it's unambiguous
    when serialised into JSON / URLs and readable in logs.
    """
    return str(uuid.uuid4())


# Column lengths. UUIDv4 in canonical form is always exactly 36 chars.
# Pulled into a constant so a future migration to a different id scheme
# only needs to touch one place.
PK_LEN = 36


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    business_name: Mapped[str] = mapped_column(String(255))
    business_location: Mapped[str] = mapped_column(String(255))
    business_category: Mapped[str] = mapped_column(String(100))
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Merchant Station: online order acceptance + kitchen prep timing
    orders_paused: Mapped[bool] = mapped_column(Boolean, default=False)
    orders_paused_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    orders_paused_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    busy_extra_prep_minutes: Mapped[int] = mapped_column(Integer, default=0)
    default_prep_minutes: Mapped[int] = mapped_column(Integer, default=20)
    station_last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )
    station_heartbeat_required: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    users: Mapped[list[User]] = relationship(back_populates="account")
    memberships: Mapped[list[UserMembership]] = relationship(back_populates="account")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("accounts.id"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    # Optional username used by admin-style logins (super admins log in via
    # username instead of email). Kept nullable + unique so existing merchant
    # users — who authenticate by email — are unaffected.
    username: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    remember_token: Mapped[str | None] = mapped_column(String(100), nullable=True)
    facebook_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    onboarded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    user_role: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Comma-separated merchant dashboard section keys for ``staff`` users.
    # Ignored for ``system_admin`` (full access).
    allowed_sections: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_activated: Mapped[bool] = mapped_column(Boolean, default=False)
    require_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[Account | None] = relationship(back_populates="users")
    memberships: Mapped[list[UserMembership]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    instagram_account: Mapped[InstagramAccount | None] = relationship(
        back_populates="user",
        uselist=False,
    )

    def is_onboarded(self) -> bool:
        return self.onboarded_at is not None

    @staticmethod
    def normalize_role(value: str | None) -> str:
        """Normalize role labels for tolerant authorization checks.

        Accepts historical variants like ``superadmin`` or ``super-admin``
        by stripping separators and case.
        """
        if not value:
            return ""
        return (
            value.strip()
            .lower()
            .replace("_", "")
            .replace("-", "")
            .replace(" ", "")
        )

    def is_super_admin(self) -> bool:
        return self.normalize_role(self.user_role) == "superadmin"

    def is_system_admin(self) -> bool:
        return self.normalize_role(self.user_role) == "systemadmin"

    login_codes: Mapped[list[UserLoginCode]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class UserLoginCode(Base):
    """One-time login code for merchant dashboard sign-in."""

    __tablename__ = "user_login_codes"
    __table_args__ = (Index("user_login_codes_user_id_index", "user_id"),)

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    user_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("users.id"))
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship(back_populates="login_codes")


class UserMembership(Base):
    __tablename__ = "user_memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "account_id"),
        Index("ix_user_memberships_user_id", "user_id"),
        Index("ix_user_memberships_account_id", "account_id"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("users.id"),
        nullable=False,
    )
    account_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("accounts.id"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(255), default="staff")
    allowed_sections: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship(back_populates="memberships")
    account: Mapped[Account] = relationship(back_populates="memberships")


class InstagramAccount(Base):
    __tablename__ = "instagram_accounts"
    __table_args__ = (
        UniqueConstraint("account_id", "platform"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("accounts.id"),
        nullable=True,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("users.id"))
    platform: Mapped[str] = mapped_column(String(32), default="instagram", index=True)
    login_provider: Mapped[str] = mapped_column(String(255), default="instagram")
    instagram_user_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    instagram_scoped_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    instagram_webhook_ig_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    account_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    granted_permissions: Mapped[str | None] = mapped_column(Text, nullable=True)
    facebook_page_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    facebook_page_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    user_access_token: Mapped[str] = mapped_column(Text)
    page_access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    messages_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    onboarding_checks: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    onboarding_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_replies_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship(back_populates="instagram_account")
    account: Mapped[Account | None] = relationship()
    conversations: Mapped[list[InstagramConversation]] = relationship(
        back_populates="account",
        cascade="all, delete-orphan",
    )
    auto_reply_rules: Mapped[list[AutoReplyRule]] = relationship(
        back_populates="account",
        cascade="all, delete-orphan",
    )
    conversation_starters: Mapped[list[ConversationStarter]] = relationship(
        back_populates="account",
        cascade="all, delete-orphan",
    )

    def is_onboarded(self) -> bool:
        return bool(self.onboarding_complete)

    def has_instagram_business_account(self) -> bool:
        return bool(self.instagram_user_id and str(self.instagram_user_id).isdigit())

    def access_token(self) -> str:
        from app.core.laravel_crypto import maybe_decrypt

        return maybe_decrypt(self.user_access_token) or self.user_access_token


class InstagramConversation(Base):
    __tablename__ = "instagram_conversations"
    __table_args__ = (
        UniqueConstraint("instagram_account_id", "instagram_conversation_id"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    instagram_account_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("instagram_accounts.id"),
    )
    instagram_conversation_id: Mapped[str] = mapped_column(String(255))
    participant_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    participant_ig_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    participant_instagram_pk: Mapped[str | None] = mapped_column(String(64), nullable=True)
    participant_profile_pic_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sales_session: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    ticket_status: Mapped[str] = mapped_column(String(20), default="open")
    ticket_opened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    awaiting_customer_since: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    response_timeout_token: Mapped[str | None] = mapped_column(String(PK_LEN), nullable=True)
    ticket_closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    current_support_ticket_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("support_tickets.id"),
        nullable=True,
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[InstagramAccount] = relationship(back_populates="conversations")
    messages: Mapped[list[InstagramMessage]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
    )
    current_support_ticket: Mapped[SupportTicket | None] = relationship(
        foreign_keys=[current_support_ticket_id],
    )
    support_tickets: Mapped[list[SupportTicket]] = relationship(
        back_populates="conversation",
        foreign_keys="SupportTicket.instagram_conversation_id",
        cascade="all, delete-orphan",
    )

    def is_ticket_open(self) -> bool:
        return (self.ticket_status or "open").lower() != "closed"


class SupportTicket(Base):
    __tablename__ = "support_tickets"
    __table_args__ = (
        UniqueConstraint("instagram_account_id", "ticket_number"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    instagram_account_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("instagram_accounts.id"),
    )
    instagram_conversation_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("instagram_conversations.id"),
    )
    ticket_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="waiting_customer")
    resolution: Mapped[str | None] = mapped_column(String(32), nullable=True)
    close_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    participant_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    participant_ig_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    first_customer_reply_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    first_agent_reply_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_by_user_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("users.id"),
        nullable=True,
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    conversation: Mapped[InstagramConversation] = relationship(
        back_populates="support_tickets",
        foreign_keys=[instagram_conversation_id],
    )
    events: Mapped[list[TicketEvent]] = relationship(
        back_populates="ticket",
        cascade="all, delete-orphan",
        order_by="TicketEvent.created_at",
    )

    def is_open(self) -> bool:
        return self.status in {"open", "waiting_customer"}

    def display_number(self) -> str:
        return f"T-{self.ticket_number:04d}"


class TicketEvent(Base):
    __tablename__ = "ticket_events"

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    support_ticket_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("support_tickets.id"),
    )
    event_type: Mapped[str] = mapped_column(String(64))
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    actor_user_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("users.id"),
        nullable=True,
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    ticket: Mapped[SupportTicket] = relationship(back_populates="events")


class InstagramMessage(Base):
    __tablename__ = "instagram_messages"

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    instagram_conversation_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("instagram_conversations.id"),
    )
    instagram_message_id: Mapped[str] = mapped_column(String(255), unique=True)
    direction: Mapped[str] = mapped_column(String(255))
    sender_ig_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sender_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    delivery_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    delivery_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    outbound_transport: Mapped[str | None] = mapped_column(String(16), nullable=True)
    auto_replied: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    conversation: Mapped[InstagramConversation] = relationship(back_populates="messages")

    def is_inbound(self) -> bool:
        return self.direction == "inbound"


class ChannelCustomer(Base):
    """Customer profile saved after explicit consent (per shop + channel identity)."""

    __tablename__ = "channel_customers"
    __table_args__ = (UniqueConstraint("account_id", "platform", "external_id"),)

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("accounts.id"))
    platform: Mapped[str] = mapped_column(String(32))
    external_id: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    delivery_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    consent_status: Mapped[str] = mapped_column(String(20), default="none")
    consent_asked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    consent_given_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    def has_usable_profile(self) -> bool:
        return self.consent_status == "accepted" and bool(self.phone)


class AutoReplyRule(Base):
    __tablename__ = "auto_reply_rules"

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    instagram_account_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("instagram_accounts.id"),
    )
    name: Mapped[str] = mapped_column(String(255))
    match_type: Mapped[str] = mapped_column(String(255), default="contains")
    trigger_phrase: Mapped[str] = mapped_column(String(255))
    reply_text: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[InstagramAccount] = relationship(back_populates="auto_reply_rules")

    def matches(self, message_text: str) -> bool:
        haystack = message_text.strip().lower()
        needle = self.trigger_phrase.strip().lower()
        if self.match_type == "exact":
            return haystack == needle
        if self.match_type == "starts_with":
            return haystack.startswith(needle)
        return needle in haystack


class ConversationStarter(Base):
    __tablename__ = "conversation_starters"
    __table_args__ = (UniqueConstraint("instagram_account_id", "payload"),)

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    instagram_account_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("instagram_accounts.id"),
    )
    question: Mapped[str] = mapped_column(String(80))
    payload: Mapped[str] = mapped_column(String(100))
    reply_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[InstagramAccount] = relationship(back_populates="conversation_starters")


class MpesaConfiguration(Base):
    __tablename__ = "mpesa_configurations"

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    environment: Mapped[str] = mapped_column(String(20), default="sandbox")
    shortcode: Mapped[str] = mapped_column(String(20))
    shortcode_type: Mapped[str] = mapped_column(String(20), default="paybill")
    consumer_key: Mapped[str] = mapped_column(String(255))
    consumer_secret: Mapped[str] = mapped_column(Text)
    passkey: Mapped[str] = mapped_column(Text)
    callback_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    account_reference_prefix: Mapped[str] = mapped_column(String(50), default="PAY")
    b2b_initiator_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    b2b_security_credential: Mapped[str | None] = mapped_column(Text, nullable=True)
    b2b_auto_payout: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_test_result: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    def is_sandbox(self) -> bool:
        return self.environment.lower() != "production"

    def base_url(self) -> str:
        return (
            "https://sandbox.safaricom.co.ke"
            if self.is_sandbox()
            else "https://api.safaricom.co.ke"
        )

    def transaction_type(self) -> str:
        return (
            "CustomerBuyGoodsOnline"
            if self.shortcode_type.lower() in {"till", "buygoods", "buy_goods"}
            else "CustomerPayBillOnline"
        )


class PlatformMessagingSettings(Base):
    """Platform-wide DM/ticket behaviour (managed by super admins)."""

    __tablename__ = "platform_messaging_settings"

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    wait_dm_time_seconds: Mapped[int] = mapped_column(Integer, default=10)
    pause_auto_responses: Mapped[bool] = mapped_column(Boolean, default=False)
    runtime_mode: Mapped[str] = mapped_column(String(20), default="dev")
    dm_bot: Mapped[str] = mapped_column(String(32), default="ai_agent")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class GoogleMapsConfiguration(Base):
    """Platform-wide Google Maps settings (managed by super admins).

    The ``api_key`` is a browser-restricted Google Maps API key and is safe to
    expose to the client; it powers interactive location pickers across the
    platform. Optional defaults seed the map's starting view.
    """

    __tablename__ = "google_maps_configurations"

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    api_key: Mapped[str] = mapped_column(Text)
    default_center_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    default_center_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    default_zoom: Mapped[float | None] = mapped_column(Float, nullable=True)
    default_country: Mapped[str | None] = mapped_column(String(10), nullable=True)
    delivery_fee_per_km: Mapped[Any | None] = mapped_column(Numeric(12, 2), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AiAgentConfiguration(Base):
    """Platform-wide OpenAI (ChatGPT) settings for the DM and comment AI agents."""

    __tablename__ = "ai_agent_configurations"

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    api_key: Mapped[str] = mapped_column(Text)
    chat_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MapboxConfiguration(Base):
    """Legacy Mapbox settings — superseded by GoogleMapsConfiguration."""

    __tablename__ = "mapbox_configurations"

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    access_token: Mapped[str] = mapped_column(Text)
    map_style: Mapped[str] = mapped_column(
        String(255),
        default="mapbox://styles/mapbox/streets-v12",
    )
    default_center_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    default_center_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    default_zoom: Mapped[float | None] = mapped_column(Float, nullable=True)
    default_country: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MerchantMpesaProfile(Base):
    __tablename__ = "merchant_mpesa_profiles"
    __table_args__ = (
        UniqueConstraint("account_id"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("accounts.id"))
    shortcode: Mapped[str] = mapped_column(String(20))
    shortcode_type: Mapped[str] = mapped_column(String(20), default="paybill")
    account_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    updated_by_user_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("users.id"),
        nullable=True,
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MerchantKraProfile(Base):
    __tablename__ = "merchant_kra_profiles"
    __table_args__ = (
        UniqueConstraint("account_id"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("accounts.id"))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    kra_pin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    integration_type: Mapped[str] = mapped_column(String(20), default="vscu")
    control_unit_serial: Mapped[str | None] = mapped_column(String(50), nullable=True)
    branch_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    vat_registered: Mapped[bool] = mapped_column(Boolean, default=True)
    middleware_provider: Mapped[str | None] = mapped_column(String(100), nullable=True)
    updated_by_user_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("users.id"),
        nullable=True,
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MpesaTransaction(Base):
    __tablename__ = "mpesa_transactions"

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    initiated_by_user_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("users.id"),
        nullable=True,
    )
    phone_number: Mapped[str] = mapped_column(String(20))
    amount: Mapped[int] = mapped_column(Integer)
    account_reference: Mapped[str] = mapped_column(String(100))
    transaction_desc: Mapped[str] = mapped_column(String(200))
    merchant_request_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    checkout_request_id: Mapped[str | None] = mapped_column(
        String(100),
        unique=True,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(30), default="pending")
    result_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_desc: Mapped[str | None] = mapped_column(String(500), nullable=True)
    mpesa_receipt_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    callback_payload: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    account_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("accounts.id"),
        nullable=True,
    )
    payout_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    payout_shortcode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    payout_shortcode_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    payout_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payout_originator_conversation_id: Mapped[str | None] = mapped_column(
        String(100),
        unique=True,
        nullable=True,
    )
    payout_result_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payout_result_desc: Mapped[str | None] = mapped_column(String(500), nullable=True)
    payout_receipt_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    payout_callback_payload: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    payout_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    order_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("orders.id"),
        nullable=True,
    )
    booking_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("bookings.id"),
        nullable=True,
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    initiated_by: Mapped[User | None] = relationship()
    order: Mapped[Order | None] = relationship(
        back_populates="mpesa_transactions",
        foreign_keys=[order_id],
    )


class MpesaHubBalanceQuery(Base):
    """Latest Daraja Account Balance queries for the DukAI hub Paybill."""

    __tablename__ = "mpesa_hub_balance_queries"
    __table_args__ = (
        Index(
            "mpesa_hub_balance_originator_unique",
            "originator_conversation_id",
            unique=True,
        ),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    shortcode: Mapped[str] = mapped_column(String(20))
    originator_conversation_id: Mapped[str] = mapped_column(String(100))
    conversation_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="pending")
    result_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_desc: Mapped[str | None] = mapped_column(String(500), nullable=True)
    balances_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    working_balance: Mapped[str | None] = mapped_column(String(50), nullable=True)
    utility_balance: Mapped[str | None] = mapped_column(String(50), nullable=True)
    charges_balance: Mapped[str | None] = mapped_column(String(50), nullable=True)
    callback_payload: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    requested_by_user_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("users.id"),
        nullable=True,
    )
    requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Product(Base):
    """Shared catalog product (or service) visible to every shop.

    Holds everything that's universal about an item: name, brand, category,
    photo, manufacturer SKU, and a JSON `attributes` blob for category-specific
    structured info (size/color/dosage/duration/etc.).
    """

    __tablename__ = "products"
    __table_args__ = (
        Index("products_slug_index", "slug"),
        Index("products_product_type_index", "product_type"),
        Index("products_name_index", "name"),
        Index("products_product_code_unique", "product_code", unique=True),
        Index("products_sku_index", "sku"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    product_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sku: Mapped[str | None] = mapped_column(String(120), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(255))
    product_type: Mapped[str] = mapped_column(String(20), default="product")
    category: Mapped[str | None] = mapped_column(String(255), nullable=True)
    brand: Mapped[str | None] = mapped_column(String(255), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    primary_image_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    images: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    attributes: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    created_by_account_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("accounts.id"),
        nullable=True,
    )
    created_by_user_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("users.id"),
        nullable=True,
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    inventory_items: Mapped[list[InventoryItem]] = relationship(back_populates="product")

    def is_service(self) -> bool:
        return self.product_type == "service"


class InventoryItem(Base):
    """Per-shop pricing + stock for a catalog product."""

    __tablename__ = "inventory_items"
    __table_args__ = (
        UniqueConstraint("account_id", "product_id"),
        Index("inventory_items_account_id_is_active_index", "account_id", "is_active"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("accounts.id"))
    product_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("products.id"))
    buying_price: Mapped[Any | None] = mapped_column(Numeric(12, 2), nullable=True)
    selling_price: Mapped[Any | None] = mapped_column(Numeric(12, 2), nullable=True)
    stock_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    low_stock_threshold: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    media: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[Account] = relationship()
    product: Mapped[Product] = relationship(back_populates="inventory_items")

    def is_low_stock(self) -> bool:
        if self.stock_quantity is None or self.low_stock_threshold is None:
            return False
        return self.stock_quantity <= self.low_stock_threshold

    def margin(self) -> float | None:
        if self.selling_price is None or self.buying_price is None:
            return None
        try:
            return float(self.selling_price) - float(self.buying_price)
        except (TypeError, ValueError):
            return None


class Order(Base):
    """A customer order placed through any channel.

    See ``app.support.order_status`` for the lifecycle state machine.
    Money is stored in the order's ``currency`` (KES by default) using
    ``DECIMAL(12, 2)`` — enough headroom for any realistic single order.
    """

    __tablename__ = "orders"
    __table_args__ = (
        Index("orders_order_number_unique", "order_number", unique=True),
        Index("orders_account_id_status_index", "account_id", "status"),
        Index("orders_account_id_source_index", "account_id", "source"),
        Index(
            "orders_account_id_fulfillment_type_index",
            "account_id",
            "fulfillment_type",
        ),
        Index("orders_account_id_created_at_index", "account_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("accounts.id"))
    order_number: Mapped[str] = mapped_column(String(32))

    source: Mapped[str] = mapped_column(String(20))
    fulfillment_type: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(32), default="placed")

    source_conversation_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("instagram_conversations.id"),
        nullable=True,
    )

    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    customer_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    delivery_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    delivery_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    subtotal: Mapped[Any] = mapped_column(Numeric(12, 2), default=0)
    delivery_fee: Mapped[Any] = mapped_column(Numeric(12, 2), default=0)
    discount: Mapped[Any] = mapped_column(Numeric(12, 2), default=0)
    total: Mapped[Any] = mapped_column(Numeric(12, 2), default=0)
    currency: Mapped[str] = mapped_column(String(8), default="KES")

    payment_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    mpesa_transaction_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("mpesa_transactions.id"),
        nullable=True,
    )

    placed_by_user_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("users.id"),
        nullable=True,
    )

    placed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    prepared_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ready_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    stock_deducted: Mapped[bool] = mapped_column(Boolean, default=False)
    merchant_delivery_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    customer_delivery_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completion_reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    delivery_disputed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    assigned_rider_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("riders.id"),
        nullable=True,
    )
    rider_assigned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rider_dispatched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rider_trip_phase: Mapped[str | None] = mapped_column(String(32), nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    prep_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_customer_status_notified: Mapped[str | None] = mapped_column(String(64), nullable=True)
    external_order_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    external_sync_status: Mapped[str | None] = mapped_column(String(32), nullable=True)

    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[Account] = relationship()
    assigned_rider: Mapped[Rider | None] = relationship(foreign_keys=[assigned_rider_id])
    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="OrderItem.id.asc()",
    )
    status_history: Mapped[list[OrderStatusHistory]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="OrderStatusHistory.created_at.asc()",
    )
    placed_by: Mapped[User | None] = relationship()
    mpesa_transaction: Mapped[MpesaTransaction | None] = relationship(
        foreign_keys=[mpesa_transaction_id],
    )
    mpesa_transactions: Mapped[list[MpesaTransaction]] = relationship(
        back_populates="order",
        foreign_keys="MpesaTransaction.order_id",
        order_by="MpesaTransaction.created_at.desc()",
    )


class OrderItem(Base):
    """A single line on an order.

    The ``inventory_item_id`` / ``product_id`` columns are nullable so an
    order remains intact if a product is later deleted; the snapshotted
    ``product_name`` / ``product_sku`` keep the receipt readable forever.
    """

    __tablename__ = "order_items"
    __table_args__ = (Index("order_items_order_id_index", "order_id"),)

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    order_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("orders.id"))
    inventory_item_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("inventory_items.id"),
        nullable=True,
    )
    product_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("products.id"),
        nullable=True,
    )
    product_name: Mapped[str] = mapped_column(String(255))
    product_sku: Mapped[str | None] = mapped_column(String(120), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Any] = mapped_column(Numeric(12, 2))
    line_total: Mapped[Any] = mapped_column(Numeric(12, 2))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    order: Mapped[Order] = relationship(back_populates="items")
    inventory_item: Mapped[InventoryItem | None] = relationship()
    product: Mapped[Product | None] = relationship()


class OrderStatusHistory(Base):
    """Append-only audit log of every status change on an order."""

    __tablename__ = "order_status_history"
    __table_args__ = (
        Index(
            "order_status_history_order_id_created_at_index",
            "order_id",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    order_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("orders.id"))
    from_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str] = mapped_column(String(32))
    changed_by_user_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("users.id"),
        nullable=True,
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    order: Mapped[Order] = relationship(back_populates="status_history")
    changed_by: Mapped[User | None] = relationship()


class DataDeletionRequest(Base):
    __tablename__ = "data_deletion_requests"

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    confirmation_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    meta_user_id: Mapped[str] = mapped_column(String(255), index=True)
    instagram_account_ids: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    source: Mapped[str] = mapped_column(String(64), default="meta_callback")
    status: Mapped[str] = mapped_column(String(32), default="completed")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class WebhookEvent(Base):
    __tablename__ = "webhook_events"

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    received_at: Mapped[datetime] = mapped_column(DateTime)
    signature_valid: Mapped[bool] = mapped_column(Boolean, default=False)
    signature_secret: Mapped[str | None] = mapped_column(String(255), nullable=True)
    http_status: Mapped[int] = mapped_column(Integer, default=200)
    object: Mapped[str | None] = mapped_column(String(255), nullable=True)
    event_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sender_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    recipient_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    preview: Mapped[str | None] = mapped_column(String(500), nullable=True)
    payload: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    processing_result: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MerchantNotification(Base):
    __tablename__ = "merchant_notifications"
    __table_args__ = (
        UniqueConstraint("account_id", "dedupe_key", name="uq_merchant_notifications_dedupe"),
        Index("ix_merchant_notifications_account_unread", "account_id", "read_at", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("accounts.id"),
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str | None] = mapped_column(String(500), nullable=True)
    entity_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(PK_LEN), nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[Account] = relationship()


class SocialPostLink(Base):
    """Maps an external social post to one of the merchant's inventory items."""

    __tablename__ = "social_post_links"
    __table_args__ = (
        UniqueConstraint(
            "account_id",
            "platform",
            "external_post_id",
            "inventory_item_id",
        ),
        Index("ix_social_post_links_inventory_item_id", "inventory_item_id"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("accounts.id"),
        index=True,
    )
    platform: Mapped[str] = mapped_column(String(32), index=True)
    external_post_id: Mapped[str] = mapped_column(String(255))
    inventory_item_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("inventory_items.id"),
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[Account] = relationship()
    inventory_item: Mapped[InventoryItem] = relationship()


class InstagramCommentEvent(Base):
    """Inbound Instagram post comment processed by the comment AI agent."""

    __tablename__ = "instagram_comment_events"
    __table_args__ = (
        UniqueConstraint("external_comment_id"),
        Index("ix_instagram_comment_events_post", "external_post_id"),
        Index("ix_instagram_comment_events_account", "instagram_account_id"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    instagram_account_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("instagram_accounts.id"),
    )
    external_comment_id: Mapped[str] = mapped_column(String(255))
    external_post_id: Mapped[str] = mapped_column(String(255))
    parent_comment_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    commenter_ig_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    commenter_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    reply_comment_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reply_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    auto_replied: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[InstagramAccount] = relationship()


class InstagramBetaEvent(Base):
    """Audit trail for Instagram Beta connect, 2FA, session, and outbound events."""

    __tablename__ = "instagram_beta_events"
    __table_args__ = (
        Index("ix_instagram_beta_events_account_created", "account_id", "created_at"),
        Index("ix_instagram_beta_events_type_status", "event_type", "status"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("accounts.id"), index=True)
    instagram_account_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("instagram_accounts.id"),
        nullable=True,
    )
    instagram_beta_account_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("instagram_accounts.id"),
        nullable=True,
    )
    event_type: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32))
    instagram_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    metadata_json: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Rider(Base):
    """Delivery rider in a merchant's private fleet."""

    __tablename__ = "riders"
    __table_args__ = (
        Index("riders_account_id_status_index", "account_id", "status"),
        Index("riders_account_id_phone_index", "account_id", "phone"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("accounts.id"))
    name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="invited")
    user_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("users.id"),
        nullable=True,
    )
    vehicle_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    invited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    account: Mapped[Account] = relationship()
    user: Mapped[User | None] = relationship()
    invites: Mapped[list[RiderInvite]] = relationship(
        back_populates="rider",
        cascade="all, delete-orphan",
    )

    def is_active(self) -> bool:
        return (self.status or "") == "active"


class RiderInvite(Base):
    __tablename__ = "rider_invites"
    __table_args__ = (
        UniqueConstraint("token_jti"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    rider_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("riders.id"))
    token_jti: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    rider: Mapped[Rider] = relationship(back_populates="invites")


class DeliveryOffer(Base):
    """Timed offer of a ready order to an online fleet rider."""

    __tablename__ = "delivery_offers"
    __table_args__ = (
        Index("delivery_offers_rider_status_index", "rider_id", "status"),
        Index("delivery_offers_order_status_index", "order_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("accounts.id"))
    order_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("orders.id"))
    rider_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("riders.id"))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    order: Mapped[Order] = relationship()
    rider: Mapped[Rider] = relationship()


class RiderLoginCode(Base):
    """One-time login code for returning onboarded riders."""

    __tablename__ = "rider_login_codes"
    __table_args__ = (Index("rider_login_codes_rider_id_index", "rider_id"),)

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    rider_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("riders.id"))
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    rider: Mapped[Rider] = relationship()


class MerchantApiKey(Base):
    """Hashed merchant API key for Postman / external integrations.

    The raw secret is shown once at creation time and never stored. Auth
    accepts ``Authorization: Bearer duk_…`` or ``X-Api-Key: duk_…``.
    """

    __tablename__ = "merchant_api_keys"
    __table_args__ = (
        Index("merchant_api_keys_key_hash_unique", "key_hash", unique=True),
        Index("merchant_api_keys_account_id_index", "account_id"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("accounts.id"))
    name: Mapped[str] = mapped_column(String(120))
    key_prefix: Mapped[str] = mapped_column(String(16))
    key_hash: Mapped[str] = mapped_column(String(64))
    scopes: Mapped[str] = mapped_column(String(255), default="orders:create")
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("users.id"),
        nullable=True,
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PushSubscription(Base):
    """Web Push subscription for merchant phone companion alerts."""

    __tablename__ = "push_subscriptions"
    __table_args__ = (UniqueConstraint("endpoint_hash"),)

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("accounts.id"))
    user_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("users.id"))
    endpoint: Mapped[str] = mapped_column(Text)
    endpoint_hash: Mapped[str] = mapped_column(String(64))
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# --- Booking / salon appointments ------------------------------------------

# Kept for booking_service / DB compat; DukAI Merchants does not register these.
SERVICE_BUSINESS_CATEGORIES = frozenset(
    {
        "Salon & Beauty",
        "Clinic & Wellness",
        "Restaurant & Food",
        "Cleaning & Home",
    }
)

RETAIL_BUSINESS_CATEGORIES = frozenset(
    {
        "Fashion & Apparel",
        "Beauty & Cosmetics",
        "Electronics",
        "Home & Living",
        "Health & Wellness",
        "Other",
    }
)


class BookingSettings(Base):
    """Per-shop public booking page + deposit / go-live config."""

    __tablename__ = "booking_settings"
    __table_args__ = (Index("booking_settings_slug_unique", "booking_slug", unique=True),)

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("accounts.id"),
        unique=True,
    )
    booking_slug: Mapped[str | None] = mapped_column(String(80), nullable=True)
    header_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    brand_color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    deposit_type: Mapped[str] = mapped_column(String(20), default="none")
    deposit_amount: Mapped[Any | None] = mapped_column(Numeric(12, 2), nullable=True)
    deposit_percent: Mapped[Any | None] = mapped_column(Numeric(5, 2), nullable=True)
    min_notice_minutes: Mapped[int] = mapped_column(Integer, default=60)
    timezone: Mapped[str] = mapped_column(String(64), default="Africa/Nairobi")
    go_live: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class BookingProvider(Base):
    """Bookable staff/provider for a service business (not dashboard login users)."""

    __tablename__ = "booking_providers"
    __table_args__ = (
        Index("booking_providers_account_active", "account_id", "is_active"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("accounts.id"))
    display_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str | None] = mapped_column(String(120), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class BookingProviderService(Base):
    __tablename__ = "booking_provider_services"
    __table_args__ = (
        UniqueConstraint("provider_id", "inventory_item_id"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    provider_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("booking_providers.id"),
    )
    inventory_item_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("inventory_items.id"),
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class BookingWeeklyHours(Base):
    __tablename__ = "booking_weekly_hours"
    __table_args__ = (
        Index(
            "booking_weekly_hours_scope",
            "account_id",
            "provider_id",
            "weekday",
        ),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("accounts.id"))
    provider_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("booking_providers.id"),
        nullable=True,
    )
    weekday: Mapped[int] = mapped_column(Integer)  # 0=Mon .. 6=Sun
    open_time: Mapped[str] = mapped_column(String(5), default="09:00")
    close_time: Mapped[str] = mapped_column(String(5), default="17:00")
    is_closed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (
        Index("bookings_account_starts", "account_id", "starts_at"),
        Index("bookings_public_token_unique", "public_token", unique=True),
        Index("bookings_provider_starts", "provider_id", "starts_at"),
    )

    id: Mapped[str] = mapped_column(String(PK_LEN), primary_key=True, default=_new_uuid)
    account_id: Mapped[str] = mapped_column(String(PK_LEN), ForeignKey("accounts.id"))
    provider_id: Mapped[str | None] = mapped_column(
        String(PK_LEN),
        ForeignKey("booking_providers.id"),
        nullable=True,
    )
    inventory_item_id: Mapped[str] = mapped_column(
        String(PK_LEN),
        ForeignKey("inventory_items.id"),
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime)
    ends_at: Mapped[datetime] = mapped_column(DateTime)
    customer_name: Mapped[str] = mapped_column(String(255))
    customer_phone: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="confirmed")
    deposit_amount: Mapped[Any | None] = mapped_column(Numeric(12, 2), nullable=True)
    deposit_mpesa_txn_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    public_token: Mapped[str] = mapped_column(String(PK_LEN), default=_new_uuid)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
