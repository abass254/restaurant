"""Platform admin (super_admin) endpoints.

Provides read-only visibility into every merchant on the platform:
their account row, the users registered against that account, and a
few headline counts. Mounted at ``/api/v1/admin`` and gated behind a
``require_super_admin`` dependency so only the seeded netizen account
(or any other ``user_role == "super_admin"`` user) can call it.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.api.v1.admin_auth import require_super_admin
from app.config import get_settings
from app.core.session import require_user
from app.core.security import hash_password
from app.core.uploads import save_generated_image
from app.database import get_db
from app.dependencies import ServiceContainer, get_request_session, get_services
from app.models import (
    Account,
    AiAgentConfiguration,
    GoogleMapsConfiguration,
    InstagramAccount,
    InventoryItem,
    MapboxConfiguration,
    MerchantMpesaProfile,
    MpesaTransaction,
    Order,
    OrderStatusHistory,
    Product,
    STORE_TYPES,
    User,
    UserMembership,
    is_valid_business_category,
)
from app.schemas import OrderOut, ProductOut, attach_order_mpesa_settlement
from app.services import mpesa_service
from app.core.session import validate_csrf
from app.support.order_delivery_details import order_needs_delivery_details
from app.support.order_status import (
    BEING_PREPARED,
    CANCELLED,
    DELIVERED,
    OUT_FOR_DELIVERY,
    PAYMENT_RECEIVED,
    PICKED_UP,
    READY,
    allowed_next_statuses,
    can_transition,
)
from app.support.mpesa_order_link import (
    confirm_mpesa_receipt_for_order,
    link_mpesa_transaction_to_order,
    order_requires_mpesa_receipt_confirmation,
)
from app.services.image_generation_service import (
    ImageGenerationDisabled,
    ImageGenerationError,
    build_prompt_for_product,
    generate_product_image,
)
from app.services.inventory_stock_service import restore_stock_for_order
from app.services.product_media_service import (
    collect_store_media,
    is_image_media,
    sync_product_primary_image,
)
from app.services.email_service import EmailService
from app.services.email_templates import render_branded_email
from app.services.merchant_invite_email import (
    send_merchant_access_granted_email,
    send_merchant_user_invite_email,
)
from app.services.instagram_data_purge import InstagramDataPurgeService
from app.services.platform_instagram import (
    SUPPORTED_PLATFORMS,
    get_merchant_channel_account,
    list_merchant_connected_channels,
    normalize_platform,
)
from app.support.merchant_permissions import (
    MERCHANT_SECTION_LABELS,
    MERCHANT_SECTIONS,
    membership_role,
    serialize_allowed_sections,
    user_allowed_sections,
    with_active_account_context,
)
from app.support.user_invite_lookup import UserInviteLookupOut, lookup_user_for_merchant_invite

# Default "from" identity for platform test emails. The domain must be verified
# in Mailtrap for delivery to succeed.
TEST_EMAIL_FROM_ADDRESS = "no-reply@dukai.app"
TEST_EMAIL_FROM_NAME = "DUKAI PLATFORM"

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# --- Output schemas --------------------------------------------------------


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    email: str | None
    username: str | None
    phone: str | None
    user_role: str | None
    is_activated: bool
    require_change_password: bool
    onboarded_at: datetime | None
    created_at: datetime | None
    allowed_sections: list[str] = []


class AdminMerchantSummary(BaseModel):
    """One row in the merchants list — counts only, no nested users."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    business_name: str
    business_location: str
    business_category: str
    latitude: float | None
    longitude: float | None
    created_at: datetime | None
    updated_at: datetime | None
    users_count: int
    instagram_connected: bool
    instagram_username: str | None


class AdminMerchantChannel(BaseModel):
    platform: str
    label: str
    icon: str
    username: str | None
    display_name: str | None
    updated_at: datetime | None


