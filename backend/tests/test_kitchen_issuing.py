"""Restaurant store-to-kitchen issuing: sales use kitchen stock, issues move store to kitchen."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response

from app.api.v1 import inventory as inventory_api, kitchen_issues, menu as menu_api, orders, settings as settings_api
from app.api.v1.inventory import InventoryCreate
from app.api.v1.settings import BusinessProfileUpdate
from app.api.v1.kitchen_issues import EquivalenceUnitsReplace
from app.api.v1.menu import RecipeLineIn, RecipeReplace
from app.models import Account, Catalogue, InventoryItem, KitchenEquivalenceUnit, KitchenIssue, RecipeServingUnit, StockMovement
from app.services.kitchen_issue_service import (
    KitchenIssueError,
    cancel_issue,
    create_issue,
    disable_kitchen_issuing,
    enable_kitchen_issuing,
    release_issue,
    return_to_store,
    record_kitchen_used,
    suggest_issue,
)
from app.services.kitchen_menu_service import deactivate_restaurant_menus
from app.services.kitchen_shift_service import KitchenShiftError, clock_in, clock_out
from app.services.purchase_order_service import (
    LineInput,
    PurchaseOrderService,
    ReceiveInput,
)
from app.services.restaurant_stock_service import (
    StockTakeError,
    complete_stock_take,
    create_stock_take,
    kitchen_day_report,
    menu_costing,
    prepare_recipe_batch,
    save_counts,
)
from test_restaurant_supplies import ACCOUNT, _cancel, _make_db, _order


@pytest.fixture()
def rdb(monkeypatch):
    session = _make_db(monkeypatch, "restaurant")
    yield session
    session.close()


@pytest.fixture()
def retail_db(monkeypatch):
    session = _make_db(monkeypatch, "retail")
    yield session
    session.close()


def _account(db) -> Account:
    return db.get(Account, ACCOUNT)


def _qty(db, item_id: str) -> tuple[float, float | None]:
    db.expire_all()
    item = db.get(InventoryItem, item_id)
    kitchen = float(item.kitchen_quantity) if item.kitchen_quantity is not None else None
    return float(item.stock_quantity), kitchen


def test_kitchen_equivalence_measures_are_account_scoped_and_normalized(rdb, monkeypatch):
    user = SimpleNamespace(id="u1")
    monkeypatch.setattr(kitchen_issues, "validate_csrf", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(kitchen_issues, "require_user", lambda *_args, **_kwargs: user)
    monkeypatch.setattr(kitchen_issues, "active_account_id", lambda _user: ACCOUNT)
    monkeypatch.setattr(kitchen_issues, "assert_merchant_section_any_access", lambda *_args, **_kwargs: None)

    result = kitchen_issues.replace_equivalence_units(
        EquivalenceUnitsReplace(units=[" plates ", "Sticks", "PLATES", ""]),
        request=None,
        db=rdb,
        session={},
    )

    assert result["data"] == ["plates", "Sticks"]
    stored = (
        rdb.query(KitchenEquivalenceUnit)
        .filter(KitchenEquivalenceUnit.account_id == ACCOUNT)
        .order_by(KitchenEquivalenceUnit.sort_order)
        .all()
    )
    assert [unit.name for unit in stored] == ["plates", "Sticks"]
    assert kitchen_issues.get_equivalence_units(db=rdb, session={})["data"] == ["plates", "Sticks"]


def _enable(db, **opening: str):
    enable_kitchen_issuing(
        db,
        _account(db),
        {f"inv-{name}": Decimal(qty) for name, qty in opening.items()},
        user_id="u1",
    )
    db.commit()


def _issue(db, **lines: str) -> KitchenIssue:
    issue = create_issue(
        db,
        _account(db),
        [(f"inv-{name}", Decimal(qty)) for name, qty in lines.items()],
        user_id="u1",
        issue_now=True,
    )
    db.commit()
    return issue


def test_off_by_default_everything_stays_in_store(rdb):
    _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 10})
    assert _qty(rdb, "inv-flour") == (pytest.approx(9.0), None)
    assert {m.location for m in rdb.query(StockMovement).all()} == {"store"}


def test_first_release_to_kitchen_turns_issuing_on_and_moves_stock(rdb):
    assert not _account(rdb).kitchen_issuing_enabled
    _issue(rdb, flour="2")
    assert _account(rdb).kitchen_issuing_enabled
    assert _qty(rdb, "inv-flour") == (pytest.approx(8), pytest.approx(2))


def test_daily_menu_reset_pauses_only_active_restaurant_menu_items(rdb, retail_db):
    rdb.add(
        Catalogue(
            id="category-dish",
            name="Soup",
            slug="soup",
            product_type="retail",
            category="Food & Beverage",
        )
    )
    rdb.add(
        InventoryItem(
            id="inv-category-dish",
            account_id=ACCOUNT,
            product_id="category-dish",
            is_active=True,
        )
    )
    rdb.commit()

    assert deactivate_restaurant_menus(rdb) == 2
    assert rdb.get(InventoryItem, "inv-chapati").is_active is False
    assert rdb.get(InventoryItem, "inv-category-dish").is_active is False
    assert rdb.get(InventoryItem, "inv-flour").is_active is True
    assert deactivate_restaurant_menus(rdb) == 0
    assert deactivate_restaurant_menus(retail_db) == 0
    assert retail_db.get(InventoryItem, "inv-chapati").is_active is True


def test_kitchen_shift_requires_stock_handover_and_full_closing_count(rdb):
    _enable(rdb, flour="3", oil="1", eggs="2")
    supplies = {
        item.id: Decimal(str(item.kitchen_quantity or 0))
        for item in rdb.query(InventoryItem).filter(InventoryItem.kitchen_quantity.isnot(None)).all()
    }
    with pytest.raises(KitchenShiftError, match="does not match kitchen stock"):
        clock_in(rdb, _account(rdb), "u1", {**supplies, "inv-flour": Decimal("2")})
    with pytest.raises(KitchenShiftError, match="confirm every kitchen item"):
        clock_in(rdb, _account(rdb), "u1", {})

    session = clock_in(rdb, _account(rdb), "u1", supplies)
    rdb.commit()
    assert session.status == "active"
    with pytest.raises(KitchenShiftError, match="already active"):
        clock_in(rdb, _account(rdb), "u1", supplies)

    with pytest.raises(KitchenShiftError, match="Count every kitchen item"):
        clock_out(rdb, ACCOUNT, "u1", {}, None, True)
    with pytest.raises(KitchenShiftError, match="Finish or hand over"):
        clock_out(rdb, ACCOUNT, "u1", supplies, None, False)
    changed_counts = {item_id: qty for item_id, qty in supplies.items()}
    changed_counts["inv-flour"] = Decimal("2")
    with pytest.raises(KitchenShiftError, match="note explaining"):
        clock_out(rdb, ACCOUNT, "u1", changed_counts, None, True)

    closed = clock_out(rdb, ACCOUNT, "u1", changed_counts, "One kg used for staff meal", True)
    rdb.commit()
    assert closed.status == "closed"
    assert closed.closing_note == "One kg used for staff meal"
    assert closed.stock_take_id is not None
    assert _qty(rdb, "inv-flour")[1] == pytest.approx(2)
    assert clock_in(rdb, _account(rdb), "u1", changed_counts).status == "active"


def test_enable_moves_opening_kitchen_count(rdb):
    _enable(rdb, flour="2", oil="0.5")
    assert _qty(rdb, "inv-flour") == (pytest.approx(8.0), pytest.approx(2.0))
    assert _qty(rdb, "inv-oil") == (pytest.approx(4.5), pytest.approx(0.5))
    # Ingredients start the kitchen at zero; directly-sold items are not in the kitchen.
    assert _qty(rdb, "inv-eggs") == (pytest.approx(30.0), pytest.approx(0.0))
    assert _qty(rdb, "inv-soda") == (24, None)
    rows = rdb.query(StockMovement).filter(StockMovement.reason == "issue").all()
    assert {(m.location, m.direction) for m in rows} == {("store", "out"), ("kitchen", "in")}
    with pytest.raises(KitchenIssueError):
        enable_kitchen_issuing(rdb, _account(rdb), {}, user_id="u1")


def test_issue_moves_stock_and_value_to_kitchen(rdb):
    _enable(rdb)
    issue = _issue(rdb, flour="4", oil="1")
    assert issue.status == "issued"
    assert _qty(rdb, "inv-flour") == (pytest.approx(6.0), pytest.approx(4.0))
    kitchen_in = rdb.query(StockMovement).filter(
        StockMovement.reason == "issue",
        StockMovement.location == "kitchen",
        StockMovement.inventory_item_id == "inv-flour",
    ).one()
    assert kitchen_in.kitchen_issue_id == issue.id
    assert float(kitchen_in.total_cost) == pytest.approx(400.0)
    assert float(issue.lines[0].unit_cost) in (100.0, 300.0)

    with pytest.raises(KitchenIssueError, match="in the store"):
        _issue(rdb, flour="50")


def test_request_then_store_issues_a_different_amount(rdb):
    _enable(rdb)
    issue = create_issue(rdb, _account(rdb), [("inv-flour", Decimal("5"))], user_id="chef")
    rdb.commit()
    assert issue.status == "requested"
    assert _qty(rdb, "inv-flour") == (pytest.approx(10.0), pytest.approx(0.0))
    release_issue(rdb, _account(rdb), issue.id, {issue.lines[0].id: Decimal("3")}, user_id="store")
    rdb.commit()
    assert _qty(rdb, "inv-flour") == (pytest.approx(7.0), pytest.approx(3.0))
    assert float(issue.lines[0].requested_qty) == 5 and float(issue.lines[0].issued_qty) == 3
    with pytest.raises(KitchenIssueError):
        cancel_issue(rdb, ACCOUNT, issue.id)


def test_big_mac_style_sale_uses_kitchen_ingredients_and_store_drinks(rdb):
    _enable(rdb)
    _issue(rdb, flour="4", oil="1")
    _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 10},
           {"inventory_item_id": "inv-soda", "quantity": 2})
    assert _qty(rdb, "inv-flour") == (pytest.approx(6.0), pytest.approx(3.0))
    assert _qty(rdb, "inv-oil") == (pytest.approx(4.0), pytest.approx(0.9))
    assert _qty(rdb, "inv-soda") == (22, None)
    sales = {m.inventory_item_id: m.location for m in rdb.query(StockMovement).filter(StockMovement.reason == "sale")}
    assert sales == {"inv-flour": "kitchen", "inv-oil": "kitchen", "inv-soda": "store"}


def test_kitchen_shortage_allowed_or_blocked_by_setting(rdb):
    _enable(rdb)
    _issue(rdb, flour="1", oil="1")
    _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 20})
    # Kitchen deducted first (down to 0), and remaining quantity from the store.
    assert _qty(rdb, "inv-flour") == (pytest.approx(8.0), pytest.approx(0.0))

    _account(rdb).block_sale_on_low_ingredients = True
    rdb.commit()
    with pytest.raises(HTTPException) as exc:
        _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 1})
    assert "Flour" in str(exc.value.detail)


def test_cancel_returns_to_kitchen_and_wastage_comes_from_kitchen(rdb):
    _enable(rdb)
    _issue(rdb, flour="4", oil="1")
    out = _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 10})
    _cancel(rdb, out.id, waste=False)
    assert _qty(rdb, "inv-flour") == (pytest.approx(6.0), pytest.approx(4.0))
    reversals = rdb.query(StockMovement).filter(StockMovement.reason == "sale_reversal").all()
    assert {m.location for m in reversals} == {"kitchen"}

    out = _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 10})
    _cancel(rdb, out.id, waste=True)
    assert _qty(rdb, "inv-flour") == (pytest.approx(6.0), pytest.approx(3.0))
    wasted = rdb.query(StockMovement).filter(StockMovement.reason == "wastage").all()
    assert {m.location for m in wasted} == {"kitchen"}


def test_return_to_store(rdb):
    _enable(rdb)
    _issue(rdb, flour="4")
    return_to_store(rdb, _account(rdb), [("inv-flour", Decimal("1.5"))], user_id="chef")
    rdb.commit()
    assert _qty(rdb, "inv-flour") == (pytest.approx(7.5), pytest.approx(2.5))
    with pytest.raises(KitchenIssueError, match="kitchen only has"):
        return_to_store(rdb, _account(rdb), [("inv-flour", Decimal("5"))], user_id="chef")


def test_kitchen_day_report_balances_and_shows_count(rdb):
    start = datetime.utcnow() - timedelta(minutes=1)
    _enable(rdb, flour="1")
    _issue(rdb, flour="4", oil="1")
    _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 20})
    out = _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 5})
    _cancel(rdb, out.id, waste=True)
    return_to_store(rdb, _account(rdb), [("inv-flour", Decimal("0.5"))], user_id="chef")
    rdb.commit()
    # Kitchen flour: 1 + 4 - 2 - 0.5 wasted - 0.5 returned = 2.0; the chef counts 1.8.
    take = create_stock_take(rdb, ACCOUNT, user_id="chef", location="kitchen")
    flour_line = next(line for line in take.lines if line.inventory_item_id == "inv-flour")
    assert float(flour_line.expected_qty) == pytest.approx(2.0)
    save_counts(rdb, ACCOUNT, take.id, {flour_line.id: Decimal("1.8")})
    complete_stock_take(rdb, ACCOUNT, take.id, user_id="owner")
    rdb.commit()
    assert _qty(rdb, "inv-flour") == (pytest.approx(5.5), pytest.approx(1.8))

    report = kitchen_day_report(rdb, ACCOUNT, start, datetime.utcnow() + timedelta(minutes=1))
    flour = next(row for row in report["items"] if row["name"] == "Flour")
    assert flour["opening"] == pytest.approx(0)
    assert flour["issued"] == pytest.approx(5.0)
    assert flour["returned"] == pytest.approx(-0.5)
    assert flour["used_in_sales"] == pytest.approx(2.0)
    assert flour["wasted"] == pytest.approx(0.5)
    assert flour["count_variance"] == pytest.approx(-0.2)
    assert flour["expected_closing"] == pytest.approx(2.0)
    assert flour["counted"] == pytest.approx(1.8)
    assert flour["closing"] == pytest.approx(1.8)
    assert flour["opening"] + flour["issued"] + flour["returned"] - flour["used_in_sales"] \
        - flour["wasted"] + flour["adjusted"] + flour["count_variance"] == pytest.approx(flour["closing"])
    assert len(report["close_out_counts"]) == 1


def test_suggestion_and_menu_portions_use_kitchen(rdb):
    _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 70})  # 7kg flour over the week
    _enable(rdb, flour="0.5")
    suggestion = {row["name"]: row for row in suggest_issue(rdb, ACCOUNT)}
    assert suggestion["Flour"]["daily_usage"] == pytest.approx(1.0)
    assert suggestion["Flour"]["suggested_qty"] == pytest.approx(0.5)

    _issue(rdb, oil="1")
    chapati = next(row for row in menu_costing(rdb, ACCOUNT) if row["name"] == "Chapati")
    assert chapati["portions_available"] == 5  # 0.5kg in the kitchen / 0.1kg
    chapati_item = rdb.get(InventoryItem, "inv-chapati")
    assert chapati_item is not None
    serving_unit = (
        rdb.query(RecipeServingUnit)
        .filter(
            RecipeServingUnit.account_id == ACCOUNT,
            RecipeServingUnit.product_id == chapati_item.product_id,
        )
        .one_or_none()
    )
    if serving_unit is None:
        serving_unit = RecipeServingUnit(account_id=ACCOUNT, product_id=chapati_item.product_id)
        rdb.add(serving_unit)
    serving_unit.serving_unit = "chapatis"
    rdb.commit()
    chapati = next(row for row in menu_costing(rdb, ACCOUNT) if row["name"] == "Chapati")
    assert chapati["serving_unit"] == "chapatis"
    assert chapati["portions_with_store"] == 30  # 3kg in total


def test_disable_returns_kitchen_stock_to_store(rdb):
    _enable(rdb)
    _issue(rdb, flour="4")
    create_issue(rdb, _account(rdb), [("inv-oil", Decimal("1"))], user_id="chef")
    disable_kitchen_issuing(rdb, _account(rdb), user_id="owner")
    rdb.commit()
    assert _qty(rdb, "inv-flour") == (pytest.approx(10.0), None)
    assert rdb.query(KitchenIssue).filter(KitchenIssue.status == "requested").count() == 0
    _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 10})
    assert _qty(rdb, "inv-flour") == (pytest.approx(9.0), None)


def test_switching_to_retail_returns_kitchen_stock_to_store(rdb, monkeypatch):
    _enable(rdb)
    _issue(rdb, flour="4")
    user = SimpleNamespace(id="owner")
    monkeypatch.setattr(settings_api, "validate_csrf", lambda *_a, **_k: None)
    monkeypatch.setattr(settings_api, "require_user", lambda *_a, **_k: user)
    monkeypatch.setattr(settings_api, "assert_merchant_section_access", lambda *_a, **_k: None)
    monkeypatch.setattr(settings_api, "require_merchant_account_id", lambda _u: ACCOUNT)
    monkeypatch.setattr(settings_api, "build_user_out", lambda *_a, **_k: None)
    settings_api.update_business_profile(
        BusinessProfileUpdate(business_name="Mama Kitchen", business_category="Electronics", store_type="retail"),
        request=None,
        services=SimpleNamespace(db=rdb),
        session={},
    )
    assert _qty(rdb, "inv-flour") == (pytest.approx(10.0), None)
    account = _account(rdb)
    assert account.store_type == "retail" and not account.kitchen_issuing_enabled


def test_kitchen_count_needs_kitchen_issuing(rdb):
    with pytest.raises(StockTakeError):
        create_stock_take(rdb, ACCOUNT, user_id="u1", location="kitchen")


def test_retail_cannot_turn_on_kitchen(retail_db):
    with pytest.raises(KitchenIssueError):
        enable_kitchen_issuing(retail_db, retail_db.get(Account, ACCOUNT), {}, user_id="u1")
    _order(retail_db, {"inventory_item_id": "inv-chapati", "quantity": 10})
    assert retail_db.query(StockMovement).count() == 0


def test_full_lifecycle_po_delivery_to_issue_to_sale_to_daily_count(rdb):
    """End-to-end flow:
    1. Turn on kitchen issuing.
    2. Supplier delivery via PO enters the central store.
    3. Daily portion is issued to the kitchen.
    4. Kitchen prepares meals; POS order deducts recipe ingredients from kitchen.
    5. Surplus can be returned to store.
    6. Close-out kitchen count reconciles variance and balances the daily report.
    """
    start = datetime.utcnow() - timedelta(minutes=1)
    _enable(rdb)  # Store starts with 10kg flour, 0kg in kitchen

    # 1. PO: Receive 50kg flour from supplier into the store
    po_service = PurchaseOrderService(rdb)
    po = po_service.create(
        ACCOUNT,
        user_id="storekeeper",
        supplier_id="sup-1",
        status="ordered",
        lines=[LineInput("inv-flour", Decimal("50"), Decimal("100"))],
    )
    rdb.commit()
    flour_line = po.lines[0]
    po_service.receive(ACCOUNT, po.id, [ReceiveInput(flour_line.id, Decimal("50"))], user_id="storekeeper")
    rdb.commit()

    # Store has 10 + 50 = 60kg flour; kitchen has 0kg
    assert _qty(rdb, "inv-flour") == (pytest.approx(60.0), pytest.approx(0.0))

    # 2. Daily release: Kitchen requests 10kg flour; storekeeper releases it
    issue = create_issue(rdb, _account(rdb), [("inv-flour", Decimal("10"))], user_id="chef")
    rdb.commit()
    release_issue(rdb, _account(rdb), issue.id, None, user_id="storekeeper")
    rdb.commit()

    # Store has 50kg flour; kitchen has 10kg
    assert _qty(rdb, "inv-flour") == (pytest.approx(50.0), pytest.approx(10.0))

    # 3. Meal preparation / POS sale: 40 chapatis sold (recipe: 0.1kg flour per chapati = 4.0kg)
    _order(rdb, {"inventory_item_id": "inv-chapati", "quantity": 40})
    rdb.commit()

    # Store untouched at 50kg; kitchen dropped from 10kg to 6kg
    assert _qty(rdb, "inv-flour") == (pytest.approx(50.0), pytest.approx(6.0))

    # 4. Partial return: Chef returns 1.0kg unused flour back to the store
    return_to_store(rdb, _account(rdb), [("inv-flour", Decimal("1.0"))], user_id="chef")
    rdb.commit()

    # Store now has 51kg; kitchen has 5kg
    assert _qty(rdb, "inv-flour") == (pytest.approx(51.0), pytest.approx(5.0))

    # 5. End-of-day stock count: Chef counts 4.8kg on-hand in the kitchen (0.2kg prep spillage)
    take = create_stock_take(rdb, ACCOUNT, user_id="chef", location="kitchen")
    take_flour = next(line for line in take.lines if line.inventory_item_id == "inv-flour")
    assert float(take_flour.expected_qty) == pytest.approx(5.0)
    save_counts(rdb, ACCOUNT, take.id, {take_flour.id: Decimal("4.8")})
    complete_stock_take(rdb, ACCOUNT, take.id, user_id="manager")
    rdb.commit()

    # Final balances: store is 51kg, kitchen is 4.8kg
    assert _qty(rdb, "inv-flour") == (pytest.approx(51.0), pytest.approx(4.8))

    # 6. Verify kitchen daily report balances
    report = kitchen_day_report(rdb, ACCOUNT, start, datetime.utcnow() + timedelta(minutes=1))
    flour_report = next(row for row in report["items"] if row["name"] == "Flour")
    assert flour_report["issued"] == pytest.approx(10.0)
    assert flour_report["returned"] == pytest.approx(-1.0)
    assert flour_report["used_in_sales"] == pytest.approx(4.0)
    assert flour_report["count_variance"] == pytest.approx(-0.2)
    assert flour_report["expected_closing"] == pytest.approx(5.0)
    assert flour_report["counted"] == pytest.approx(4.8)
    assert flour_report["closing"] == pytest.approx(4.8)
    # Balance equation holds:
    assert (
        flour_report["opening"]
        + flour_report["issued"]
        + flour_report["returned"]
        - flour_report["used_in_sales"]
        - flour_report["wasted"]
        + flour_report["adjusted"]
        + flour_report["count_variance"]
    ) == pytest.approx(flour_report["closing"])


def test_purchase_new_inventory_issue_prepare_and_record_sale(rdb, monkeypatch):
    """Exercise the merchant workflow from adding a raw supply through its POS sale."""
    user = SimpleNamespace(id="u1")
    monkeypatch.setattr(inventory_api, "validate_csrf", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(inventory_api, "_auth_inventory_user", lambda *_args, **_kwargs: user)
    monkeypatch.setattr(inventory_api, "_require_shop", lambda _user: ACCOUNT)

    supply_product = Catalogue(
        id="qa-flour",
        name="QA Flour",
        slug="qa-flour",
        product_type="retail",
        unit="kg",
        created_by_account_id=ACCOUNT,
    )
    rdb.add(supply_product)
    rdb.commit()
    added = inventory_api.create_inventory_item(
        InventoryCreate(
            product_id=supply_product.id,
            stock_quantity=Decimal("0"),
            buying_price=Decimal("100"),
            inventory_role="raw_material",
        ),
        request=None,
        response=Response(),
        db=rdb,
        session={},
    )
    supply = rdb.get(InventoryItem, added["data"].id)
    assert supply is not None and supply.inventory_role == "raw_material"

    enable_kitchen_issuing(rdb, _account(rdb), {}, user_id="owner")
    rdb.commit()
    po_service = PurchaseOrderService(rdb)
    po = po_service.create(
        ACCOUNT,
        user_id="storekeeper",
        supplier_id="sup-1",
        status="ordered",
        lines=[LineInput(supply.id, Decimal("20"), Decimal("100"))],
    )
    rdb.commit()
    po_service.receive(
        ACCOUNT,
        po.id,
        [ReceiveInput(po.lines[0].id, Decimal("20"))],
        user_id="storekeeper",
    )
    rdb.commit()
    assert _qty(rdb, supply.id) == (pytest.approx(20), pytest.approx(0))

    issue = create_issue(rdb, _account(rdb), [(supply.id, Decimal("10"))], user_id="chef")
    rdb.commit()
    release_issue(rdb, _account(rdb), issue.id, None, user_id="storekeeper")
    rdb.commit()
    assert _qty(rdb, supply.id) == (pytest.approx(10), pytest.approx(10))

    menu_api.replace_recipe(
        "chapati",
        RecipeReplace(
            serving_unit="plates",
            lines=[
                RecipeLineIn(
                    product_id=supply_product.id,
                    quantity=0.1,
                    batch_quantity=1,
                    batch_yield=10,
                    serving_unit="plates",
                ),
            ],
        ),
        request=None,
        db=rdb,
        session={},
    )
    prepared = prepare_recipe_batch(
        rdb,
        ACCOUNT,
        "inv-chapati",
        serving_unit="plates",
        user_id="chef",
    )
    rdb.commit()
    assert prepared["portions_added"] == pytest.approx(10)
    assert _qty(rdb, supply.id) == (pytest.approx(10), pytest.approx(9))

    order = _order(
        rdb,
        {"inventory_item_id": "inv-chapati", "quantity": 2, "serving_unit": "plates"},
    )
    rdb.commit()
    assert order.source == "walkin"
    assert float(rdb.get(InventoryItem, "inv-chapati").prepared_quantity) == pytest.approx(8)
    assert _qty(rdb, supply.id) == (pytest.approx(10), pytest.approx(9))
    sale = rdb.query(StockMovement).filter(StockMovement.order_id == order.id).one()
    assert sale.reason == "sale" and sale.location == "prepared"

    monkeypatch.setattr(orders, "require_user", lambda *_args, **_kwargs: user)
    sales_response = orders.list_orders(
        q=None,
        status_filter="being_prepared",
        source="walkin",
        fulfillment_type=None,
        since=None,
        until=None,
        page=1,
        per_page=100,
        db=rdb,
        session={},
    )
    kitchen_response = orders.list_orders(
        q=None,
        status_filter="being_prepared",
        source=None,
        fulfillment_type=None,
        since=None,
        until=None,
        page=1,
        per_page=100,
        db=rdb,
        session={},
    )
    assert any(row.id == order.id for row in sales_response["data"])
    assert any(row.id == order.id for row in kitchen_response["data"])


def test_record_kitchen_used(rdb):
    _enable(rdb)
    _issue(rdb, flour="5.0")
    assert _qty(rdb, "inv-flour") == (pytest.approx(5.0), pytest.approx(5.0))

    # Record 2.0kg flour used
    movements = record_kitchen_used(
        rdb,
        _account(rdb),
        [("inv-flour", Decimal("2.0"))],
        user_id="chef",
        note="Prep for morning snacks",
    )
    assert len(movements) == 1
    assert movements[0].direction == "out"
    assert movements[0].location == "kitchen"
    assert float(movements[0].quantity) == pytest.approx(2.0)
    rdb.commit()

    # Kitchen has 3.0 left, store unchanged at 5.0
    assert _qty(rdb, "inv-flour") == (pytest.approx(5.0), pytest.approx(3.0))

    # Attempting to use more than available in kitchen raises error
    with pytest.raises(KitchenIssueError, match="The kitchen only has"):
        record_kitchen_used(
            rdb,
            _account(rdb),
            [("inv-flour", Decimal("10.0"))],
            user_id="chef",
        )


def test_post_used_api(rdb, monkeypatch):
    from unittest.mock import MagicMock
    from types import SimpleNamespace
    import app.api.v1.kitchen_issues as kitchen_api
    from app.api.v1.kitchen_issues import post_used, UsedRequest, ItemQty

    _enable(rdb)
    _issue(rdb, flour="4.0")
    monkeypatch.setattr(kitchen_api, "_shop", lambda *_: (SimpleNamespace(id="u1"), _account(rdb)))
    req = MagicMock()
    req.headers.get = lambda k, d=None: "token123" if k.upper() in ("X-CSRF-TOKEN", "X-XSRF-TOKEN") else d
    session = {"user_id": "u1", "csrf_token": "token123"}
    payload = UsedRequest(
        lines=[ItemQty(inventory_item_id="inv-flour", quantity=Decimal("1.5"))],
        note="Chef test",
    )
    res = post_used(payload, req, db=rdb, session=session)
    assert res["message"] == "Recorded kitchen usage."
    items = {item["inventory_item_id"]: item for item in res["data"]["items"]}
    assert items["inv-flour"]["kitchen_quantity"] == pytest.approx(2.5)
