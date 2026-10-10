from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field

from app.config import get_settings
from app.core.session import require_user, validate_csrf
from app.core.uploads import delete_upload, save_logo_upload
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.models import (
    STORE_TYPES,
    Account,
    InventoryItem,
    is_valid_business_category,
)
from app.schemas import AccountOut, InstagramAccountOut, UserOut, build_user_out
from app.services.catalog.inventory_integration import (
    HttpAuthConfig,
    HttpExternalConfig,
    InventoryIntegrationConfig,
    _merge_inventory_integration,
    inventory_integration_from_account,
    inventory_integration_payload,
    inventory_integration_public_payload,
    parse_inventory_integration,
)
from app.services.instagram_data_purge import InstagramDataPurgeService
from app.services.platform_instagram import (
    SUPPORTED_PLATFORMS,
    get_merchant_instagram_account,
    list_merchant_connected_channels,
    require_merchant_account_id,
    require_merchant_instagram_account,
    user_can_manage_channels,
)
from app.support.merchant_permissions import (
    active_account_id,
    assert_merchant_section_access,
    assert_merchant_section_any_access,
    is_membership_owner,
)

router = APIRouter(prefix="/settings", tags=["settings"])


class ConnectInstagramRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)


class AutoRepliesSettingRequest(BaseModel):
    enabled: bool


class OpeningAmountUpdate(BaseModel):
    opening_amount: Decimal = Field(ge=0, le=99_999_999.99, decimal_places=2)

class OpeningStockUpdate(BaseModel):
    opening_stock: Decimal = Field(ge=0, le=99_999_999.99, decimal_places=2)

class OpeningInvestmentUpdate(BaseModel):
    opening_investment: Decimal = Field(ge=0, le=99_999_999.99, decimal_places=2)


class OperationsSettingsUpdate(BaseModel):
    allow_item_quantity_adjustment: bool | None = None
    allow_price_adjustment: bool | None = None
    adjust_selling_price_on_purchase: bool | None = None
    force_mpesa_prompt: bool | None = None
    block_sale_on_low_ingredients: bool | None = None


DEFAULT_MENU_SECTIONS: list[dict[str, str]] = [
    {"id": "mains", "label": "Mains"},
    {"id": "bites", "label": "Bites & snacks"},
    {"id": "hot_drinks", "label": "Hot drinks"},
    {"id": "cold_drinks", "label": "Cold drinks"},
]

_SECTION_ID_INVALID = re.compile(r"[^a-z0-9]+")


class MenuSectionIn(BaseModel):
    id: str | None = Field(default=None, max_length=48)
    label: str = Field(min_length=1, max_length=40)


class MenuSectionsUpdate(BaseModel):
    sections: list[MenuSectionIn] = Field(min_length=1, max_length=24)


def _section_id(value: str) -> str:
    return _SECTION_ID_INVALID.sub("_", value.strip().lower()).strip("_")[:48]


def menu_sections_for(account: Account | None) -> list[dict[str, str]]:
    raw = account.menu_sections if account is not None else None
    if not isinstance(raw, list):
        return [dict(s) for s in DEFAULT_MENU_SECTIONS]
    sections = [
        {"id": str(s["id"]), "label": str(s["label"])}
        for s in raw
        if isinstance(s, dict) and s.get("id") and s.get("label")
    ]
    return sections or [dict(s) for s in DEFAULT_MENU_SECTIONS]


def _normalize_menu_sections(sections: list[MenuSectionIn]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    seen_labels: set[str] = set()
    for section in sections:
        label = " ".join(section.label.split())
        if not label:
            continue
        if label.lower() in seen_labels:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f'"{label}" is listed twice.',
            )
        base = _section_id(section.id or "") or _section_id(label) or "section"
        section_id, n = base, 2
        while section_id in seen_ids:
            section_id, n = f"{base}_{n}", n + 1
        seen_ids.add(section_id)
        seen_labels.add(label.lower())
        out.append({"id": section_id, "label": label})
    if not out:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Add at least one menu section.",
        )
    return out


class BusinessLocationUpdate(BaseModel):
    business_location: str = Field(min_length=1, max_length=255)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class BusinessProfileUpdate(BaseModel):
    business_name: str = Field(min_length=1, max_length=255)
    business_category: str = Field(min_length=1, max_length=100)
    store_type: str = Field(default="retail", min_length=1, max_length=32)