class AdminMerchantDetail(BaseModel):
    """Single merchant including all users registered against it."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    business_name: str
    business_location: str
    business_category: str
    store_type: str = "retail"
    logo_url: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    created_at: datetime | None
    updated_at: datetime | None
    users: list[AdminUserOut]
    instagram_connected: bool
    instagram_username: str | None
    connected_channels: list[AdminMerchantChannel] = []


class AdminMerchantProfileUpdate(BaseModel):
    business_name: str = Field(min_length=1, max_length=255)
    business_location: str = Field(default="", max_length=255)
    business_category: str = Field(min_length=1, max_length=100)
    store_type: str = Field(default="retail", min_length=1, max_length=32)


class AdminMerchantProfileResponse(BaseModel):
    message: str
    data: AdminMerchantDetail


class AdminMerchantsResponse(BaseModel):
    data: list[AdminMerchantSummary]
    total: int


class AdminMerchantDetailResponse(BaseModel):
    data: AdminMerchantDetail


class AdminDetachMerchantChannelResponse(BaseModel):
    message: str
    platform: str


class AdminStatsResponse(BaseModel):
    merchants: int
    users: int
    super_admins: int
    instagram_accounts: int
    mpesa_daraja_configured: bool
    merchants_mpesa_configured: int
    google_maps_configured: bool
    ai_agent_configured: bool


class AdminOrderSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    account_id: str
    merchant_name: str | None
    order_number: str
    source: str
    fulfillment_type: str
    status: str
    customer_name: str | None
    customer_phone: str | None
    total: float
    currency: str
    payment_method: str | None
    items_count: int
    created_at: datetime | None
    updated_at: datetime | None
    placed_at: datetime | None
    completed_at: datetime | None
    cancelled_at: datetime | None


class AdminOrdersResponse(BaseModel):
    data: list[AdminOrderSummary]
    total: int


class AdminOrderDetailResponse(BaseModel):
    data: OrderOut
    merchant_name: str | None = None


class AdminOrderTransitionIn(BaseModel):
    to_status: str = Field(min_length=1, max_length=64)
    note: str | None = Field(default=None, max_length=1000)
    mpesa_receipt_number: str | None = Field(default=None, max_length=50)


class AdminResetUserPasswordIn(BaseModel):
    password: str = Field(min_length=8, max_length=72)
    require_change_password: bool = True


class AdminResetUserPasswordResponse(BaseModel):
    message: str
    user_id: str
    require_change_password: bool


class AdminSendPasswordResetLinkResponse(BaseModel):
    message: str
    user_id: str
    email: str


class AdminTestEmailIn(BaseModel):
    recipient: EmailStr | None = None


class AdminTestEmailResponse(BaseModel):
    message: str
    recipient: str
    from_address: str


class AdminSimulatePaymentIn(BaseModel):
    account_id: str = Field(min_length=1, max_length=64)
    phone_number: str = Field(min_length=9, max_length=20)
    amount: int = Field(ge=1, le=150000)
    mode: str = Field(default="live", pattern="^(live|instant)$")


class AdminSimulatePaymentResponse(BaseModel):
    message: str
    mode: str
    transaction_id: str
    status: str
    phone_number: str
    amount: int
    merchant_name: str
    payout_status: str | None = None
    payout_shortcode: str | None = None
    payout_result_desc: str | None = None
    mpesa_receipt_number: str | None = None


class AdminMerchantPayoutIn(BaseModel):
    account_id: str = Field(min_length=1, max_length=64)
    amount: int = Field(ge=1, le=150000)
    remarks: str | None = Field(default=None, max_length=200)


class AdminMerchantPayoutResponse(BaseModel):
    message: str
    transaction_id: str
    amount: int
    merchant_name: str
    payout_status: str | None = None
    payout_shortcode: str | None = None
    payout_shortcode_type: str | None = None
    payout_result_desc: str | None = None


class AdminMpesaTransactionOut(BaseModel):
    id: str
    merchant_id: str | None = None
    merchant_name: str | None = None
    merchant_has_mpesa: bool = False
    merchant_payout_shortcode: str | None = None
    merchant_payout_shortcode_type: str | None = None
    merchant_transaction_account: str | None = None
    phone_number: str
    amount: int
    account_reference: str
    transaction_desc: str
    status: str
    has_received_money: bool
    result_code: int | None = None
    result_desc: str | None = None
    mpesa_receipt_number: str | None = None
    checkout_request_id: str | None = None
    merchant_request_id: str | None = None
    order_id: str | None = None
    booking_id: str | None = None
    payout_status: str | None = None
    payout_shortcode: str | None = None
    payout_shortcode_type: str | None = None
    payout_amount: int | None = None
    payout_receipt_number: str | None = None
    payout_result_desc: str | None = None
    merchant_received_payout: bool = False
    can_send_to_merchant: bool = False
    can_unlock_payout: bool = False
    can_confirm_collection: bool = False
    can_query_safaricom: bool = False
    is_admin_payout: bool = False
    is_client_collection: bool = True
    completed_at: datetime | None = None
    payout_completed_at: datetime | None = None
    created_at: datetime | None = None


class AdminReleaseMpesaPayoutResponse(BaseModel):
    message: str
    transaction_id: str
    amount: int
    merchant_name: str | None = None
    payout_status: str | None = None
    payout_shortcode: str | None = None
    payout_shortcode_type: str | None = None
    payout_result_desc: str | None = None


class AdminMpesaTransactionsResponse(BaseModel):
    data: list[AdminMpesaTransactionOut]
    total: int


class AdminCreateSuperAdminIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=2, max_length=64, pattern=r"^[a-zA-Z0-9._-]+$")
    password: str = Field(min_length=8, max_length=72)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=20)
    require_change_password: bool = True


class AdminSuperAdminsResponse(BaseModel):
    data: list[AdminUserOut]
    total: int


class AdminCreateSuperAdminResponse(BaseModel):
    message: str
    data: AdminUserOut


class AdminCreateMerchantUserIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=20)
    password: str | None = Field(default=None, max_length=72)
    allowed_sections: list[str] = Field(min_length=1)
    require_change_password: bool = True
    send_invite_email: bool = False


class AdminCreateMerchantUserResponse(BaseModel):
    message: str
    data: AdminUserOut
    existing_user: bool = False


class AdminMerchantSectionsResponse(BaseModel):
    sections: list[dict[str, str]]


# --- Helpers ---------------------------------------------------------------


# Ambiguous characters (0/O, 1/l/I) are dropped so a temp password is easy to
# read off an email and type by hand.
def _admin_user_out(user: User) -> AdminUserOut:
    account_id = getattr(user, "_active_account_id", None)
    if account_id:
        with_active_account_context(user, str(account_id))
    return AdminUserOut(
        id=user.id,
        name=user.name,
        email=user.email,
        username=user.username,
        phone=user.phone,
        user_role=membership_role(user, str(account_id) if account_id else None),
        is_activated=bool(user.is_activated),
        require_change_password=bool(user.require_change_password),
        onboarded_at=user.onboarded_at,
        created_at=user.created_at,
        allowed_sections=user_allowed_sections(user),
    )


def _super_admin_users(db: Session) -> list[User]:
    """All platform super admins (no merchant account)."""
    rows = (
        db.query(User)
        .order_by(
            User.created_at.is_(None),
            User.created_at.desc(),
            User.id.desc(),
        )
        .all()
    )
    return [u for u in rows if u.is_super_admin()]


_ADMIN_PLATFORM_LABELS: dict[str, tuple[str, str]] = {
    "instagram": ("Instagram", "fab fa-instagram"),
    "facebook": ("Facebook", "fab fa-facebook"),
    "whatsapp": ("WhatsApp", "fab fa-whatsapp"),
    "tiktok": ("TikTok", "fab fa-tiktok"),
}


def _merchant_connected_channels(
    db: Session,
    account_id: str,
) -> list[AdminMerchantChannel]:
    channels = list_merchant_connected_channels(db, account_id)
    out: list[AdminMerchantChannel] = []
    for platform in SUPPORTED_PLATFORMS:
        row = channels.get(platform)
        if row is None:
            continue
        label, icon = _ADMIN_PLATFORM_LABELS[platform]
        out.append(
            AdminMerchantChannel(
                platform=platform,
                label=label,
                icon=icon,
                username=row.username,
                display_name=row.name,
                updated_at=row.updated_at,
            ),
        )
    return out


def _ig_lookup(db: Session) -> dict[str, InstagramAccount]:
    """Map ``user_id -> InstagramAccount`` for the latest IG per user.

    Used to flag whether each merchant has connected Instagram. There's
    one IG row per user in the current schema; if that changes the
    "latest by updated_at" tiebreak below already handles it.
    """
    rows = (
        db.query(InstagramAccount)
        .order_by(InstagramAccount.updated_at.desc(), InstagramAccount.id.desc())
        .all()
    )
    out: dict[str, InstagramAccount] = {}
    for row in rows:
        out.setdefault(row.user_id, row)
    return out


# --- Endpoints -------------------------------------------------------------


@router.get("/super-admins", response_model=AdminSuperAdminsResponse)
def list_super_admins(
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    users = _super_admin_users(db)
    return AdminSuperAdminsResponse(
        data=[AdminUserOut.model_validate(u) for u in users],
        total=len(users),
    )


@router.post("/super-admins", response_model=AdminCreateSuperAdminResponse)
def create_super_admin(
    payload: AdminCreateSuperAdminIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    """Create a platform super admin (admin console access only)."""
    username = payload.username.strip()
    existing_username = (
        db.query(User.id)
        .filter(func.lower(User.username) == username.lower())
        .first()
    )
    if existing_username is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="That username is already taken.",
        )

    email = (str(payload.email).strip().lower() if payload.email else None) or None
    if email:
        existing_email = db.query(User.id).filter(func.lower(User.email) == email).first()
        if existing_email is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="That email is already registered.",
            )

    now = datetime.now(timezone.utc)
    user = User(
        account_id=None,
        name=payload.name.strip(),
        username=username,
        email=email,
        phone=(payload.phone.strip() if payload.phone else None),
        password=hash_password(payload.password),
        user_role="super_admin",
        is_activated=True,
        require_change_password=payload.require_change_password,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return AdminCreateSuperAdminResponse(
        message="Super admin created successfully.",
        data=AdminUserOut.model_validate(user),
    )


@router.get("/stats", response_model=AdminStatsResponse)
def admin_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    merchants = db.query(func.count(Account.id)).scalar() or 0
    users = db.query(func.count(User.id)).scalar() or 0
    super_admin_roles = ["super_admin", "superadmin", "super-admin", "super admin"]
    super_admins = (
        db.query(func.count(User.id))
        .filter(func.lower(func.trim(User.user_role)).in_(super_admin_roles))
        .scalar()
        or 0
    )
    instagram_accounts = db.query(func.count(InstagramAccount.id)).scalar() or 0
    merchants_mpesa_configured = db.query(func.count(MerchantMpesaProfile.id)).scalar() or 0
    from app.support.daraja_sandbox import (
        build_daraja_production_config,
        build_daraja_sandbox_config,
        daraja_env_configured,
    )

    env_config = (
        build_daraja_sandbox_config()
        if mpesa_service.use_mpesa_sandbox(db)
        else build_daraja_production_config()
    )
    mpesa_daraja_configured = daraja_env_configured(env_config)
    google_maps_configured = (
        db.query(func.count(GoogleMapsConfiguration.id))
        .filter(GoogleMapsConfiguration.is_active.is_(True))
        .scalar()
        or 0
    ) > 0
    if not google_maps_configured:
        from app.api.v1.google_maps import resolve_api_key

        google_maps_configured = bool(resolve_api_key(db))
    ai_agent_configured = (
        db.query(func.count(AiAgentConfiguration.id))
        .filter(AiAgentConfiguration.is_active.is_(True))
        .scalar()
        or 0
    ) > 0
    if not ai_agent_configured:
        from app.services.ai_agent_config import resolve_openai_api_key

        ai_agent_configured = bool(resolve_openai_api_key(db))
    return AdminStatsResponse(
        merchants=int(merchants),
        users=int(users),
        super_admins=int(super_admins),
        instagram_accounts=int(instagram_accounts),
        mpesa_daraja_configured=bool(mpesa_daraja_configured),
        merchants_mpesa_configured=int(merchants_mpesa_configured),
        google_maps_configured=bool(google_maps_configured),
        ai_agent_configured=bool(ai_agent_configured),
    )


@router.get("/merchants", response_model=AdminMerchantsResponse)
def list_merchants(
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    accounts: list[Account] = (
        db.query(Account)
        .order_by(
            Account.created_at.is_(None),
            Account.created_at.desc(),
            Account.id.desc(),
        )
        .all()
    )

    data: list[AdminMerchantSummary] = []
    for account in accounts:
        users_count = (
            db.query(UserMembership.id)
            .filter(
                UserMembership.account_id == account.id,
                UserMembership.is_active.is_(True),
            )
            .count()
        )
        ig_row = get_merchant_channel_account(db, account.id, "instagram")
        data.append(
            AdminMerchantSummary(
                id=account.id,
                business_name=account.business_name,
                business_location=account.business_location,
                business_category=account.business_category,
                latitude=account.latitude,
                longitude=account.longitude,
                created_at=account.created_at,
                updated_at=account.updated_at,
                users_count=users_count,
                instagram_connected=ig_row is not None,
                instagram_username=ig_row.username if ig_row else None,
            ),
        )

    return AdminMerchantsResponse(data=data, total=len(data))


class AdminMerchantCoordsUpdate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    business_location: str | None = Field(default=None, max_length=255)


class AdminMerchantCoordsResponse(BaseModel):
    message: str
    id: str
    latitude: float
    longitude: float
    business_location: str


@router.patch(
    "/merchants/{merchant_id}/coords",
    response_model=AdminMerchantCoordsResponse,
)
def update_merchant_coords(
    merchant_id: str,
    payload: AdminMerchantCoordsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    _: User = Depends(require_super_admin),
):
    """Persist geocoded merchant coordinates so the admin map never re-geocodes."""
    validate_csrf(request, session)
    account = db.query(Account).filter(Account.id == merchant_id).first()
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Merchant not found.")

    account.latitude = payload.latitude
    account.longitude = payload.longitude
    if payload.business_location and payload.business_location.strip():
        account.business_location = payload.business_location.strip()[:255]
    db.commit()
    db.refresh(account)

    return AdminMerchantCoordsResponse(
        message="Merchant coordinates saved.",
        id=account.id,
        latitude=float(account.latitude),
        longitude=float(account.longitude),
        business_location=account.business_location,
    )


@router.get("/orders", response_model=AdminOrdersResponse)
def list_orders(
    q: str | None = None,
    status_filter: str | None = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    cap = max(1, min(int(limit or 200), 1000))
    query = (
        db.query(Order)
        .outerjoin(Account, Order.account_id == Account.id)
        .options(joinedload(Order.account), joinedload(Order.items))
        .order_by(
            Order.created_at.is_(None),
            Order.created_at.desc(),
            Order.id.desc(),
        )
    )
    if status_filter:
        query = query.filter(func.lower(Order.status) == status_filter.strip().lower())

    if q and q.strip():
        term = f"%{q.strip()}%"
        from sqlalchemy import or_

        query = query.filter(
            or_(
                Order.order_number.ilike(term),
                Order.customer_name.ilike(term),
                Order.customer_phone.ilike(term),
                Account.business_name.ilike(term),
            ),
        )

    rows: list[Order] = query.limit(cap).all()
    data = [
        AdminOrderSummary(
            id=row.id,
            account_id=row.account_id,
            merchant_name=row.account.business_name if row.account else None,
            order_number=row.order_number,
            source=row.source,
            fulfillment_type=row.fulfillment_type,
            status=row.status,
            customer_name=row.customer_name,
            customer_phone=row.customer_phone,
            total=float(row.total or 0),
            currency=row.currency,
            payment_method=row.payment_method,
            items_count=len(row.items or []),
            created_at=row.created_at,
            updated_at=row.updated_at,
            placed_at=row.placed_at,
            completed_at=row.completed_at,
            cancelled_at=row.cancelled_at,
        )
        for row in rows
    ]
    return AdminOrdersResponse(data=data, total=len(data))


@router.get("/orders/{order_id}", response_model=AdminOrderDetailResponse)
def order_detail(
    order_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    row = (
        db.query(Order)
        .options(
            joinedload(Order.account),
            joinedload(Order.items),
            joinedload(Order.status_history),
            joinedload(Order.mpesa_transaction),
            joinedload(Order.mpesa_transactions),
            joinedload(Order.assigned_rider),
        )
        .filter(Order.id == order_id)
        .first()
    )
    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )
    profile = mpesa_service.get_merchant_profile(db, row.account_id) if row.account_id else None
    return AdminOrderDetailResponse(
        data=attach_order_mpesa_settlement(OrderOut.from_model(row), profile),
        merchant_name=row.account.business_name if row.account else None,
    )


@router.post("/orders/{order_id}/transition")
def transition_order_admin(
    order_id: str,
    payload: AdminOrderTransitionIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    admin: User = Depends(require_super_admin),
):
    validate_csrf(request, session)
    row = (
        db.query(Order)
        .options(
            joinedload(Order.account),
            joinedload(Order.items),
            joinedload(Order.status_history),
            joinedload(Order.mpesa_transaction),
            joinedload(Order.mpesa_transactions),
            joinedload(Order.assigned_rider),
        )
        .filter(Order.id == order_id)
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Order not found.")

    target = payload.to_status.strip()
    if row.status == target:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Order is already {target}.",
        )
    if not can_transition(row.status, target, row.fulfillment_type):
        legal = ", ".join(allowed_next_statuses(row.status, row.fulfillment_type)) or "no further moves"
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Cannot move from '{row.status}' to '{target}'. Allowed: {legal}.",
        )
    if target in (DELIVERED, PICKED_UP):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Use Confirm delivery / Confirm handover to close this order.",
        )
    if target == OUT_FOR_DELIVERY and order_needs_delivery_details(row):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Customer delivery details are required before dispatch.",
        )

    transition_note = (payload.note or "").strip() or None
    if target == CANCELLED:
        if not transition_note:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A rejection reason is required when cancelling an order.",
            )
    if target == PAYMENT_RECEIVED and order_requires_mpesa_receipt_confirmation(row):
        receipt = (payload.mpesa_receipt_number or "").strip()
        if receipt:
            try:
                matched_txn = confirm_mpesa_receipt_for_order(
                    db,
                    row,
                    receipt,
                    confirmed_by_user_id=admin.id,
                )
            except ValueError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
            link_mpesa_transaction_to_order(db, row, matched_txn)
            transition_note = (
                transition_note
                or f"M-PESA payment confirmed. Receipt {matched_txn.mpesa_receipt_number}."
            )
        else:
            transition_note = (
                transition_note
                or "Super admin marked payment as received (receipt validation skipped)."
            )

    now = datetime.utcnow()
    previous = row.status
    row.status = target
    row.updated_at = now
    if target == PAYMENT_RECEIVED and not row.paid_at:
        row.paid_at = now
    if target == BEING_PREPARED and not row.prepared_at:
        row.prepared_at = now
    if target == READY and not row.ready_at:
        row.ready_at = now
    if target == OUT_FOR_DELIVERY and not row.dispatched_at:
        row.dispatched_at = now
    if target in (DELIVERED, PICKED_UP) and not row.completed_at:
        row.completed_at = now
    if target == CANCELLED and not row.cancelled_at:
        row.cancelled_at = now
        if row.stock_deducted:
            restore_stock_for_order(db, row)
            row.stock_deducted = False

    db.add(
        OrderStatusHistory(
            order_id=row.id,
            from_status=previous,
            to_status=target,
            changed_by_user_id=admin.id,
            note=transition_note,
            created_at=now,
        ),
    )
    db.commit()
    db.refresh(row)
    db.refresh(
        row,
        attribute_names=["items", "status_history", "mpesa_transaction", "mpesa_transactions"],
    )
    if target == READY and row.fulfillment_type == "delivery" and not row.assigned_rider_id:
        from app.services.rider_trip_service import RiderTripService

        try:
            RiderTripService(db).fan_out_offers_for_ready_order(row)
        except Exception:
            logger.exception("Failed to fan out rider offers for order %s", row.id)
    return {
        "message": f"Order moved to {target}.",
        "data": OrderOut.from_model(
            row,
            allowed_next=allowed_next_statuses(row.status, row.fulfillment_type),
        ),
    }


def _admin_merchant_detail(db: Session, account: Account) -> AdminMerchantDetail:
    users = (
        db.query(User)
        .join(UserMembership, UserMembership.user_id == User.id)
        .options(joinedload(User.memberships).joinedload(UserMembership.account))
        .filter(
            UserMembership.account_id == account.id,
            UserMembership.is_active.is_(True),
        )
        .all()
    )
    for user in users:
        setattr(user, "_active_account_id", account.id)
    users = sorted(users, key=lambda u: (u.created_at or datetime.min))

    connected_channels = _merchant_connected_channels(db, account.id)
    ig_row = get_merchant_channel_account(db, account.id, "instagram")

    return AdminMerchantDetail(
        id=account.id,
        business_name=account.business_name,
        business_location=account.business_location or "",
        business_category=account.business_category or "",
        store_type=(account.store_type or "retail").strip().lower() or "retail",
        logo_url=account.logo_url,
        latitude=account.latitude,
        longitude=account.longitude,
        created_at=account.created_at,
        updated_at=account.updated_at,
        users=[_admin_user_out(u) for u in users],
        instagram_connected=ig_row is not None,
        instagram_username=ig_row.username if ig_row else None,
        connected_channels=connected_channels,
    )


@router.get("/merchants/{merchant_id}", response_model=AdminMerchantDetailResponse)
def merchant_detail(
    merchant_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    account = (
        db.query(Account)
        .filter(Account.id == merchant_id)
        .first()
    )
    if account is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Merchant not found.",
        )

    return AdminMerchantDetailResponse(data=_admin_merchant_detail(db, account))


@router.patch(
    "/merchants/{merchant_id}/profile",
    response_model=AdminMerchantProfileResponse,
)
def update_merchant_profile(
    merchant_id: str,
    payload: AdminMerchantProfileUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    _: User = Depends(require_super_admin),
):
    """Update merchant identity, store type, and what they sell."""
    validate_csrf(request, session)
    account = db.query(Account).filter(Account.id == merchant_id).first()
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Merchant not found.")

    name = payload.business_name.strip()
    location = (payload.business_location or "").strip()
    category = payload.business_category.strip()
    store_type = payload.store_type.strip().lower()

    if not name:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Business name is required.",
        )
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
    account.business_location = location[:255]
    account.business_category = category
    account.store_type = store_type
    account.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(account)

    return AdminMerchantProfileResponse(
        message="Merchant profile saved.",
        data=_admin_merchant_detail(db, account),
    )


@router.delete(
    "/merchants/{merchant_id}/channels/{platform}",
    response_model=AdminDetachMerchantChannelResponse,
)
def detach_merchant_channel(
    merchant_id: str,
    platform: str,
    request: Request,
    db: Session = Depends(get_db),
    services: ServiceContainer = Depends(get_services),
    session: dict = Depends(get_request_session),
    _: User = Depends(require_super_admin),
):
    """Remove a merchant's connected social channel (Instagram, WhatsApp, etc.)."""
    validate_csrf(request, session)
    platform = normalize_platform(platform)
    label = _ADMIN_PLATFORM_LABELS[platform][0]

    account = db.query(Account).filter(Account.id == merchant_id).first()
    if account is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Merchant not found.",
        )

    channel = get_merchant_channel_account(db, merchant_id, platform)
    if channel is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=f"No {label} account is connected for this merchant.",
        )

    purge = InstagramDataPurgeService(
        services.db,
        services.settings,
        services.instagram_api,
    )
    if platform == "instagram":
        purge.purge_account(channel, source="admin_detach")
    else:
        purge._prepare_account_for_deletion(channel)
        db.delete(channel)
    db.commit()

    return AdminDetachMerchantChannelResponse(
        message=f"{label} was detached from this merchant.",
        platform=platform,
    )


