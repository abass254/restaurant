"""Restaurant menu building blocks: option groups and combo meals."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.session import require_user, validate_csrf
from app.database import get_db
from app.dependencies import get_request_session
from app.models import (
    Account,
    CatalogueModifierGroup,
    ComboComponent,
    InventoryItem,
    ModifierGroup,
    ModifierOption,
    Product,
    RecipeLine,
    User,
)
from app.schemas import (
    ModifierGroupOut,
    ModifierOptionOut,
    modifier_groups_for,
    recipe_for,
)
from app.services.menu_options import option_availability
from app.support.merchant_permissions import (
    active_account_id,
    assert_merchant_section_any_access,
)

router = APIRouter(tags=["menu"])

MAX_OPTIONS = 40


class ModifierOptionIn(BaseModel):
    id: str | None = Field(default=None, max_length=36)
    name: str = Field(min_length=1, max_length=120)
    price_delta: float = Field(default=0, ge=0, le=9_999_999)
    product_id: str | None = Field(default=None, max_length=36)
    # Amount of the linked supply one pick uses, in that supply's unit.
    stock_qty: float = Field(default=1, gt=0, le=100_000)
    is_default: bool = False


class ModifierGroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    min_select: int = Field(default=0, ge=0, le=MAX_OPTIONS)
    max_select: int = Field(default=1, ge=1, le=MAX_OPTIONS)
    included: bool = False
    options: list[ModifierOptionIn] = Field(default_factory=list, max_length=MAX_OPTIONS)


class ModifierGroupPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    min_select: int | None = Field(default=None, ge=0, le=MAX_OPTIONS)
    max_select: int | None = Field(default=None, ge=1, le=MAX_OPTIONS)
    included: bool | None = None
    options: list[ModifierOptionIn] | None = Field(default=None, max_length=MAX_OPTIONS)


class OptionActivePatch(BaseModel):
    is_active: bool


class ItemGroupsReplace(BaseModel):
    group_ids: list[str] = Field(default_factory=list, max_length=30)


class RecipeLineIn(BaseModel):
    product_id: str = Field(min_length=1, max_length=36)
    quantity: float = Field(gt=0, le=100_000)


class RecipeReplace(BaseModel):
    lines: list[RecipeLineIn] = Field(default_factory=list, max_length=40)


class ComboComponentIn(BaseModel):
    product_id: str = Field(min_length=1, max_length=36)
    quantity: int = Field(default=1, ge=1, le=20)


class ComboComponentsReplace(BaseModel):
    components: list[ComboComponentIn] = Field(default_factory=list, max_length=20)


def _menu_user(db: Session, session: dict, *, write: bool) -> tuple[User, str]:
    user = require_user(db, session)
    if write:
        assert_merchant_section_any_access(user, "inventory", "services")
    else:
        assert_merchant_section_any_access(user, "inventory", "pos", "services", "dashboard")
    return user, str(active_account_id(user))


def _unprocessable(field: str, message: str) -> HTTPException:
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"errors": {field: [message]}},
    )


def _owned_group(db: Session, account_id: str, group_id: str) -> ModifierGroup:
    group = (
        db.query(ModifierGroup)
        .options(selectinload(ModifierGroup.options).joinedload(ModifierOption.product))
        .filter(ModifierGroup.id == group_id, ModifierGroup.account_id == account_id)
        .first()
    )
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Modifier not found.")
    return group


def _item_counts(db: Session, group_ids: list[str]) -> dict[str, int]:
    if not group_ids:
        return {}
    rows = (
        db.query(CatalogueModifierGroup.group_id, func.count(CatalogueModifierGroup.id))
        .filter(CatalogueModifierGroup.group_id.in_(group_ids))
        .group_by(CatalogueModifierGroup.group_id)
        .all()
    )
    return {group_id: count for group_id, count in rows}


def _group_out(db: Session, group: ModifierGroup) -> ModifierGroupOut:
    return ModifierGroupOut.from_model(group, item_count=_item_counts(db, [group.id]).get(group.id, 0))


def _check_rule(min_select: int, max_select: int, option_count: int) -> None:
    if min_select > max_select:
        raise _unprocessable("min_select", "Minimum picks can't be more than the maximum.")
    if option_count and min_select > option_count:
        raise _unprocessable("min_select", "Add at least as many options as customers must pick.")


def _apply_options(
    db: Session,
    account_id: str,
    group: ModifierGroup,
    rows: list[ModifierOptionIn],
) -> None:
    names = [row.name.strip().lower() for row in rows]
    if len(set(names)) != len(names):
        raise _unprocessable("options", "Each option needs a different name.")
    if sum(1 for row in rows if row.is_default) > (group.max_select or 1):
        raise _unprocessable("options", "More options are marked default than customers can pick.")

    linked = {row.product_id for row in rows if row.product_id}
    if linked:
        carried = {
            product_id
            for (product_id,) in db.query(InventoryItem.product_id).filter(
                InventoryItem.account_id == account_id,
                InventoryItem.product_id.in_(linked),
            )
        }
        if linked - carried:
            raise _unprocessable("options", "Options can only use supplies from your own stock.")

    existing = {option.id: option for option in group.options or []}
    now = datetime.utcnow()
    kept: list[ModifierOption] = []
    for index, row in enumerate(rows):
        option = existing.pop(row.id, None) if row.id else None
        if option is None:
            option = ModifierOption(group_id=group.id, created_at=now, is_active=True)
        option.name = row.name.strip()
        option.price_delta = round(row.price_delta, 2)
        option.product_id = row.product_id or None
        option.stock_qty = round(row.stock_qty, 3) if row.product_id else 1
        option.is_default = row.is_default
        option.sort_order = index
        option.updated_at = now
        kept.append(option)
    group.options = kept


@router.get("/menu/modifier-groups")
def list_modifier_groups(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    _, account_id = _menu_user(db, session, write=False)
    groups = (
        db.query(ModifierGroup)
        .options(selectinload(ModifierGroup.options).joinedload(ModifierOption.product))
        .filter(ModifierGroup.account_id == account_id)
        .order_by(ModifierGroup.sort_order.asc(), ModifierGroup.name.asc())
        .all()
    )
    counts = _item_counts(db, [g.id for g in groups])
    return {"data": [ModifierGroupOut.from_model(g, item_count=counts.get(g.id, 0)) for g in groups]}


@router.post("/menu/modifier-groups", status_code=status.HTTP_201_CREATED)
def create_modifier_group(
    payload: ModifierGroupIn,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _, account_id = _menu_user(db, session, write=True)
    _check_rule(payload.min_select, payload.max_select, len(payload.options))

    now = datetime.utcnow()
    count = db.query(func.count(ModifierGroup.id)).filter(ModifierGroup.account_id == account_id).scalar()
    group = ModifierGroup(
        account_id=account_id,
        name=payload.name.strip(),
        min_select=payload.min_select,
        max_select=payload.max_select,
        included=payload.included,
        sort_order=count or 0,
        created_at=now,
        updated_at=now,
    )
    db.add(group)
    db.flush()
    _apply_options(db, account_id, group, payload.options)
    db.commit()
    return {"data": _group_out(db, _owned_group(db, account_id, group.id))}


@router.patch("/menu/modifier-groups/{group_id}")
def update_modifier_group(
    group_id: str,
    payload: ModifierGroupPatch,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _, account_id = _menu_user(db, session, write=True)
    group = _owned_group(db, account_id, group_id)

    if payload.name is not None:
        group.name = payload.name.strip()
    if payload.min_select is not None:
        group.min_select = payload.min_select
    if payload.max_select is not None:
        group.max_select = payload.max_select
    if payload.included is not None:
        group.included = payload.included
    option_count = len(payload.options) if payload.options is not None else len(group.options or [])
    _check_rule(group.min_select or 0, group.max_select or 1, option_count)
    if payload.options is not None:
        _apply_options(db, account_id, group, payload.options)
    group.updated_at = datetime.utcnow()
    db.commit()
    return {"data": _group_out(db, _owned_group(db, account_id, group.id))}


@router.patch("/menu/modifier-options/{option_id}")
def set_modifier_option_active(
    option_id: str,
    payload: OptionActivePatch,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Mark one option available or sold out, e.g. from the Kitchen page."""
    validate_csrf(request, session)
    user = require_user(db, session)
    assert_merchant_section_any_access(user, "inventory", "services", "pos")
    account_id = str(active_account_id(user))
    option = (
        db.query(ModifierOption)
        .join(ModifierGroup, ModifierGroup.id == ModifierOption.group_id)
        .options(joinedload(ModifierOption.product))
        .filter(ModifierOption.id == option_id, ModifierGroup.account_id == account_id)
        .first()
    )
    if option is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Option not found.")
    option.is_active = payload.is_active
    option.updated_at = datetime.utcnow()
    db.commit()
    return {"data": ModifierOptionOut.from_model(option)}


