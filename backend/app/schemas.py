from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.services.kitchen_menu_service import supports_recipe
from pydantic import BaseModel, ConfigDict, Field


def _optional_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    business_name: str
    business_location: str
    business_category: str
    store_type: str = "retail"
    logo_url: str | None = None
    receipt_descriptions: list[str] | None = None
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

    user_state = inspect(user)
    if "instagram_account" not in user_state.unloaded:
        return UserOut.from_model(user, instagram_account=user.instagram_account)

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


class MealAddonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    meal_id: str
    addon_id: str
    additional_price: float | None = None
    is_default: bool = False
    is_required: bool = False
    max_quantity: int = 1
    sort_order: int = 0
    addon_name: str | None = None
    addon_code: str | None = None
    addon_price: float | None = None
    created_at: datetime | None = None


class MealAddonLinkPayload(BaseModel):
    addon_id: str
    additional_price: float | None = None
    is_default: bool = False
    is_required: bool = False
    max_quantity: int = 1
    sort_order: int = 0


class ModifierOptionRecipeOut(BaseModel):
    id: str
    menu_product_id: str
    menu_name: str | None = None
    product_id: str
    product_name: str | None = None
    product_unit: str | None = None
    stock_qty: float = 1
    portions_per_unit: float = 1
    portion_unit: str = "portions"

    @classmethod
    def from_model(cls, recipe) -> "ModifierOptionRecipeOut":
        return cls(
            id=recipe.id,
            menu_product_id=recipe.menu_product_id,
            menu_name=recipe.menu_product.name if recipe.menu_product else None,
            product_id=recipe.product_id,
            product_name=recipe.product.name if recipe.product else None,
            product_unit=recipe.product.unit if recipe.product else None,
            stock_qty=float(recipe.stock_qty or 1),
            portions_per_unit=float(recipe.portions_per_unit or 1),
            portion_unit=recipe.portion_unit or "portions",
        )


class ModifierOptionOut(BaseModel):
    id: str
    group_id: str
    name: str
    price_delta: float = 0
    product_id: str | None = None
    product_name: str | None = None
    product_unit: str | None = None
    stock_qty: float = 1
    batch_yield: float = 1
    portion_unit: str | None = None
    recipes: list[ModifierOptionRecipeOut] = []
    source_kind: str | None = None
    source_product_id: str | None = None
    source_option_id: str | None = None
    source_name: str | None = None
    is_default: bool = False
    sort_order: int = 0
    is_active: bool = True

    @classmethod
    def from_model(cls, option) -> "ModifierOptionOut":
        source_kind = getattr(option, "source_kind", None)
        source_name = None
        if source_kind in ("store_item", "menu"):
            source = getattr(option, "source_product", None)
            source_name = source.name if source else None
            if source is None:
                source_kind = None
        elif source_kind == "extra":
            source = getattr(option, "source_option", None)
            source_name = source.name if source else None
            if source is None:
                source_kind = None
        return cls(
            id=option.id,
            group_id=option.group_id,
            name=option.name,
            price_delta=float(option.price_delta or 0),
            product_id=option.product_id,
            product_name=option.product.name if option.product else None,
            product_unit=option.product.unit if option.product else None,
            stock_qty=float(option.stock_qty) if option.stock_qty is not None else 1,
            batch_yield=float(option.batch_yield) if option.batch_yield is not None else 1,
            portion_unit=option.portion_unit,
            recipes=[ModifierOptionRecipeOut.from_model(recipe) for recipe in option.recipes or []],
            source_kind=source_kind,
            source_product_id=option.source_product_id if source_kind in ("store_item", "menu") else None,
            source_option_id=option.source_option_id if source_kind == "extra" else None,
            source_name=source_name,
            is_default=bool(option.is_default),
            sort_order=option.sort_order or 0,
            is_active=option.is_active is not False,
        )


class ModifierGroupOut(BaseModel):
    id: str
    name: str
    min_select: int = 0
    max_select: int = 1
    is_extra: bool = False
    included: bool = False
    sort_order: int = 0
    options: list[ModifierOptionOut] = []
    item_count: int | None = None

    @classmethod
    def from_model(cls, group, *, item_count: int | None = None) -> "ModifierGroupOut":
        return cls(
            id=group.id,
            name=group.name,
            min_select=group.min_select or 0,
            max_select=group.max_select or 1,
            is_extra=bool(group.is_extra),
            included=bool(group.included),
            sort_order=group.sort_order or 0,
            options=[ModifierOptionOut.from_model(o) for o in group.options or []],
            item_count=item_count,
        )