@router.get(
    "/merchants/{merchant_id}/users/sections",
    response_model=AdminMerchantSectionsResponse,
)
def merchant_user_sections(
    merchant_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    account = db.query(Account).filter(Account.id == merchant_id).first()
    if account is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Merchant not found.",
        )
    return AdminMerchantSectionsResponse(
        sections=[
            {"key": key, "label": MERCHANT_SECTION_LABELS[key]}
            for key in MERCHANT_SECTIONS
        ],
    )


@router.get(
    "/merchants/{merchant_id}/users/lookup",
    response_model=UserInviteLookupOut,
)
def lookup_merchant_user_invite(
    merchant_id: str,
    email: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    account = db.query(Account).filter(Account.id == merchant_id).first()
    if account is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Merchant not found.",
        )
    return lookup_user_for_merchant_invite(db, email, merchant_id)


@router.post(
    "/merchants/{merchant_id}/users",
    response_model=AdminCreateMerchantUserResponse,
)
def create_merchant_user(
    merchant_id: str,
    payload: AdminCreateMerchantUserIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    """Invite a staff user to a merchant's dashboard."""
    account = db.query(Account).filter(Account.id == merchant_id).first()
    if account is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Merchant not found.",
        )

    email = str(payload.email).strip().lower()
    existing_user = db.query(User).filter(func.lower(User.email) == email).first()

    allowed = serialize_allowed_sections(payload.allowed_sections)
    if not allowed:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Select at least one dashboard section.",
        )

    now = datetime.now(timezone.utc)
    is_existing_user = existing_user is not None
    user = existing_user
    if user is None:
        password = (payload.password or "").strip()
        if len(password) < 8:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A temporary password is required for new team members.",
            )
        user = User(
            account_id=merchant_id,
            name=payload.name.strip(),
            email=email,
            phone=(payload.phone.strip() if payload.phone else None),
            password=hash_password(password),
            user_role="staff",
            allowed_sections=allowed,
            is_activated=True,
            require_change_password=payload.require_change_password,
            created_at=now,
            updated_at=now,
        )
        db.add(user)
        db.flush()
    else:
        if payload.name.strip():
            user.name = payload.name.strip()
        if payload.phone is not None:
            user.phone = payload.phone.strip() or None
        user.updated_at = now
        db.add(user)

    existing_membership = (
        db.query(UserMembership)
        .filter(
            UserMembership.user_id == user.id,
            UserMembership.account_id == merchant_id,
        )
        .first()
    )
    if existing_membership is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="That user already belongs to this merchant.",
        )
    db.add(
        UserMembership(
            user_id=user.id,
            account_id=merchant_id,
            role="staff",
            allowed_sections=allowed,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()
    db.refresh(user)
    setattr(user, "_active_account_id", merchant_id)

    message = (
        "Existing user added to this merchant. They can sign in with their current password."
        if is_existing_user
        else "Team member invited successfully."
    )
    if payload.send_invite_email:
        if is_existing_user:
            send_merchant_access_granted_email(db, user, account)
            message = (
                f"Existing user added. Access notification sent to {user.email}."
            )
        else:
            send_merchant_user_invite_email(db, user)
            message = f"Team member invited. Setup email sent to {user.email}."

    return AdminCreateMerchantUserResponse(
        message=message,
        data=_admin_user_out(user),
        existing_user=is_existing_user,
    )


@router.post(
    "/merchants/{merchant_id}/users/{user_id}/password",
    response_model=AdminResetUserPasswordResponse,
)
def reset_merchant_user_password(
    merchant_id: str,
    user_id: str,
    payload: AdminResetUserPasswordIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    account = db.query(Account).filter(Account.id == merchant_id).first()
    if account is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Merchant not found.",
        )

    user = (
        db.query(User)
        .join(UserMembership, UserMembership.user_id == User.id)
        .filter(
            User.id == user_id,
            UserMembership.account_id == merchant_id,
            UserMembership.is_active.is_(True),
        )
        .first()
    )
    if user is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="User not found for this merchant.",
        )
    if user.is_super_admin():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Super admin passwords cannot be changed from this screen.",
        )

    user.password = hash_password(payload.password)
    user.require_change_password = payload.require_change_password
    user.updated_at = datetime.utcnow()
    db.add(user)
    db.commit()

    return AdminResetUserPasswordResponse(
        message="Password reset successfully.",
        user_id=user.id,
        require_change_password=user.require_change_password,
    )