class HttpAuthConfigRequest(BaseModel):
    type: str = Field(default="none", max_length=32)
    token: str | None = Field(default=None, max_length=500)
    username: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, max_length=255)
    header_name: str | None = Field(default=None, max_length=128)
    header_value: str | None = Field(default=None, max_length=500)


class HttpEndpointsRequest(BaseModel):
    search: str | None = Field(default=None, max_length=500)
    list: str | None = Field(default=None, max_length=500)
    get: str | None = Field(default=None, max_length=500)
    create_order: str | None = Field(default=None, max_length=500)


class HttpExternalConfigRequest(BaseModel):
    type: str = Field(default="http", max_length=32)
    base_url: str = Field(min_length=1, max_length=500)
    auth: HttpAuthConfigRequest = Field(default_factory=HttpAuthConfigRequest)
    endpoints: HttpEndpointsRequest = Field(default_factory=HttpEndpointsRequest)
    field_map: dict[str, str] = Field(default_factory=dict)
    cache_ttl_seconds: int = Field(default=60, ge=10, le=600)
    browse_only: bool = False


class InventoryIntegrationRequest(BaseModel):
    catalog_source: str = Field(default="platform", pattern="^(platform|external|hybrid)$")
    external: HttpExternalConfigRequest | None = None


class InventoryIntegrationTestRequest(BaseModel):
    query: str = Field(default="test", min_length=1, max_length=120)


class SalesAutopilotScriptRequest(BaseModel):
    tone: str = Field(default="professional", max_length=80)
    opening_line: str = Field(
        default=(
            "Introduce yourself as DukAI and welcome them to the shop in a warm, natural way "
            "that matches how the customer greeted you."
        ),
        max_length=500,
    )
    payment_rule_line: str = Field(
        default="Do not handle payment or post-placement processing — the shop sends those automatically.",
        max_length=500,
    )
    consent_prompt: str = Field(
        default=(
            "Before we continue — may we save your details for faster checkout next time? "
            "Reply YES to agree, or NO to skip."
        ),
        max_length=800,
    )
    response_guidelines: str = Field(
        default="",
        max_length=2000,
        description="Extra instructions for how the AI should respond to customers.",
    )


def _sales_script_payload(account) -> dict:
    checks = account.onboarding_checks if isinstance(account.onboarding_checks, dict) else {}
    script = checks.get("sales_autopilot_script") if isinstance(checks, dict) else {}
    if not isinstance(script, dict):
        script = {}
    return {
        "tone": script.get("tone", "professional"),
        "opening_line": script.get(
            "opening_line",
            (
                "Introduce yourself as DukAI and welcome them to the shop in a warm, natural way "
                "that matches how the customer greeted you."
            ),
        ),
        "payment_rule_line": script.get(
            "payment_rule_line",
            "Do not handle payment or post-placement processing — the shop sends those automatically.",
        ),
        "consent_prompt": script.get(
            "consent_prompt",
            (
                "Before we continue — may we save your details for faster checkout next time? "
                "Reply YES to agree, or NO to skip."
            ),
        ),
        "response_guidelines": script.get("response_guidelines", ""),
    }