class ComboComponentOut(BaseModel):
    id: str
    component_product_id: str
    name: str | None = None
    quantity: int = 1
    sort_order: int = 0
    modifier_groups: list[ModifierGroupOut] = []


class RecipeLineOut(BaseModel):
    id: str
    ingredient_product_id: str
    name: str | None = None
    unit: str | None = None
    quantity: float
    batch_quantity: float
    batch_yield: float
    serving_unit: str = "servings"
    ingredient_unit: str | None = None


def recipe_for(product, account_id: str | None) -> list[RecipeLineOut]:
    """This shop's recipe for a dish (catalogue rows are shared, recipes are not)."""
    if product is None or account_id is None:
        return []

    def quantity_per_serving(line) -> float:
        batch_quantity = getattr(line, "batch_quantity", None)
        batch_yield = getattr(line, "batch_yield", None)
        if batch_quantity is not None and batch_yield is not None and Decimal(str(batch_yield)) > 0:
            return float(Decimal(str(batch_quantity)) / Decimal(str(batch_yield)))
        return float(line.quantity or 0)

    return [
        RecipeLineOut(
            id=line.id,
            ingredient_product_id=line.ingredient_product_id,
            name=line.ingredient.name if line.ingredient else None,
            unit=line.ingredient.unit if line.ingredient else None,
            quantity=quantity_per_serving(line),
            batch_quantity=float(line.batch_quantity or line.quantity or 0),
            batch_yield=float(line.batch_yield or 1),
            serving_unit=line.serving_unit or "servings",
            ingredient_unit=getattr(line, "ingredient_unit", None) or (line.ingredient.unit if line.ingredient else None),
        )
        for line in product.recipe_lines or []
        if line.account_id == account_id
    ]


def modifier_groups_for(product, account_id: str | None) -> list[ModifierGroupOut]:
    """Groups the given shop attached to ``product`` (catalogue rows are shared)."""
    if product is None:
        return []
    return [
        ModifierGroupOut.from_model(link.group)
        for link in product.modifier_group_links or []
        if link.group is not None and (account_id is None or link.group.account_id == account_id)
    ]


def combo_components_for(product, account_id: str | None) -> list[ComboComponentOut]:
    if product is None:
        return []
    return [
        ComboComponentOut(
            id=row.id,
            component_product_id=row.component_product_id,
            name=row.component.name if row.component else None,
            quantity=row.quantity or 1,
            sort_order=row.sort_order or 0,
            modifier_groups=modifier_groups_for(row.component, account_id),
        )
        for row in product.combo_component_links or []
    ]


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
    total_quantity: int | None = None
    addons: list[MealAddonOut] | None = None
    modifier_groups: list[ModifierGroupOut] | None = None
    combo_components: list[ComboComponentOut] | None = None
    recipe: list[RecipeLineOut] | None = None
    recipe_serving_unit: str = "servings"
    serving_options: list[str] = Field(default_factory=list)
    is_active: bool = True
    created_at: datetime | None
    updated_at: datetime | None


CatalogueOut = ProductOut


class InventoryItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    account_id: str
    product_id: str
    buying_price: float | None
    selling_price: float | None
    margin: float | None
    stock_quantity: float | None
    kitchen_quantity: float | None = None
    low_stock_threshold: float | None
    inventory_role: str = "both"
    is_active: bool
    is_low_stock: bool
    supplier: str | None = None
    preferred_supplier_id: str | None = None
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
            stock_quantity=(
                float(item.stock_quantity) if item.stock_quantity is not None else None
            ),
            kitchen_quantity=_optional_float(getattr(item, "kitchen_quantity", None)),
            low_stock_threshold=(
                float(item.low_stock_threshold)
                if item.low_stock_threshold is not None
                else None
            ),
            inventory_role=role,
            is_active=bool(item.is_active),
            is_low_stock=item.is_low_stock(),
            supplier=getattr(item, "supplier", None),
            preferred_supplier_id=getattr(item, "preferred_supplier_id", None),
            location=getattr(item, "location", None),
            notes=item.notes,
            attributes=getattr(item, "attributes", None),
            media=inventory_media_for_item(item) or None,
            product=_inventory_product_out(item.product, item.account_id),
            created_at=item.created_at,
            updated_at=item.updated_at,
        )