@router.post(
    "/merchants/{merchant_id}/users/{user_id}/password/reset-link",
    response_model=AdminSendPasswordResetLinkResponse,
)
def send_user_password_reset_link(
    merchant_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    """Set a random temporary password and email the user a reset link.

    The user receives a temporary password plus a signed, time-limited link to
    a public page where they choose their own password. The temporary password
    is only committed once Mailtrap accepts the email, so a send failure leaves
    the existing password untouched.
    """
    account = db.query(Account).filter(Account.id == merchant_id).first()
    if account is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Merchant not found.",
        )

    user = (
        db.query(User)
        .join(UserMembership, UserMembership.user_id == User.id)
        .filter(
            User.id == user_id,
            UserMembership.account_id == merchant_id,
            UserMembership.is_active.is_(True),
        )
        .first()
    )
    if user is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="User not found for this merchant.",
        )
    if user.is_super_admin():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Super admin passwords cannot be changed from this screen.",
        )
    if not user.email:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="This user has no email address on file, so a reset link can't be sent.",
        )

    send_merchant_user_invite_email(db, user)

    return AdminSendPasswordResetLinkResponse(
        message=f"Password reset link sent to {user.email}.",
        user_id=user.id,
        email=user.email or "",
    )


@router.post("/test-email", response_model=AdminTestEmailResponse)
def send_test_email(
    payload: AdminTestEmailIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
):
    """Send a test email from no-reply@dukai.app to verify Mailtrap is wired up.

    Defaults to the requesting super admin's own email when no recipient is
    given.
    """
    recipient = (payload.recipient or admin.email or "").strip()
    if not recipient:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="No recipient provided and your account has no email on file.",
        )

    service = EmailService()
    if not service.settings.mail_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email sending is disabled. Set MAIL_ENABLED=true to send.",
        )
    if not service.configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mailtrap is not configured. Set MAILTRAP_API_TOKEN to send.",
        )

    html = render_branded_email(
        title="DukAI test email",
        heading="Your email setup is working",
        intro=(
            "This is a test message from DukAI. If it landed in your inbox, "
            "Mailtrap sending is configured correctly."
        ),
        details=[
            ("Sent from", TEST_EMAIL_FROM_ADDRESS),
            ("Delivered to", recipient),
        ],
        footer_note="This is a one-off test triggered from the DukAI admin settings.",
    )
    sent = service.send_email(
        to=recipient,
        subject="DukAI test email",
        text=(
            "This is a test email from DukAI.\n\n"
            "If you received this, Mailtrap sending is configured correctly."
        ),
        html=html,
        category="admin-test",
        from_address=TEST_EMAIL_FROM_ADDRESS,
        from_name=TEST_EMAIL_FROM_NAME,
    )
    if not sent:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Mailtrap rejected the email. Check that the sending domain "
                f"({TEST_EMAIL_FROM_ADDRESS.split('@')[-1]}) is verified and the "
                "recipient is allowed. See server logs for the exact reason."
            ),
        )

    return AdminTestEmailResponse(
        message=f"Test email sent to {recipient}.",
        recipient=recipient,
        from_address=TEST_EMAIL_FROM_ADDRESS,
    )


