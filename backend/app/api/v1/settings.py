from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field

from app.config import get_settings
from app.core.session import require_user, validate_csrf
from app.core.uploads import delete_upload, save_logo_upload
from app.support.merchant_permissions import (
    assert_merchant_section_access,
    assert_merchant_section_any_access,
)
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.models import (
    STORE_TYPES,
    Account,
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

router = APIRouter(prefix="/settings", tags=["settings"])


class ConnectInstagramRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)


class AutoRepliesSettingRequest(BaseModel):
    enabled: bool


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
    from app.support.merchant_permissions import active_account_id
    merchant_id = active_account_id(user)
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
        "sales_autopilot_script": _sales_script_payload(platform_ig) if platform_ig else None,
        "inventory_integration": (
            inventory_integration_public_payload(inventory_integration_from_account(platform_ig))
            if platform_ig
            else None
        ),
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
