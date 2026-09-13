from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from pydantic import BaseModel, ConfigDict


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    business_name: str
    business_location: str
    business_category: str
    logo_url: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class MembershipOut(BaseModel):
    id: str
    account_id: str
    account: AccountOut
    role: str
    allowed_sections: list[str] = []
    is_active: bool = True


class InstagramAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str | None
    name: str | None
    account_type: str | None
    instagram_user_id: str | None
    onboarding_complete: bool
    auto_replies_enabled: bool = True
    onboarding_checks: Any | None = None
    granted_permissions: str | None = None

    @classmethod
    def from_model(cls, account) -> InstagramAccountOut:
        return cls(
            id=account.id,
            username=account.username,
            name=account.name,
            account_type=account.account_type,
            instagram_user_id=account.instagram_user_id,
            onboarding_complete=account.is_onboarded(),
            auto_replies_enabled=bool(getattr(account, "auto_replies_enabled", True)),
            onboarding_checks=account.onboarding_checks,
            granted_permissions=account.granted_permissions,
        )


def build_user_out(db: Session, user) -> "UserOut":
    from app.services.platform_instagram import get_merchant_instagram_account
    from app.support.merchant_permissions import active_account_id

    ig = None
    try:
        account_id = active_account_id(user)
    except Exception:
        account_id = None
    if account_id:
        ig = get_merchant_instagram_account(db, str(account_id))
    return UserOut.from_model(user, instagram_account=ig)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    email: str | None
    username: str | None = None
    onboarded: bool
    user_role: str | None
    allowed_sections: list[str] = []
    is_activated: bool
    require_change_password: bool
    phone: str | None
    created_at: datetime | None = None
    account: AccountOut | None = None
    active_account: AccountOut | None = None
    memberships: list[MembershipOut] = []
    instagram_account: InstagramAccountOut | None = None

    @classmethod
    def from_model(cls, user, instagram_account=None) -> UserOut:
        from app.support.merchant_permissions import (
            get_active_membership,
            get_memberships,
            parse_allowed_sections,
            user_allowed_sections,
        )

        ig = instagram_account if instagram_account is not None else user.instagram_account
        memberships = get_memberships(user)
        active_membership = get_active_membership(user)
        active_account = active_membership.account if active_membership else user.account
        return cls(
            id=user.id,
            name=user.name,
            email=user.email,
            username=getattr(user, "username", None),
            onboarded=user.is_onboarded(),
            user_role=user.user_role,
            allowed_sections=user_allowed_sections(user),
            is_activated=bool(user.is_activated),
            require_change_password=bool(user.require_change_password),
            phone=user.phone,
            created_at=user.created_at,
            account=AccountOut.model_validate(user.account) if user.account else None,
            active_account=AccountOut.model_validate(active_account) if active_account else None,
            memberships=[
                MembershipOut(
                    id=membership.id,
                    account_id=membership.account_id,
                    account=AccountOut.model_validate(membership.account),
                    role=membership.role,
                    allowed_sections=parse_allowed_sections(membership.allowed_sections),
                    is_active=bool(membership.is_active),
                )
                for membership in memberships
                if membership.account is not None
            ],
            instagram_account=InstagramAccountOut.from_model(ig) if ig else None,
        )


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    instagram_message_id: str
    direction: str
    sender_ig_id: str | None
    sender_username: str | None
    body: str | None
    sent_at: datetime | None
    auto_replied: bool


class SupportTicketEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_type: str
    body: str | None = None
    actor_user_id: str | None = None
    created_at: datetime | None = None


class SupportTicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    ticket_number: int
    display_number: str
    status: str
    resolution: str | None = None
    close_reason: str | None = None
    opened_at: datetime | None = None
    closed_at: datetime | None = None
    first_customer_reply_at: datetime | None = None
    first_agent_reply_at: datetime | None = None
    resolved_at: datetime | None = None
    duration_seconds: int | None = None
    events: list[SupportTicketEventOut] | None = None


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    platform: str = "instagram"
    instagram_conversation_id: str
    participant_username: str | None
    participant_ig_id: str | None
    participant_profile_pic_url: str | None = None
    last_message_at: datetime | None
    last_read_at: datetime | None = None
    unread_count: int = 0
    is_unread: bool = False
    ticket_status: str = "open"
    ticket_opened_at: datetime | None = None
    ticket_closed_at: datetime | None = None
    active_ticket: SupportTicketOut | None = None
    participant_is_typing: bool = False
    agent_is_typing: bool = False
    messages_count: int | None = None
    latest_message: MessageOut | None = None
    messages: list[MessageOut] | None = None
    live_agent_handoff: bool = False
    agent_reply_allowed: bool = True


class AutoReplyRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    match_type: str
    trigger_phrase: str
    reply_text: str
    priority: int
    is_active: bool


class ConversationStarterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    question: str
    payload: str
    reply_text: str | None
    sort_order: int
    is_active: bool


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    product_code: str | None
    sku: str | None
    name: str
    slug: str
    product_type: str
    category: str | None
    brand: str | None
    unit: str | None
    description: str | None
    image_url: str | None
    primary_image_locked: bool = False
    attributes: Any | None = None
    created_by_account_id: str | None
    created_by_user_id: str | None
    shops_carrying_count: int | None = None
    created_at: datetime | None
    updated_at: datetime | None


class InventoryItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    account_id: str
    product_id: str
    buying_price: float | None
    selling_price: float | None
    margin: float | None
    stock_quantity: int | None
    low_stock_threshold: int | None
    inventory_role: str = "both"
    is_active: bool
    is_low_stock: bool
    supplier: str | None = None
    location: str | None = None
    notes: str | None
    attributes: Any | None = None
    media: list[dict[str, Any]] | None = None
    product: ProductOut | None = None
    created_at: datetime | None
    updated_at: datetime | None

    @classmethod
    def from_model(cls, item) -> "InventoryItemOut":
        from app.services.product_media_service import inventory_media_for_item

        role = "both"
        if hasattr(item, "normalized_role"):
            role = item.normalized_role()
        elif getattr(item, "inventory_role", None):
            role = str(item.inventory_role).strip().lower() or "both"

        return cls(
            id=item.id,
            account_id=item.account_id,
            product_id=item.product_id,
            buying_price=float(item.buying_price) if item.buying_price is not None else None,
            selling_price=float(item.selling_price) if item.selling_price is not None else None,
            margin=item.margin(),
            stock_quantity=item.stock_quantity,
            low_stock_threshold=item.low_stock_threshold,
            inventory_role=role,
            is_active=bool(item.is_active),
            is_low_stock=item.is_low_stock(),
            supplier=getattr(item, "supplier", None),
            location=getattr(item, "location", None),
            notes=item.notes,
            attributes=getattr(item, "attributes", None),
            media=inventory_media_for_item(item) or None,
            product=ProductOut.model_validate(item.product) if item.product else None,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )


class StockMovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    account_id: str
    inventory_item_id: str
    direction: str
    quantity: int
    quantity_before: int | None
    quantity_after: int | None
    reason: str
    note: str | None
    unit_cost: float | None = None
    created_by: str | None
    created_at: datetime | None
    inventory_item: InventoryItemOut | None = None

    @classmethod
    def from_model(cls, movement, *, include_item: bool = False) -> "StockMovementOut":
        item_out = None
        if include_item and getattr(movement, "inventory_item", None) is not None:
            item_out = InventoryItemOut.from_model(movement.inventory_item)
        unit_cost = movement.unit_cost
        try:
            unit_cost_out = float(unit_cost) if unit_cost is not None else None
        except (TypeError, ValueError):
            unit_cost_out = None
        return cls(
            id=movement.id,
            account_id=movement.account_id,
            inventory_item_id=movement.inventory_item_id,
            direction=movement.direction,
            quantity=movement.quantity,
            quantity_before=movement.quantity_before,
            quantity_after=movement.quantity_after,
            reason=movement.reason,
            note=movement.note,
            unit_cost=unit_cost_out,
            created_by=movement.created_by,
            created_at=movement.created_at,
            inventory_item=item_out,
        )


# --- Orders ----------------------------------------------------------------


class OrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    inventory_item_id: str | None
    product_id: str | None
    product_name: str
    product_sku: str | None
    quantity: int
    unit_price: float
    line_total: float
    notes: str | None
    # Current on-hand stock for the linked inventory item (if any).
    stock_quantity: int | None = None

    @classmethod
    def from_model(cls, item) -> "OrderItemOut":
        stock = None
        inv = getattr(item, "inventory_item", None)
        if inv is not None:
            stock = getattr(inv, "stock_quantity", None)
        return cls(
            id=item.id,
            inventory_item_id=item.inventory_item_id,
            product_id=item.product_id,
            product_name=item.product_name,
            product_sku=item.product_sku,
            quantity=item.quantity,
            unit_price=float(item.unit_price),
            line_total=float(item.line_total),
            notes=item.notes,
            stock_quantity=stock,
        )


class OrderStatusEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    from_status: str | None
    to_status: str
    changed_by_user_id: str | None
    note: str | None
    created_at: datetime | None


class OrderMpesaTransactionOut(BaseModel):
    """Lightweight snapshot of the linked M-PESA STK push."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    phone_number: str
    amount: int
    status: str
    result_desc: str | None
    mpesa_receipt_number: str | None
    checkout_request_id: str | None
    completed_at: datetime | None
    created_at: datetime | None
    account_reference: str | None = None
    payout_status: str | None = None
    payout_shortcode: str | None = None
    payout_shortcode_type: str | None = None
    payout_receipt_number: str | None = None
    payout_result_desc: str | None = None
    payout_completed_at: datetime | None = None


class OrderMpesaSettlementOut(BaseModel):
    transaction_account: str | None
    payout_shortcode: str | None
    payout_shortcode_type: str | None


class OrderWorkflowStepOut(BaseModel):
    key: str
    label: str
    state: str


class OrderWorkflowActionOut(BaseModel):
    kind: str
    label: str
    to_status: str | None = None
    variant: str = "primary"
    icon: str | None = None
    disabled: bool = False
    disabled_reason: str | None = None
    requires_mpesa_receipt: bool = False


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    account_id: str
    order_number: str
    source: str
    fulfillment_type: str
    status: str

    customer_name: str | None
    customer_phone: str | None
    customer_email: str | None

    delivery_address: str | None
    delivery_notes: str | None
    pickup_address: str | None = None
    pickup_lat: float | None = None
    pickup_lng: float | None = None

    subtotal: float
    delivery_fee: float
    discount: float
    total: float
    currency: str

    payment_method: str | None
    mpesa_transaction_id: str | None

    placed_by_user_id: str | None

    placed_at: datetime | None
    paid_at: datetime | None
    prepared_at: datetime | None
    ready_at: datetime | None
    dispatched_at: datetime | None
    completed_at: datetime | None
    cancelled_at: datetime | None
    merchant_delivery_confirmed_at: datetime | None
    customer_delivery_confirmed_at: datetime | None
    delivery_disputed_at: datetime | None

    notes: str | None
    prep_minutes: int | None = None
    created_at: datetime | None
    updated_at: datetime | None

    items: list[OrderItemOut] | None = None
    status_history: list[OrderStatusEventOut] | None = None
    items_count: int | None = None
    allowed_next_statuses: list[str] | None = None
    workflow_actions: list[OrderWorkflowActionOut] | None = None
    workflow_steps: list[OrderWorkflowStepOut] | None = None
    mpesa_transaction: OrderMpesaTransactionOut | None = None
    mpesa_transactions: list[OrderMpesaTransactionOut] | None = None
    mpesa_settlement: OrderMpesaSettlementOut | None = None
    tracking_url: str | None = None
    assigned_rider_id: str | None = None
    assigned_rider_name: str | None = None
    rider_assigned_at: datetime | None = None
    rider_dispatched_at: datetime | None = None
    rider_trip_phase: str | None = None
    rider_search_expires_at: datetime | None = None

    @classmethod
    def from_model(
        cls,
        order,
        *,
        include_items: bool = True,
        include_history: bool = True,
        allowed_next: list[str] | None = None,
        include_workflow: bool = True,
    ) -> "OrderOut":
        from app.support.order_workflow import workflow_actions_for_order, workflow_steps

        out = cls(
            id=order.id,
            account_id=order.account_id,
            order_number=order.order_number,
            source=order.source,
            fulfillment_type=order.fulfillment_type,
            status=order.status,
            customer_name=order.customer_name,
            customer_phone=order.customer_phone,
            customer_email=order.customer_email,
            delivery_address=order.delivery_address,
            delivery_notes=order.delivery_notes,
            pickup_address=getattr(order, "pickup_address", None),
            pickup_lat=getattr(order, "pickup_lat", None),
            pickup_lng=getattr(order, "pickup_lng", None),
            subtotal=float(order.subtotal or 0),
            delivery_fee=float(order.delivery_fee or 0),
            discount=float(order.discount or 0),
            total=float(order.total or 0),
            currency=order.currency,
            payment_method=order.payment_method,
            mpesa_transaction_id=order.mpesa_transaction_id,
            placed_by_user_id=order.placed_by_user_id,
            placed_at=order.placed_at,
            paid_at=order.paid_at,
            prepared_at=order.prepared_at,
            ready_at=order.ready_at,
            dispatched_at=order.dispatched_at,
            completed_at=order.completed_at,
            cancelled_at=order.cancelled_at,
            merchant_delivery_confirmed_at=order.merchant_delivery_confirmed_at,
            customer_delivery_confirmed_at=order.customer_delivery_confirmed_at,
            delivery_disputed_at=order.delivery_disputed_at,
            notes=order.notes,
            prep_minutes=getattr(order, "prep_minutes", None),
            created_at=order.created_at,
            updated_at=order.updated_at,
            assigned_rider_id=getattr(order, "assigned_rider_id", None),
            assigned_rider_name=(
                order.assigned_rider.name
                if getattr(order, "assigned_rider", None) is not None
                else None
            ),
            rider_assigned_at=getattr(order, "rider_assigned_at", None),
            rider_dispatched_at=getattr(order, "rider_dispatched_at", None),
            rider_trip_phase=getattr(order, "rider_trip_phase", None),
            rider_search_expires_at=getattr(order, "rider_search_expires_at", None),
            items_count=len(order.items) if order.items is not None else None,
            allowed_next_statuses=allowed_next,
        )
        if include_workflow:
            out.workflow_actions = [
                OrderWorkflowActionOut.model_validate(action)
                for action in workflow_actions_for_order(order)
            ]
            out.workflow_steps = [
                OrderWorkflowStepOut.model_validate(step)
                for step in workflow_steps(order)
            ]
        if include_items:
            out.items = [OrderItemOut.from_model(i) for i in (order.items or [])]
        if include_history:
            out.status_history = [
                OrderStatusEventOut.model_validate(h)
                for h in (order.status_history or [])
            ]
        if order.mpesa_transaction is not None:
            out.mpesa_transaction = OrderMpesaTransactionOut.model_validate(
                order.mpesa_transaction,
            )
        linked_txns = getattr(order, "mpesa_transactions", None)
        if linked_txns is not None:
            out.mpesa_transactions = [
                OrderMpesaTransactionOut.model_validate(txn) for txn in linked_txns
            ]
        from app.services.order_tracking_service import OrderTrackingService

        out.tracking_url = OrderTrackingService.tracking_url(order.id)
        return out


def attach_order_mpesa_settlement(
    order_out: OrderOut,
    profile,
) -> OrderOut:
    if order_out.payment_method != "mpesa" or profile is None:
        return order_out
    order_out.mpesa_settlement = OrderMpesaSettlementOut(
        transaction_account=getattr(profile, "account_number", None),
        payout_shortcode=getattr(profile, "shortcode", None),
        payout_shortcode_type=getattr(profile, "shortcode_type", None),
    )
    return order_out


class LoginCodeOut(BaseModel):
    id: str
    audience: str
    recipient_name: str | None = None
    recipient_masked: str | None = None
    channel: str | None = None
    delivery_status: str | None = None
    lifecycle_status: str
    purpose: str | None = None
    created_at: str | None = None
    expires_at: str | None = None
    consumed_at: str | None = None


class LoginCodesListResponse(BaseModel):
    data: list[LoginCodeOut] = []


class QaIssueOut(BaseModel):
    id: str
    key: str
    issue_number: int
    summary: str
    description: str | None = None
    issue_type: str
    priority: str
    component: str
    status: str
    page_url: str | None = None
    steps_to_reproduce: str | None = None
    reporter_name: str | None = None
    reporter_email: str | None = None
    assignee_id: str | None = None
    assignee_name: str | None = None
    assignee_email: str | None = None
    account_name: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class QaIssuesListResponse(BaseModel):
    data: list[QaIssueOut] = []


class QaAssigneeOut(BaseModel):
    id: str
    name: str
    email: str | None = None


class QaAssigneesListResponse(BaseModel):
    data: list[QaAssigneeOut] = []