@router.post("/simulate-payment", response_model=AdminSimulatePaymentResponse)
def simulate_payment(
    payload: AdminSimulatePaymentIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    admin: User = Depends(require_super_admin),
):
    """Simulate hub collection from a client phone, then payout to a merchant store.

    Modes:
    - ``live``: real STK push to the client; on success, B2B payout is forced to
      the merchant even if auto-payout is disabled.
    - ``instant``: mark collection as successful immediately and force B2B payout
      (dev runtime only — avoids paying out funds that were never collected).
    """
    from app.services import mpesa_payout_service
    from app.services.mpesa_service import MpesaApiError
    from app.services.platform_runtime import is_dev_runtime
    from app.support.daraja_sandbox import SANDBOX_TEST_MSISDN

    validate_csrf(request, session)

    account = db.query(Account).filter(Account.id == payload.account_id).first()
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Merchant not found.")

    profile = mpesa_service.get_merchant_profile(db, account.id)
    destination = mpesa_payout_service.merchant_payout_destination(profile)
    if not destination:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{account.business_name} has no payout destination configured. "
                "Add a Pochi la Biashara phone, M-PESA phone, Till, or Paybill in merchant M-PESA settings first."
            ),
        )

    mode = payload.mode.strip().lower()
    if mode == "instant" and not is_dev_runtime(db):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                "Instant simulation is only available in platform Dev mode. "
                "Use Live STK, or switch to Dev mode first."
            ),
        )

    phone = payload.phone_number.strip() or (
        SANDBOX_TEST_MSISDN if is_dev_runtime(db) else ""
    )
    if not phone:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Client phone number is required.",
        )

    try:
        if mode == "instant":
            txn = mpesa_service.simulate_successful_collection(
                db,
                account_id=account.id,
                phone_number=phone,
                amount=payload.amount,
                initiated_by_user_id=admin.id,
            )
            txn = mpesa_payout_service.queue_payout_for_collection(
                db,
                txn,
                force=True,
            ) or txn
            db.commit()
            db.refresh(txn)
            message = (
                f"Simulated KES {txn.amount} from {txn.phone_number} "
                f"and queued payout to {account.business_name}."
            )
        else:
            txn = mpesa_service.stk_push(
                db,
                phone_number=phone,
                amount=payload.amount,
                account_reference=account.business_name[:12] or "DUKAI",
                transaction_desc="Admin simulate",
                initiated_by_user_id=admin.id,
                account_id=account.id,
            )
            txn = mpesa_service.mark_admin_force_payout(db, txn)
            message = (
                f"STK push sent to {txn.phone_number} for KES {txn.amount}. "
                f"When paid, funds will be sent to {account.business_name}."
            )
    except MpesaApiError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return AdminSimulatePaymentResponse(
        message=message,
        mode=mode,
        transaction_id=txn.id,
        status=txn.status,
        phone_number=txn.phone_number,
        amount=int(txn.amount),
        merchant_name=account.business_name,
        payout_status=txn.payout_status,
        payout_shortcode=txn.payout_shortcode,
        payout_result_desc=txn.payout_result_desc,
        mpesa_receipt_number=txn.mpesa_receipt_number,
    )


@router.post("/merchant-payout", response_model=AdminMerchantPayoutResponse)
def merchant_payout(
    payload: AdminMerchantPayoutIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    admin: User = Depends(require_super_admin),
):
    """Send money from the DukAI hub Paybill to a merchant (B2B only)."""
    from app.services import mpesa_payout_service
    from app.services.mpesa_service import MpesaApiError

    validate_csrf(request, session)

    account = db.query(Account).filter(Account.id == payload.account_id).first()
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Merchant not found.")

    profile = mpesa_service.get_merchant_profile(db, account.id)
    destination = mpesa_payout_service.merchant_payout_destination(profile)
    if not destination:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{account.business_name} has no payout destination configured. "
                "Add a Till, Paybill, Pochi, or M-PESA phone in merchant M-PESA settings first."
            ),
        )

    try:
        txn = mpesa_payout_service.create_admin_merchant_payout(
            db,
            account_id=account.id,
            amount=payload.amount,
            initiated_by_user_id=admin.id,
            remarks=(payload.remarks or "").strip() or "Admin merchant payout",
        )
    except MpesaApiError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    payout_type, payout_shortcode = destination[1], destination[0]
    if txn.payout_status == "skipped" or txn.payout_status == "failed":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=txn.payout_result_desc or "Merchant payout could not be sent.",
        )

    return AdminMerchantPayoutResponse(
        message=(
            f"Queued KES {txn.amount} payout to {account.business_name} "
            f"({payout_type} {payout_shortcode})."
        ),
        transaction_id=txn.id,
        amount=int(txn.amount),
        merchant_name=account.business_name,
        payout_status=txn.payout_status,
        payout_shortcode=txn.payout_shortcode or payout_shortcode,
        payout_shortcode_type=txn.payout_shortcode_type or payout_type,
        payout_result_desc=txn.payout_result_desc,
    )