@router.get("")
def show_settings(
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    settings = get_settings()
    merchant_id = active_account_id(user)
    account = services.db.get(Account, merchant_id) if merchant_id else None
    can_manage_opening_amount = bool(
        account and (user.is_super_admin() or is_membership_owner(user, str(merchant_id)))
    )
    platform_ig = (
        get_merchant_instagram_account(services.db, str(merchant_id))
        if merchant_id
        else None
    )
    connected = (
        list_merchant_connected_channels(services.db, str(merchant_id))
        if merchant_id
        else {platform: None for platform in SUPPORTED_PLATFORMS}
    )
    connected_platforms = [name for name, acc in connected.items() if acc is not None]
    return {
        "user": build_user_out(services.db, user),
        "instagram_connect_url": settings.instagram_oauth_start_url,  # /auth/instagram
        "can_manage_instagram": user_can_manage_channels(user),
        "platform_instagram_connected": platform_ig is not None,
        "supported_platforms": list(SUPPORTED_PLATFORMS),
        "connected_platforms": connected_platforms,
        "any_channel_connected": bool(connected_platforms),
        "opening_amount": (
            str(account.opening_amount) if account and account.opening_amount is not None else None
        ),
        "opening_amount_set_at": account.opening_amount_set_at if account else None,
        "opening_stock": (
            str(account.opening_stock) if account and account.opening_stock is not None else None
        ),
        "opening_stock_set_at": account.opening_stock_set_at if account else None,
        "opening_investment": (
            str(account.opening_investment) if account and account.opening_investment is not None else None
        ),
        "opening_investment_set_at": account.opening_investment_set_at if account else None,
        "suggested_opening_stock": str(
            sum(
                (item.stock_quantity or 0) * (item.buying_price or 0)
                for item in services.db.query(InventoryItem).filter_by(account_id=account.id).all()
            )
            if account else 0
        ),
        "allow_item_quantity_adjustment": (
            account.allow_item_quantity_adjustment if account else True
        ),
        "allow_price_adjustment": (
            account.allow_price_adjustment if account else False
        ),
        "adjust_selling_price_on_purchase": (
            account.adjust_selling_price_on_purchase if account else True
        ),
        "force_mpesa_prompt": (
            account.force_mpesa_prompt if account else True
        ),
        "can_set_opening_amount": bool(account is not None and can_manage_opening_amount),
        "can_set_opening_stock": bool(account is not None and can_manage_opening_amount),
        "can_set_opening_investment": bool(account is not None and can_manage_opening_amount),
        "sales_autopilot_script": _sales_script_payload(platform_ig) if platform_ig else None,
        "inventory_integration": (
            inventory_integration_public_payload(inventory_integration_from_account(platform_ig))
            if platform_ig
            else None
        ),
    }


@router.get("/operations")
def show_operations_settings(
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_user(services.db, session)
    assert_merchant_section_any_access(user, "settings", "pos", "dashboard")
    account_id = require_merchant_account_id(user)
    account = services.db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Business account not found.")
    return {
        "allow_item_quantity_adjustment": account.allow_item_quantity_adjustment,
        "allow_price_adjustment": account.allow_price_adjustment,
        "adjust_selling_price_on_purchase": account.adjust_selling_price_on_purchase,
        "force_mpesa_prompt": account.force_mpesa_prompt,
        "block_sale_on_low_ingredients": bool(
            getattr(account, "block_sale_on_low_ingredients", False)
        ),
        "kitchen_issuing_enabled": bool(getattr(account, "kitchen_issuing_enabled", False)),
    }


@router.patch("/operations")
def update_operations_settings(
    payload: OperationsSettingsUpdate,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    account_id = active_account_id(user)
    if not (user.is_super_admin() or is_membership_owner(user, account_id)):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only the shop owner can update operational settings.",
        )

    account = services.db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Business account not found.")

    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in changes.items():
        setattr(account, field, value)

    services.db.commit()
    services.db.refresh(account)
    return {
        "allow_item_quantity_adjustment": account.allow_item_quantity_adjustment,
        "allow_price_adjustment": account.allow_price_adjustment,
        "adjust_selling_price_on_purchase": account.adjust_selling_price_on_purchase,
        "force_mpesa_prompt": account.force_mpesa_prompt,
        "block_sale_on_low_ingredients": bool(
            getattr(account, "block_sale_on_low_ingredients", False)
        ),
        "kitchen_issuing_enabled": bool(getattr(account, "kitchen_issuing_enabled", False)),
    }


@router.get("/menu-sections")
def show_menu_sections(
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    user = require_user(services.db, session)
    assert_merchant_section_any_access(user, "settings", "inventory", "pos", "dashboard")
    account = services.db.get(Account, require_merchant_account_id(user))
    return {"sections": menu_sections_for(account)}


@router.put("/menu-sections")
def update_menu_sections(
    payload: MenuSectionsUpdate,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    account = services.db.get(Account, require_merchant_account_id(user))
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Business account not found.")

    account.menu_sections = _normalize_menu_sections(payload.sections)
    services.db.commit()
    services.db.refresh(account)
    return {"message": "Menu sections saved.", "sections": menu_sections_for(account)}


@router.put("/opening-amount")
def set_opening_amount(
    payload: OpeningAmountUpdate,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    """Record the shop's starting till cash once; it is not sales income."""
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    account_id = require_merchant_account_id(user)

    if not (user.is_super_admin() or is_membership_owner(user, account_id)):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only the shop owner can set the opening amount.",
        )

    account = services.db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Business account not found.")


    account.opening_amount = payload.opening_amount
    account.opening_amount_set_at = datetime.utcnow()
    services.db.commit()
    services.db.refresh(account)
    return {
        "message": "Opening amount saved.",
        "opening_amount": str(account.opening_amount),
        "opening_amount_set_at": account.opening_amount_set_at,
        "can_set_opening_amount": True,
    }


@router.put("/opening-stock")
def set_opening_stock(
    payload: OpeningStockUpdate,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    """
    Sets the one-time opening stock value.
    """
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    account_id = require_merchant_account_id(user)

    if not (user.is_super_admin() or is_membership_owner(user, account_id)):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only the shop owner can set the opening stock.",
        )

    account = services.db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Business account not found.")


    account.opening_stock = payload.opening_stock
    account.opening_stock_set_at = datetime.utcnow()
    services.db.commit()
    services.db.refresh(account)
    return {
        "message": "Opening stock saved.",
        "opening_stock": str(account.opening_stock),
        "opening_stock_set_at": account.opening_stock_set_at,
        "can_set_opening_stock": True,
    }

@router.put("/opening-investment")
def set_opening_investment(
    payload: OpeningInvestmentUpdate,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    account_id = active_account_id(user)
    if not account_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No active business account.")

    if not (user.is_super_admin() or is_membership_owner(user, account_id)):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only the shop owner can set the opening investment.",
        )

    account = services.db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Business account not found.")

    account.opening_investment = payload.opening_investment
    account.opening_investment_set_at = datetime.utcnow()
    services.db.commit()
    services.db.refresh(account)
    return {
        "message": "Opening investment saved.",
        "opening_investment": str(account.opening_investment),
        "opening_investment_set_at": account.opening_investment_set_at,
        "can_set_opening_investment": True,
    }



@router.post("/instagram")
def connect_instagram(
    payload: ConnectInstagramRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    if not user_can_manage_channels(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to manage channels for this shop.",
        )
    require_merchant_account_id(user)
    account = services.linker.link_manual(
        user,
        payload.username,
        payload.display_name,
    )
    return {
        "message": (
            "Instagram account saved. Connect via Meta when you are ready for live messaging."
        ),
        "instagram_account": InstagramAccountOut.from_model(account),
    }


@router.delete("/instagram")
def disconnect_instagram(
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    if not user_can_manage_channels(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to manage channels for this shop.",
        )
    require_merchant_account_id(user)
    account = get_merchant_instagram_account(services.db, require_merchant_account_id(user))
    if account:
        purge = InstagramDataPurgeService(
            services.db,
            services.settings,
            services.instagram_api,
        )
        purge.purge_account(account, source="merchant_disconnect")
        services.db.commit()
    return {"message": "Your shop's Instagram account was disconnected."}


@router.patch("/business-location")
def update_business_location(
    payload: BusinessLocationUpdate,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_any_access(user, "settings", "delivery")
    account_id = require_merchant_account_id(user)
    account = services.db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Business account not found.")

    account.business_location = payload.business_location.strip()
    account.latitude = payload.latitude
    account.longitude = payload.longitude
    services.db.commit()
    services.db.refresh(account)

    return {
        "message": "Business location saved.",
        "account": AccountOut.model_validate(account),
        "user": build_user_out(services.db, user),
    }


@router.patch("/business")
def update_business_profile(
    payload: BusinessProfileUpdate,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    account_id = require_merchant_account_id(user)
    account = services.db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Business account not found.")

    name = payload.business_name.strip()
    category = payload.business_category.strip()
    store_type = payload.store_type.strip().lower()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Business name is required.")
    if store_type not in STORE_TYPES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose a valid store type (retail or restaurant).",
        )
    if not is_valid_business_category(category, store_type):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose a valid category for what this merchant sells.",
        )

    account.business_name = name
    account.business_category = category
    account.store_type = store_type
    services.db.commit()
    services.db.refresh(account)

    return {
        "message": "Business profile saved.",
        "account": AccountOut.model_validate(account),
        "user": build_user_out(services.db, user),
    }


@router.post("/logo")
async def upload_business_logo(
    request: Request,
    file: UploadFile = File(..., description="Store logo image (JPEG, PNG, WebP, or GIF)."),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    account_id = require_merchant_account_id(user)
    account = services.db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Business account not found.")

    upload = await save_logo_upload(account_id, file, uploader_id=user.id)
    previous = (account.logo_url or "").strip() or None
    account.logo_url = upload["url"]
    services.db.commit()
    services.db.refresh(account)

    if previous and previous != account.logo_url:
        delete_upload(previous)

    return {
        "message": "Store logo saved.",
        "account": AccountOut.model_validate(account),
        "user": build_user_out(services.db, user),
    }


@router.delete("/logo")
def delete_business_logo(
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    account_id = require_merchant_account_id(user)
    account = services.db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Business account not found.")

    previous = (account.logo_url or "").strip() or None
    account.logo_url = None
    services.db.commit()
    services.db.refresh(account)

    if previous:
        delete_upload(previous)

    return {
        "message": "Store logo removed.",
        "account": AccountOut.model_validate(account),
        "user": build_user_out(services.db, user),
    }


@router.patch("/auto-replies")
def update_auto_replies(
    payload: AutoRepliesSettingRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    if not user_can_manage_channels(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to change auto-reply settings for this shop.",
        )

    account = require_merchant_instagram_account(services.db, user)
    account.auto_replies_enabled = payload.enabled
    services.db.commit()
    services.db.refresh(account)

    if payload.enabled:
        services.dm_agent.resume_all_handoff_conversations(account)

    return {
        "message": "Auto-reply setting updated.",
        "auto_replies_enabled": account.auto_replies_enabled,
        "instagram_account": InstagramAccountOut.from_model(account),
    }


@router.patch("/sales-autopilot-script")
def update_sales_autopilot_script(
    payload: SalesAutopilotScriptRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    if not user_can_manage_channels(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to change sales autopilot settings for this shop.",
        )

    account = require_merchant_instagram_account(services.db, user)
    checks = account.onboarding_checks if isinstance(account.onboarding_checks, dict) else {}
    checks = dict(checks)
    checks["sales_autopilot_script"] = payload.model_dump()
    account.onboarding_checks = checks
    services.db.commit()
    services.db.refresh(account)

    return {
        "message": "Sales autopilot script updated.",
        "sales_autopilot_script": _sales_script_payload(account),
    }


@router.patch("/inventory-integration")
def update_inventory_integration(
    payload: InventoryIntegrationRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    if not user_can_manage_channels(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to change inventory integration settings.",
        )

    account = require_merchant_instagram_account(services.db, user)
    config = _merge_inventory_integration(account, payload.model_dump())
    checks = account.onboarding_checks if isinstance(account.onboarding_checks, dict) else {}
    checks = dict(checks)
    checks["inventory_integration"] = inventory_integration_payload(config)
    account.onboarding_checks = checks
    services.db.commit()
    services.db.refresh(account)

    return {
        "message": "Inventory integration updated.",
        "inventory_integration": inventory_integration_public_payload(config),
    }


@router.post("/inventory-integration/test")
def test_inventory_integration(
    payload: InventoryIntegrationTestRequest,
    request: Request,
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    user = require_user(services.db, session)
    assert_merchant_section_access(user, "settings")
    account = require_merchant_instagram_account(services.db, user)
    merchant_id = str(account.account_id or "").strip()
    if not merchant_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Shop not configured.")

    from app.services.catalog.factory import resolve_catalog_provider

    provider = resolve_catalog_provider(
        services.db,
        services.settings,
        merchant_id,
        instagram_account=account,
    )
    hits = provider.search(merchant_id, payload.query.strip(), limit=5)
    products = [
        {
            "catalog_item_ref": hit.item.ref,
            "name": hit.item.name,
            "price_kes": hit.item.price_kes,
            "stock": hit.item.stock,
            "source": hit.item.source,
        }
        for hit in hits
    ]
    return {
        "ok": True,
        "query": payload.query.strip(),
        "count": len(products),
        "products": products,
    }