def _inventory_product_out(product, account_id: str | None = None) -> ProductOut | None:
    if product is None:
        return None
    out = ProductOut.model_validate(product)
    product_type = getattr(product, "product_type", None)
    recipe_supported = supports_recipe(product_type, getattr(product, "category", None))
    if product_type == "meal":
        links = sorted(
            product.available_addons or [],
            key=lambda link: (link.sort_order or 0, link.created_at or datetime.min),
        )
        out.addons = [MealAddonOut.model_validate(link) for link in links]
    if product_type in ("meal", "combo"):
        out.modifier_groups = modifier_groups_for(product, account_id)
    if recipe_supported:
        out.recipe = recipe_for(product, account_id)
        out.serving_options = sorted(
            {
                (line.serving_unit or "servings").strip()
                for line in product.recipe_lines or []
                if line.account_id == account_id
            }
        )
        out.recipe_serving_unit = next(
            (
                setting.serving_unit
                for setting in product.recipe_serving_units or []
                if setting.account_id == account_id
            ),
            (out.serving_options[0] if out.serving_options else "servings"),
        )
    if product_type == "combo":
        out.combo_components = combo_components_for(product, account_id)
    return out


class StockMovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    account_id: str
    inventory_item_id: str
    direction: str
    quantity: float
    quantity_before: float | None
    quantity_after: float | None
    reason: str
    location: str = "store"
    note: str | None
    unit_cost: float | None = None
    total_cost: float | None = None
    supplier_id: str | None = None
    purchase_order_id: str | None = None
    order_id: str | None = None
    stock_take_id: str | None = None
    created_by: str | None
    created_at: datetime | None
    voided_at: datetime | None = None
    void_reason: str | None = None
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
            quantity=float(movement.quantity),
            quantity_before=(
                float(movement.quantity_before)
                if movement.quantity_before is not None
                else None
            ),
            quantity_after=(
                float(movement.quantity_after)
                if movement.quantity_after is not None
                else None
            ),
            reason=movement.reason,
            location=getattr(movement, "location", None) or "store",
            note=movement.note,
            unit_cost=unit_cost_out,
            total_cost=_optional_float(getattr(movement, "total_cost", None)),
            supplier_id=getattr(movement, "supplier_id", None),
            purchase_order_id=getattr(movement, "purchase_order_id", None),
            order_id=getattr(movement, "order_id", None),
            stock_take_id=getattr(movement, "stock_take_id", None),
            created_by=movement.created_by,
            created_at=movement.created_at,
            voided_at=getattr(movement, "voided_at", None),
            void_reason=getattr(movement, "void_reason", None),
            inventory_item=item_out,
        )


class InventoryTimelineActivityOut(BaseModel):
    id: str
    activity_type: str
    direction: str
    title: str
    quantity: float
    unit: str | None = None
    quantity_before: float | None = None
    quantity_after: float | None = None
    unit_cost: float | None = None
    unit_price: float | None = None
    total_amount: float | None = None
    reason: str
    reference_type: str | None = None
    reference_id: str | None = None
    reference_code: str | None = None
    party_name: str | None = None
    user_name: str | None = None
    location: str | None = None
    note: str | None = None
    created_at: datetime | None = None
    voided_at: datetime | None = None
    void_reason: str | None = None


class InventoryTimelineSummaryOut(BaseModel):
    total_bought: float = 0.0
    total_bought_cost: float = 0.0
    total_sold: float = 0.0
    total_sold_revenue: float = 0.0
    total_adjusted: float = 0.0
    current_stock: float | None = None
    unit: str | None = None


class InventoryTimelineResponse(BaseModel):
    summary: InventoryTimelineSummaryOut
    activities: list[InventoryTimelineActivityOut]
    meta: dict[str, int]


# --- Orders ----------------------------------------------------------------


class OrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    inventory_item_id: str | None
    product_id: str | None
    product_name: str
    product_sku: str | None
    quantity: int
    returned_quantity: int = 0
    unit_price: float
    line_total: float
    sell_unit: str | None = None
    serving_unit: str | None = None
    unit_factor: float = 1
    notes: str | None
    modifiers: list[dict[str, Any]] | None = None
    # Current on-hand stock for the linked inventory item (if any).
    stock_quantity: float | None = None
    cost_total: float | None = None

    @classmethod
    def from_model(cls, item) -> "OrderItemOut":
        stock = None
        inv = getattr(item, "inventory_item", None)
        if inv is not None:
            stock = getattr(inv, "stock_quantity", None)
        factor = float(getattr(item, "unit_factor", None) or 1)
        return cls(
            id=item.id,
            inventory_item_id=item.inventory_item_id,
            product_id=item.product_id,
            product_name=item.product_name,
            product_sku=item.product_sku,
            quantity=item.quantity,
            returned_quantity=int(getattr(item, "returned_quantity", 0) or 0),
            unit_price=float(item.unit_price),
            line_total=float(item.line_total),
            sell_unit=getattr(item, "sell_unit", None),
            serving_unit=getattr(item, "serving_unit", None),
            unit_factor=factor,
            notes=item.notes,
            modifiers=getattr(item, "modifiers", None),
            stock_quantity=float(stock) if stock is not None else None,
            cost_total=_optional_float(getattr(item, "cost_total", None)),
        )


class OrderReturnItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    order_item_id: str
    inventory_item_id: str | None = None
    product_name: str
    quantity: int
    unit_price: float
    refund_amount: float
    restock: bool = True
    condition_name: str = "good"
    created_at: datetime | None = None


class OrderReturnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    order_id: str
    return_number: str
    total_refunded: float
    refund_payment_method: str | None = None
    reason: str
    notes: str | None = None
    created_by_user_id: str | None = None
    created_at: datetime | None = None
    items: list[OrderReturnItemOut] = []


class OrderReturnLineIn(BaseModel):
    order_item_id: str
    quantity: int = Field(gt=0, description="Quantity to return")
    condition: Literal["restock", "damaged", "waste"] = "restock"


class OrderReturnCreate(BaseModel):
    items: list[OrderReturnLineIn] = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=255)
    notes: str | None = None
    refund_payment_method: Literal["cash", "mpesa", "credit", "none"] = "cash"
    refund_amount: float | None = None


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
    tax: float = 0
    discount: float
    total: float
    returned_total: float = 0
    currency: str

    payment_method: str | None
    payment_splits: list[dict[str, Any]] | None = None
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
    returns: list[OrderReturnOut] | None = None
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
    table_number: str | None = None
    server_name: str | None = None

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
            table_number=getattr(order, "table_number", None),
            server_name=(
                order.placed_by.name
                if getattr(order, "placed_by", None) is not None
                else None
            ),
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
            tax=float(getattr(order, "tax", 0) or 0),
            discount=float(order.discount or 0),
            total=float(order.total or 0),
            returned_total=float(getattr(order, "returned_total", 0) or 0),
            currency=order.currency,
            payment_method=order.payment_method,
            payment_splits=getattr(order, "payment_splits", None),
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
        if getattr(order, "returns", None) is not None:
            out.returns = [
                OrderReturnOut.model_validate(r) for r in order.returns
            ]
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
    uses_mpesa = order_out.payment_method == "mpesa" or any(
        row.get("method") == "mpesa" for row in order_out.payment_splits or []
    )
    if not uses_mpesa or profile is None:
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


class ExpenseCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    amount: float = Field(..., gt=0)
    category: str = Field(default="errand", max_length=64)
    payment_method: str = Field(default="cash", max_length=32)
    spent_at: datetime | None = None
    notes: str | None = None


class ExpenseUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    amount: float | None = Field(default=None, gt=0)
    category: str | None = Field(default=None, max_length=64)
    payment_method: str | None = Field(default=None, max_length=32)
    spent_at: datetime | None = None
    notes: str | None = None


class ExpenseOut(BaseModel):
    id: str
    account_id: str
    user_id: str | None = None
    user_name: str | None = None
    title: str
    category: str
    amount: float
    payment_method: str
    spent_at: str
    notes: str | None = None
    created_at: str | None = None


class ExpenseListResponse(BaseModel):
    data: list[ExpenseOut] = []
    total_amount: float = 0.0
    count: int = 0