@router.get("/mpesa-transactions", response_model=AdminMpesaTransactionsResponse)
def list_mpesa_transactions(
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
    limit: int = 200,
    status_filter: str | None = None,
):
    """Platform-wide M-PESA collections and payouts for admin audit."""
    del admin  # auth gate only
    limit = max(1, min(limit, 500))
    query = db.query(MpesaTransaction).order_by(
        MpesaTransaction.created_at.is_(None),
        MpesaTransaction.created_at.desc(),
        MpesaTransaction.id.desc(),
    )
    if status_filter and status_filter.strip().lower() not in {"", "all"}:
        query = query.filter(MpesaTransaction.status == status_filter.strip().lower())
    rows = query.limit(limit).all()

    account_ids = {t.account_id for t in rows if t.account_id}
    accounts: dict[str, Account] = {}
    profiles: dict[str, MerchantMpesaProfile] = {}
    if account_ids:
        for account in db.query(Account).filter(Account.id.in_(account_ids)).all():
            accounts[account.id] = account
        for profile in (
            db.query(MerchantMpesaProfile)
            .filter(MerchantMpesaProfile.account_id.in_(account_ids))
            .all()
        ):
            profiles[profile.account_id] = profile

    data: list[AdminMpesaTransactionOut] = []
    for txn in rows:
        account = accounts.get(txn.account_id) if txn.account_id else None
        profile = profiles.get(txn.account_id) if txn.account_id else None
        payload = txn.callback_payload if isinstance(txn.callback_payload, dict) else {}
        is_admin_payout = bool(payload.get("admin_merchant_payout"))
        has_received = (
            txn.status == "success"
            and (
                bool((txn.mpesa_receipt_number or "").strip())
                or bool(payload.get("admin_simulate"))
                or bool(payload.get("safaricom_confirmed"))
                or is_admin_payout
            )
        )
        # Safaricom can still be asked about any STK we have a checkout id for.
        can_query_safaricom = (
            not is_admin_payout
            and not has_received
            and bool((txn.checkout_request_id or "").strip())
            and not (txn.checkout_request_id or "").startswith(("ADMIN-SIM-", "ADMIN-PAYOUT-"))
        )
        can_send = (
            not is_admin_payout
            and has_received
            and profile is not None
            and (txn.payout_status or "") not in {"success", "queued", "pending"}
        )
        can_unlock = (
            not is_admin_payout
            and has_received
            and (txn.payout_status or "") in {"queued", "pending"}
        )
        can_confirm = (
            not is_admin_payout
            and not has_received
            and (txn.status or "") in {"pending", "failed", "cancelled", "success"}
        )
        data.append(
            AdminMpesaTransactionOut(
                id=txn.id,
                merchant_id=txn.account_id,
                merchant_name=account.business_name if account else None,
                merchant_has_mpesa=profile is not None,
                merchant_payout_shortcode=profile.shortcode if profile else None,
                merchant_payout_shortcode_type=profile.shortcode_type if profile else None,
                merchant_transaction_account=profile.account_number if profile else None,
                phone_number=txn.phone_number,
                amount=int(txn.amount),
                account_reference=txn.account_reference,
                transaction_desc=txn.transaction_desc,
                status=txn.status,
                has_received_money=has_received,
                result_code=txn.result_code,
                result_desc=txn.result_desc,
                mpesa_receipt_number=txn.mpesa_receipt_number,
                checkout_request_id=txn.checkout_request_id,
                merchant_request_id=txn.merchant_request_id,
                order_id=txn.order_id,
                booking_id=txn.booking_id,
                payout_status=txn.payout_status,
                payout_shortcode=txn.payout_shortcode,
                payout_shortcode_type=txn.payout_shortcode_type,
                payout_amount=txn.payout_amount,
                payout_receipt_number=txn.payout_receipt_number,
                payout_result_desc=txn.payout_result_desc,
                merchant_received_payout=txn.payout_status == "success",
                can_send_to_merchant=can_send,
                can_unlock_payout=can_unlock,
                can_confirm_collection=can_confirm,
                can_query_safaricom=can_query_safaricom,
                is_admin_payout=is_admin_payout,
                is_client_collection=not is_admin_payout,
                completed_at=txn.completed_at,
                payout_completed_at=txn.payout_completed_at,
                created_at=txn.created_at,
            ),
        )

    return AdminMpesaTransactionsResponse(data=data, total=len(data))


@router.post(
    "/mpesa-transactions/{transaction_id}/release",
    response_model=AdminReleaseMpesaPayoutResponse,
)
def release_mpesa_collection_to_merchant(
    transaction_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    admin: User = Depends(require_super_admin),
):
    """Send a received Client → DukAI collection to the merchant (manual B2B)."""
    from app.services import mpesa_payout_service
    from app.services.mpesa_service import MpesaApiError

    del admin  # auth gate only
    validate_csrf(request, session)

    try:
        txn = mpesa_payout_service.release_collection_to_merchant(
            db,
            transaction_id=transaction_id,
        )
    except MpesaApiError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    account = (
        db.query(Account).filter(Account.id == txn.account_id).first()
        if txn.account_id
        else None
    )
    merchant_name = account.business_name if account else None
    dest_type = txn.payout_shortcode_type or "destination"
    dest_code = txn.payout_shortcode or "—"

    return AdminReleaseMpesaPayoutResponse(
        message=(
            f"Queued KES {int(txn.amount)} to {merchant_name or 'merchant'} "
            f"({dest_type} {dest_code})."
        ),
        transaction_id=txn.id,
        amount=int(txn.amount),
        merchant_name=merchant_name,
        payout_status=txn.payout_status,
        payout_shortcode=txn.payout_shortcode,
        payout_shortcode_type=txn.payout_shortcode_type,
        payout_result_desc=txn.payout_result_desc,
    )


class AdminUnlockMpesaPayoutResponse(BaseModel):
    message: str
    transaction_id: str
    payout_status: str | None = None
    payout_result_desc: str | None = None


@router.post(
    "/mpesa-transactions/{transaction_id}/unlock",
    response_model=AdminUnlockMpesaPayoutResponse,
)
def unlock_mpesa_payout(
    transaction_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    admin: User = Depends(require_super_admin),
):
    """Mark a stuck pending/queued payout as failed so Retry send appears."""
    from app.services import mpesa_payout_service
    from app.services.mpesa_service import MpesaApiError

    del admin
    validate_csrf(request, session)

    try:
        txn = mpesa_payout_service.unlock_payout_for_retry(
            db,
            transaction_id=transaction_id,
        )
    except MpesaApiError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return AdminUnlockMpesaPayoutResponse(
        message="Payout unlocked. You can Retry send to merchant.",
        transaction_id=txn.id,
        payout_status=txn.payout_status,
        payout_result_desc=txn.payout_result_desc,
    )


class AdminQuerySafaricomResponse(BaseModel):
    message: str
    transaction_id: str
    outcome: str
    status: str
    result_desc: str | None = None


@router.post(
    "/mpesa-transactions/{transaction_id}/query-safaricom",
    response_model=AdminQuerySafaricomResponse,
)
def query_mpesa_collection_with_safaricom(
    transaction_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    admin: User = Depends(require_super_admin),
):
    """Settle a stuck collection from Safaricom's own answer, without paying out.

    Covers the lost-callback case: Safaricom took the payment but its result
    never reached us. The payout stays manual so money only moves on a
    deliberate Send to merchant.
    """
    from app.services.mpesa_service import MpesaApiError

    del admin  # auth gate only
    validate_csrf(request, session)

    txn = db.query(MpesaTransaction).filter(MpesaTransaction.id == transaction_id).first()
    if txn is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Transaction not found.")
    if not (txn.checkout_request_id or "").strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="This record has no CheckoutRequestID, so Safaricom cannot be asked about it.",
        )

    try:
        outcome = mpesa_service.refresh_pending_stk(db, txn, auto_payout=False)
    except MpesaApiError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    if outcome == "paid":
        message = (
            f"Safaricom confirms the customer paid KES {int(txn.amount)}. "
            "Marked as received at DukAI — use Send to merchant to release it."
        )
    elif outcome == "failed":
        message = (
            "Safaricom says this payment did not go through: "
            f"{txn.result_desc or 'no further detail'}."
        )
    else:
        message = (
            "Safaricom is still processing this request. Try again shortly — "
            "if it never resolves, use Fix payment with the customer's SMS code."
        )

    return AdminQuerySafaricomResponse(
        message=message,
        transaction_id=txn.id,
        outcome=outcome,
        status=txn.status,
        result_desc=txn.result_desc,
    )


class AdminConfirmMpesaCollectionIn(BaseModel):
    mpesa_receipt_number: str = Field(min_length=6, max_length=50)


class AdminConfirmMpesaCollectionResponse(BaseModel):
    message: str
    transaction_id: str
    status: str
    mpesa_receipt_number: str | None = None
    order_id: str | None = None


@router.post(
    "/mpesa-transactions/{transaction_id}/confirm",
    response_model=AdminConfirmMpesaCollectionResponse,
)
def confirm_mpesa_collection(
    transaction_id: str,
    payload: AdminConfirmMpesaCollectionIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    admin: User = Depends(require_super_admin),
):
    """Fix a failed or stuck Client → DukAI collection using the customer's SMS code."""
    from app.services.mpesa_service import MpesaApiError

    validate_csrf(request, session)
    try:
        txn = mpesa_service.confirm_collection_manually(
            db,
            transaction_id=transaction_id,
            receipt_number=payload.mpesa_receipt_number,
            confirmed_by_user_id=admin.id,
        )
    except MpesaApiError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return AdminConfirmMpesaCollectionResponse(
        message=(
            f"Marked KES {int(txn.amount)} as paid. Receipt {txn.mpesa_receipt_number}. "
            "You can now send it to the merchant if needed."
        ),
        transaction_id=txn.id,
        status=txn.status,
        mpesa_receipt_number=txn.mpesa_receipt_number,
        order_id=txn.order_id,
    )


class AdminMpesaBalanceOut(BaseModel):
    id: str | None = None
    shortcode: str | None = None
    status: str | None = None
    working_balance: str | None = None
    utility_balance: str | None = None
    charges_balance: str | None = None
    balances_raw: str | None = None
    result_desc: str | None = None
    requested_at: datetime | None = None
    completed_at: datetime | None = None
    credentials_configured: bool = False


class AdminMpesaBalanceResponse(BaseModel):
    data: AdminMpesaBalanceOut
    message: str | None = None