@router.get("/menu/option-availability")
def list_option_availability(
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Whether each of the shop's options can be picked now: sold out by staff or short of stock."""
    _, account_id = _menu_user(db, session, write=False)
    return {"data": option_availability(db, db.get(Account, account_id))}


@router.delete("/menu/modifier-groups/{group_id}")
def delete_modifier_group(
    group_id: str,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _, account_id = _menu_user(db, session, write=True)
    group = _owned_group(db, account_id, group_id)
    db.delete(group)
    db.commit()
    return {"message": "Modifier removed."}


def _owned_item(db: Session, account_id: str, product_id: str, noun: str) -> Product:
    product = (
        db.query(Product)
        .options(
            selectinload(Product.modifier_group_links)
            .joinedload(CatalogueModifierGroup.group)
            .selectinload(ModifierGroup.options),
            selectinload(Product.combo_component_links).joinedload(ComboComponent.component),
        )
        .filter(Product.id == product_id)
        .first()
    )
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{noun.capitalize()} not found.")
    # Catalogue rows are shared across shops; only the creating shop may change them.
    if str(product.created_by_account_id or "") != account_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"This {noun} is shared with other shops. Add it as your own {noun} to change it.",
        )
    return product


@router.put("/products/{product_id}/modifier-groups")
def replace_item_modifier_groups(
    product_id: str,
    payload: ItemGroupsReplace,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _, account_id = _menu_user(db, session, write=True)
    product = _owned_item(db, account_id, product_id, "dish")
    if product.product_type not in ("meal", "combo"):
        raise _unprocessable("product_id", "Modifiers can only be attached to dishes and meals.")

    group_ids = payload.group_ids
    if len(set(group_ids)) != len(group_ids):
        raise _unprocessable("group_ids", "Each modifier can only be attached once.")
    owned = {
        group_id
        for (group_id,) in db.query(ModifierGroup.id).filter(
            ModifierGroup.account_id == account_id,
            ModifierGroup.id.in_(group_ids or [""]),
        )
    }
    if set(group_ids) - owned:
        raise _unprocessable("group_ids", "Choose modifiers from your own menu.")

    now = datetime.utcnow()
    other_shops = [
        link for link in product.modifier_group_links
        if link.group is not None and link.group.account_id != account_id
    ]
    existing = {link.group_id: link for link in product.modifier_group_links if link not in other_shops}
    links = list(other_shops)
    for index, group_id in enumerate(group_ids):
        link = existing.get(group_id) or CatalogueModifierGroup(group_id=group_id, created_at=now)
        link.sort_order = index
        links.append(link)
    product.modifier_group_links = links
    product.updated_at = now
    db.commit()

    db.expire_all()
    product = _owned_item(db, account_id, product_id, "dish")
    return {"data": [g.model_dump() for g in modifier_groups_for(product, account_id)]}


@router.put("/products/{product_id}/recipe")
def replace_recipe(
    product_id: str,
    payload: RecipeReplace,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    """Set how much of each supply one portion of a dish uses. Recipes belong to this shop only."""
    validate_csrf(request, session)
    _, account_id = _menu_user(db, session, write=True)
    dish = (
        db.query(Product)
        .options(selectinload(Product.recipe_lines).joinedload(RecipeLine.ingredient))
        .join(InventoryItem, InventoryItem.product_id == Product.id)
        .filter(Product.id == product_id, InventoryItem.account_id == account_id)
        .first()
    )
    if dish is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Dish not found on your menu.")
    if dish.product_type != "meal":
        raise _unprocessable("product_id", "Recipes are set on dishes; meals use their dishes' recipes.")

    ids = [row.product_id for row in payload.lines]
    if len(set(ids)) != len(ids):
        raise _unprocessable("lines", "Each supply can only be listed once.")
    supplies = {
        item.product_id: item
        for item in db.query(InventoryItem)
        .options(joinedload(InventoryItem.product))
        .filter(InventoryItem.account_id == account_id, InventoryItem.product_id.in_(ids or [""]))
    }
    for pid in ids:
        item = supplies.get(pid)
        if item is None or pid == dish.id:
            raise _unprocessable("lines", "Recipes can only use supplies from your own stock.")
        if item.product and item.product.product_type in ("meal", "combo", "service"):
            raise _unprocessable("lines", "Recipes use supplies, not other dishes.")

    now = datetime.utcnow()
    existing = {
        line.ingredient_product_id: line
        for line in dish.recipe_lines
        if line.account_id == account_id
    }
    keep = [line for line in dish.recipe_lines if line.account_id != account_id]
    for index, row in enumerate(payload.lines):
        line = existing.get(row.product_id) or RecipeLine(
            account_id=account_id,
            ingredient_product_id=row.product_id,
            created_at=now,
        )
        line.quantity = round(row.quantity, 4)
        line.sort_order = index
        keep.append(line)
    dish.recipe_lines = keep
    db.commit()

    db.expire_all()
    dish = (
        db.query(Product)
        .options(selectinload(Product.recipe_lines).joinedload(RecipeLine.ingredient))
        .filter(Product.id == product_id)
        .first()
    )
    return {"data": [line.model_dump() for line in recipe_for(dish, account_id)]}


@router.put("/products/{product_id}/combo-components")
def replace_combo_components(
    product_id: str,
    payload: ComboComponentsReplace,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(get_request_session),
):
    validate_csrf(request, session)
    _menu_user(db, session, write=True)
    raise _unprocessable(
        "components",
        "Meals are built with modifiers now: list fixed ingredients under 'Always in this meal' "
        "and the choices as modifiers.",
    )