@router.get("/mpesa-balance", response_model=AdminMpesaBalanceResponse)
def get_mpesa_hub_balance(
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
):
    """Latest known DukAI hub Account Balance (from Daraja)."""
    from app.services import mpesa_balance_service, mpesa_payout_service
    from app.services.mpesa_service import resolve_mpesa_config

    del admin
    credentials_configured = False
    shortcode: str | None = None
    try:
        config = resolve_mpesa_config(db)
        shortcode = (config.shortcode or "").strip() or None
        credentials_configured = mpesa_payout_service._resolve_b2b_credentials(config) is not None
    except Exception:
        credentials_configured = False

    # Self-heal queries whose result callback never arrived, so the panel
    # stops showing "Checking…" and the button becomes usable again.
    mpesa_balance_service.expire_stale_pending(db)

    latest = mpesa_balance_service.get_latest_balance(db)
    if latest is None:
        return AdminMpesaBalanceResponse(
            data=AdminMpesaBalanceOut(
                shortcode=shortcode,
                credentials_configured=credentials_configured,
            ),
            message="No balance query yet. Click Check balance to ask Safaricom.",
        )

    return AdminMpesaBalanceResponse(
        data=AdminMpesaBalanceOut(
            id=latest.id,
            shortcode=latest.shortcode or shortcode,
            status=latest.status,
            working_balance=latest.working_balance,
            utility_balance=latest.utility_balance,
            charges_balance=latest.charges_balance,
            balances_raw=latest.balances_raw,
            result_desc=latest.result_desc,
            requested_at=latest.requested_at,
            completed_at=latest.completed_at,
            credentials_configured=credentials_configured,
        ),
    )


@router.post("/mpesa-balance", response_model=AdminMpesaBalanceResponse)
def refresh_mpesa_hub_balance(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    admin: User = Depends(require_super_admin),
):
    """Ask Safaricom for the current DukAI hub Paybill balance (async)."""
    from app.services import mpesa_balance_service
    from app.services.mpesa_service import MpesaApiError

    validate_csrf(request, session)

    try:
        row = mpesa_balance_service.request_hub_balance(
            db,
            requested_by_user_id=admin.id,
        )
    except MpesaApiError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return AdminMpesaBalanceResponse(
        data=AdminMpesaBalanceOut(
            id=row.id,
            shortcode=row.shortcode,
            status=row.status,
            working_balance=row.working_balance,
            utility_balance=row.utility_balance,
            charges_balance=row.charges_balance,
            balances_raw=row.balances_raw,
            result_desc=row.result_desc,
            requested_at=row.requested_at,
            completed_at=row.completed_at,
            credentials_configured=True,
        ),
        message=(
            "Balance query sent. Safaricom will reply to the callback shortly — "
            "this panel refreshes automatically."
        ),
    )


class AdminMpesaVerification(BaseModel):
    """What Safaricom's Transaction Status API reports for one entry."""

    state: str
    checked_at: datetime | None = None
    safaricom_status: str | None = None
    safaricom_amount: str | None = None
    safaricom_receipt: str | None = None
    safaricom_completed_at: datetime | None = None
    debit_party: str | None = None
    credit_party: str | None = None
    charges: str | None = None
    reason_type: str | None = None
    result_desc: str | None = None


class AdminMpesaActivityEntry(BaseModel):
    id: str
    transaction_id: str
    direction: str
    label: str
    amount: int
    at: datetime | None = None
    counterparty: str | None = None
    merchant_id: str | None = None
    merchant_name: str | None = None
    receipt_number: str | None = None
    reference: str | None = None
    order_id: str | None = None
    can_verify: bool = False
    verification: AdminMpesaVerification | None = None


class AdminMpesaActivityResponse(BaseModel):
    data: list[AdminMpesaActivityEntry]
    money_in: int
    money_out: int
    net: int
    shortcode: str | None = None
    verified_count: int = 0
    mismatch_count: int = 0
    unverified_count: int = 0
    credentials_configured: bool = False


def _activity_verification(row) -> AdminMpesaVerification:
    from app.services import mpesa_status_service

    state = row.match_state
    if row.status == mpesa_status_service.CHECK_PENDING:
        state = "pending"
    return AdminMpesaVerification(
        state=state or "unresolved",
        checked_at=row.completed_at or row.requested_at,
        safaricom_status=row.safaricom_status,
        safaricom_amount=row.safaricom_amount,
        safaricom_receipt=row.safaricom_receipt,
        safaricom_completed_at=row.safaricom_completed_at,
        debit_party=row.debit_party,
        credit_party=row.credit_party,
        charges=row.debit_party_charges,
        reason_type=row.reason_type,
        result_desc=row.result_desc,
    )


@router.get("/mpesa-activity", response_model=AdminMpesaActivityResponse)
def list_mpesa_hub_activity(
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
    limit: int = 25,
):
    """Recent money in and out of the DukAI hub Paybill.

    Built from DukAI's own M-PESA records: confirmed Client → DukAI collections
    are money in, completed DukAI → Merchant payouts are money out. Safaricom
    has no statement API, so movements DukAI did not initiate (manual
    withdrawals, transaction charges) are not listed here. Each entry carries
    the latest Transaction Status verification against Safaricom, if any.
    """
    from app.services import mpesa_payout_service, mpesa_status_service

    del admin  # auth gate only
    limit = max(1, min(limit, 100))

    shortcode: str | None = None
    credentials_configured = False
    try:
        config = mpesa_service.resolve_mpesa_config(db)
        shortcode = (config.shortcode or "").strip() or None
        credentials_configured = mpesa_payout_service._resolve_b2b_credentials(config) is not None
    except Exception:
        shortcode = None

    # Over-fetch: one row can yield both an in and an out entry, and rows are
    # ordered by creation while entries are ordered by when money moved.
    rows = (
        db.query(MpesaTransaction)
        .filter(
            or_(
                MpesaTransaction.status == "success",
                MpesaTransaction.payout_status == "success",
            ),
        )
        .order_by(
            MpesaTransaction.created_at.is_(None),
            MpesaTransaction.created_at.desc(),
            MpesaTransaction.id.desc(),
        )
        .limit(limit * 4)
        .all()
    )

    account_ids = {t.account_id for t in rows if t.account_id}
    accounts: dict[str, Account] = {}
    if account_ids:
        for account in db.query(Account).filter(Account.id.in_(account_ids)).all():
            accounts[account.id] = account

    entries: list[AdminMpesaActivityEntry] = []
    for txn in rows:
        payload = txn.callback_payload if isinstance(txn.callback_payload, dict) else {}
        is_admin_payout = bool(payload.get("admin_merchant_payout"))
        account = accounts.get(txn.account_id) if txn.account_id else None
        merchant_name = account.business_name if account else None

        received = txn.status == "success" and (
            bool((txn.mpesa_receipt_number or "").strip())
            or bool(payload.get("admin_simulate"))
            or bool(payload.get("safaricom_confirmed"))
        )
        if received and not is_admin_payout:
            entries.append(
                AdminMpesaActivityEntry(
                    id=f"{txn.id}:in",
                    transaction_id=txn.id,
                    direction="in",
                    label="Client payment",
                    amount=int(txn.amount),
                    at=txn.completed_at or txn.created_at,
                    counterparty=txn.phone_number,
                    merchant_id=txn.account_id,
                    merchant_name=merchant_name,
                    receipt_number=txn.mpesa_receipt_number,
                    reference=txn.account_reference,
                    order_id=txn.order_id,
                    can_verify=bool((txn.mpesa_receipt_number or "").strip()),
                ),
            )

        if txn.payout_status == "success":
            destination = " ".join(
                part
                for part in [txn.payout_shortcode_type or "", txn.payout_shortcode or ""]
                if part
            ).strip()
            entries.append(
                AdminMpesaActivityEntry(
                    id=f"{txn.id}:out",
                    transaction_id=txn.id,
                    direction="out",
                    label="Admin payout" if is_admin_payout else "Merchant payout",
                    amount=int(txn.payout_amount or txn.amount),
                    at=txn.payout_completed_at or txn.updated_at,
                    counterparty=destination or None,
                    merchant_id=txn.account_id,
                    merchant_name=merchant_name,
                    receipt_number=txn.payout_receipt_number,
                    reference=txn.account_reference,
                    order_id=txn.order_id,
                    can_verify=bool((txn.payout_receipt_number or "").strip()),
                ),
            )

    entries.sort(
        key=lambda e: (e.at is not None, e.at or datetime.min),
        reverse=True,
    )
    entries = entries[:limit]

    checks = mpesa_status_service.latest_checks_for_transactions(
        db,
        [e.transaction_id for e in entries],
    )
    for entry in entries:
        check = checks.get((entry.transaction_id, entry.direction))
        if check is not None:
            entry.verification = _activity_verification(check)

    money_in = sum(e.amount for e in entries if e.direction == "in")
    money_out = sum(e.amount for e in entries if e.direction == "out")
    states = [e.verification.state if e.verification else None for e in entries]

    return AdminMpesaActivityResponse(
        data=entries,
        money_in=money_in,
        money_out=money_out,
        net=money_in - money_out,
        shortcode=shortcode,
        verified_count=sum(1 for s in states if s == mpesa_status_service.MATCH_VERIFIED),
        mismatch_count=sum(
            1
            for s in states
            if s
            in {
                mpesa_status_service.MATCH_AMOUNT_MISMATCH,
                mpesa_status_service.MATCH_STATUS_MISMATCH,
                mpesa_status_service.MATCH_NOT_FOUND,
            }
        ),
        unverified_count=sum(
            1 for s in states if s is None or s == mpesa_status_service.MATCH_UNRESOLVED
        ),
        credentials_configured=credentials_configured,
    )


class AdminMpesaVerifyIn(BaseModel):
    transaction_id: str
    direction: str = Field(pattern="^(in|out)$")


class AdminMpesaVerifyResponse(BaseModel):
    message: str
    transaction_id: str
    direction: str
    verification: AdminMpesaVerification


@router.post("/mpesa-verify", response_model=AdminMpesaVerifyResponse)
def verify_mpesa_entry_against_safaricom(
    payload: AdminMpesaVerifyIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
    admin: User = Depends(require_super_admin),
):
    """Ask Safaricom's Transaction Status API what it holds for one movement."""
    from app.services import mpesa_status_service
    from app.services.mpesa_service import MpesaApiError

    validate_csrf(request, session)

    try:
        row = mpesa_status_service.request_status_check(
            db,
            transaction_id=payload.transaction_id,
            direction=payload.direction,
            requested_by_user_id=admin.id,
        )
    except MpesaApiError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return AdminMpesaVerifyResponse(
        message=(
            "Asked Safaricom about this transaction. The result arrives on the "
            "callback shortly — this panel refreshes automatically."
        ),
        transaction_id=row.transaction_id,
        direction=row.direction,
        verification=_activity_verification(row),
    )


# --- Catalog products (platform primary image) -----------------------------


class AdminStoreMediaItem(BaseModel):
    url: str
    original_name: str | None = None
    content_type: str | None = None
    size: int | None = None
    uploaded_at: str | None = None
    uploaded_by: str | None = None
    account_id: str
    inventory_item_id: str
    merchant_name: str | None = None


class AdminCatalogProductDetail(BaseModel):
    product: ProductOut
    store_media: list[AdminStoreMediaItem]
    shops_carrying_count: int


class AdminCatalogProductDetailResponse(BaseModel):
    data: AdminCatalogProductDetail


class AdminCatalogProductsResponse(BaseModel):
    data: list[ProductOut]
    total: int


class AdminSetPrimaryImageIn(BaseModel):
    url: str = Field(min_length=1, max_length=1024)
    locked: bool = True


class AdminSetPrimaryImageResponse(BaseModel):
    message: str
    data: ProductOut


@router.get("/catalog/products", response_model=AdminCatalogProductsResponse)
def list_catalog_products(
    q: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    query = db.query(Product).order_by(Product.name.asc())
    if q:
        term = f"%{q.strip()}%"
        from sqlalchemy import or_

        query = query.filter(
            or_(
                Product.name.ilike(term),
                Product.brand.ilike(term),
                Product.product_code.ilike(term),
                Product.sku.ilike(term),
            ),
        )
    rows = query.limit(200).all()

    product_ids = [row.id for row in rows]
    counts: dict[str, int] = {}
    if product_ids:
        rows_counts = (
            db.query(
                InventoryItem.product_id,
                func.count(func.distinct(InventoryItem.account_id)),
            )
            .filter(InventoryItem.product_id.in_(product_ids))
            .group_by(InventoryItem.product_id)
            .all()
        )
        counts = {pid: cnt for pid, cnt in rows_counts}

    items: list[ProductOut] = []
    for row in rows:
        out = ProductOut.model_validate(row)
        out.shops_carrying_count = counts.get(row.id, 0)
        items.append(out)

    return AdminCatalogProductsResponse(
        data=items,
        total=len(items),
    )


@router.get("/catalog/products/{product_id}", response_model=AdminCatalogProductDetailResponse)
def catalog_product_detail(
    product_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found.")

    accounts = {a.id: a.business_name for a in db.query(Account).all()}
    store_media: list[AdminStoreMediaItem] = []
    for record in collect_store_media(db, product.id):
        if not is_image_media(record):
            continue
        store_media.append(
            AdminStoreMediaItem(
                url=str(record["url"]),
                original_name=record.get("original_name"),
                content_type=record.get("content_type"),
                size=record.get("size"),
                uploaded_at=record.get("uploaded_at"),
                uploaded_by=record.get("uploaded_by"),
                account_id=str(record["account_id"]),
                inventory_item_id=str(record["inventory_item_id"]),
                merchant_name=accounts.get(str(record["account_id"])),
            ),
        )

    shops_count = (
        db.query(func.count(func.distinct(InventoryItem.account_id)))
        .filter(InventoryItem.product_id == product.id)
        .scalar()
        or 0
    )
    out = ProductOut.model_validate(product)
    out.shops_carrying_count = shops_count

    return AdminCatalogProductDetailResponse(
        data=AdminCatalogProductDetail(
            product=out,
            store_media=store_media,
            shops_carrying_count=shops_count,
        ),
    )


@router.post(
    "/catalog/products/{product_id}/primary-image",
    response_model=AdminSetPrimaryImageResponse,
)
def set_catalog_primary_image(
    product_id: str,
    payload: AdminSetPrimaryImageIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found.")

    match = next(
        (m for m in collect_store_media(db, product.id) if m.get("url") == payload.url),
        None,
    )
    if match is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="That image is not attached to any shop carrying this product.",
        )
    if not is_image_media(match):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Only photos can be used as the platform primary image.",
        )

    product.image_url = payload.url
    product.primary_image_locked = payload.locked
    product.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(product)

    return AdminSetPrimaryImageResponse(
        message="Platform primary image updated.",
        data=ProductOut.model_validate(product),
    )


@router.post(
    "/catalog/products/{product_id}/primary-image/auto",
    response_model=AdminSetPrimaryImageResponse,
)
def reset_catalog_primary_image_auto(
    product_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    """Unlock the platform primary and re-pick from store media."""
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found.")

    product.primary_image_locked = False
    sync_product_primary_image(db, product)
    product.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(product)

    return AdminSetPrimaryImageResponse(
        message="Platform primary image reset to automatic selection.",
        data=ProductOut.model_validate(product),
    )


class AdminGenerateCatalogImageIn(BaseModel):
    prompt: str | None = Field(default=None, max_length=2000)
    quality: Literal["low", "medium", "high"] | None = None
    provider: Literal["openai", "gemini", "cloudflare", "pollinations"] | None = None


@router.post(
    "/catalog/products/{product_id}/generate-image",
    response_model=AdminSetPrimaryImageResponse,
)
async def generate_catalog_primary_image(
    product_id: str,
    payload: AdminGenerateCatalogImageIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
):
    """Generate an AI image and lock it as the platform primary (missing only)."""
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found.")
    if product.product_type == "service":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="AI images are only available for products, not services.",
        )
    if product.image_url:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="This catalog product already has a primary image.",
        )

    prompt = build_prompt_for_product(product, override=payload.prompt)
    try:
        body, content_type, _meta = await generate_product_image(
            prompt,
            quality=payload.quality,
            provider=payload.provider,
        )
    except ImageGenerationDisabled as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except ImageGenerationError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    record = save_generated_image(
        product.id,
        body,
        content_type,
        uploader_id=admin.id,
        original_name=f"{product.slug or 'product'}-ai.png",
    )

    product.image_url = str(record["url"])
    product.primary_image_locked = True
    product.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(product)

    return AdminSetPrimaryImageResponse(
        message="Generated and set platform primary image.",
        data=ProductOut.model_validate(product),
    )


from app.api.v1 import admin_bot_sandbox, admin_webhooks  # noqa: E402

router.include_router(admin_bot_sandbox.router)
router.include_router(admin_webhooks.router)
