from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session
from sqlalchemy.sql.sqltypes import Date, DateTime, Numeric

from app.models import (
    Account,
    Booking,
    Catalogue,
    CatalogueModifierGroup,
    ComboComponent,
    Delivery,
    DeliveryOffer,
    InventoryItem,
    KitchenEquivalenceUnit,
    KitchenIssue,
    KitchenIssueLine,
    KitchenShiftSession,
    MerchantNotification,
    MerchantOperationsResetArchive,
    ModifierGroup,
    ModifierOption,
    ModifierOptionRecipe,
    MpesaTransaction,
    Order,
    OrderItem,
    OrderReturn,
    OrderReturnItem,
    OrderStatusHistory,
    PreparedMenuStock,
    PurchaseOrder,
    PurchaseOrderLine,
    RecipeLine,
    RecipeServingUnit,
    ShopCustomer,
    ShopExpense,
    ShopSupplier,
    ShopSupplierPayment,
    StockMovement,
    StockTake,
    StockTakeLine,
)
from app.services.kitchen_menu_service import MENU_CATEGORIES

logger = logging.getLogger(__name__)

RECLAIM_WINDOW_DAYS = 30


def _serialize_model(instance: Any) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for col in instance.__table__.columns:
        val = getattr(instance, col.name, None)
        if isinstance(val, (datetime, date)):
            val = val.isoformat()
        elif isinstance(val, Decimal):
            val = str(val)
        data[col.name] = val
    return data


def _deserialize_model(model_cls: type, data: dict[str, Any]) -> Any:
    inst = model_cls()
    for col in model_cls.__table__.columns:
        if col.name not in data:
            continue
        val = data[col.name]
        if val is not None:
            if isinstance(col.type, DateTime):
                val = datetime.fromisoformat(str(val))
            elif isinstance(col.type, Date):
                val = date.fromisoformat(str(val))
            elif isinstance(col.type, Numeric):
                val = Decimal(str(val))
        setattr(inst, col.name, val)
    return inst


class MerchantOperationsResetService:
    def __init__(self, db: Session):
        self.db = db

    def purge_expired_archives(self, account_id: str | None = None) -> int:
        """Purge data snapshots for archives that exceeded the 30-day retention window."""
        now = datetime.utcnow()
        query = self.db.query(MerchantOperationsResetArchive).filter(
            MerchantOperationsResetArchive.status == "active",
            MerchantOperationsResetArchive.expires_at <= now,
        )
        if account_id:
            query = query.filter(MerchantOperationsResetArchive.account_id == account_id)

        expired_list = query.all()
        count = 0
        for arch in expired_list:
            arch.status = "expired"
            arch.purged_at = now
            arch.snapshot_json = None  # permanently delete archived operations snapshot
            count += 1

        if count > 0:
            self.db.flush()
            logger.info("Purged %d expired operations reset archives", count)
        return count

    def get_operations_status(self, account_id: str) -> dict[str, Any]:
        """Fetch current status: counts of operational data and any active reclaimable backup."""
        self.purge_expired_archives(account_id)
        now = datetime.utcnow()

        active_archive = (
            self.db.query(MerchantOperationsResetArchive)
            .filter(
                MerchantOperationsResetArchive.account_id == account_id,
                MerchantOperationsResetArchive.status == "active",
                MerchantOperationsResetArchive.expires_at > now,
            )
            .order_by(MerchantOperationsResetArchive.created_at.desc())
            .first()
        )

        archive_info: dict[str, Any] | None = None
        if active_archive:
            time_left = active_archive.expires_at - now
            days_left = max(0, time_left.days)
            hours_left = max(0, int(time_left.total_seconds() // 3600))
            archive_info = {
                "id": active_archive.id,
                "created_at": active_archive.created_at.isoformat() if active_archive.created_at else None,
                "expires_at": active_archive.expires_at.isoformat() if active_archive.expires_at else None,
                "days_remaining": days_left,
                "hours_remaining": hours_left,
                "summary": active_archive.summary_json or {},
            }

        orders_count = (
            self.db.query(func.count(Order.id))
            .filter(Order.account_id == account_id)
            .scalar()
            or 0
        )
        expenses_count = (
            self.db.query(func.count(ShopExpense.id))
            .filter(ShopExpense.account_id == account_id)
            .scalar()
            or 0
        )
        purchases_count = (
            self.db.query(func.count(PurchaseOrder.id))
            .filter(PurchaseOrder.account_id == account_id)
            .scalar()
            or 0
        )
        stock_movements_count = (
            self.db.query(func.count(StockMovement.id))
            .filter(StockMovement.account_id == account_id)
            .scalar()
            or 0
        )
        deliveries_count = (
            self.db.query(func.count(Delivery.id))
            .filter(Delivery.account_id == account_id)
            .scalar()
            or 0
        )
        supplier_payments_count = (
            self.db.query(func.count(ShopSupplierPayment.id))
            .filter(ShopSupplierPayment.account_id == account_id)
            .scalar()
            or 0
        )
        bookings_count = (
            self.db.query(func.count(Booking.id))
            .filter(Booking.account_id == account_id)
            .scalar()
            or 0
        )
        inventory_items_count = (
            self.db.query(func.count(InventoryItem.id))
            .filter(InventoryItem.account_id == account_id)
            .scalar()
            or 0
        )

        category_norm = func.replace(func.lower(func.trim(Catalogue.category)), " ", "_")
        menu_items_count = (
            self.db.query(func.count(InventoryItem.id))
            .join(Catalogue, Catalogue.id == InventoryItem.product_id)
            .filter(
                InventoryItem.account_id == account_id,
                or_(
                    Catalogue.product_type.in_(("meal", "combo", "addon")),
                    category_norm.in_(MENU_CATEGORIES),
                    Catalogue.created_by_account_id == account_id,
                ),
            )
            .scalar()
            or 0
        )
        recipes_count = (
            self.db.query(func.count(RecipeLine.id))
            .filter(RecipeLine.account_id == account_id)
            .scalar()
            or 0
        )

        return {
            "can_reset": True,
            "has_active_archive": active_archive is not None,
            "active_archive": archive_info,
            "current_counts": {
                "orders": orders_count,
                "expenses": expenses_count,
                "purchases": purchases_count,
                "stock_movements": stock_movements_count,
                "deliveries": deliveries_count,
                "supplier_payments": supplier_payments_count,
                "bookings": bookings_count,
                "inventory_items": inventory_items_count,
                "menu_items": menu_items_count,
                "recipes": recipes_count,
            },
        }

    def reset_operations_data(
        self,
        account_id: str,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """Safely backup operational data to a 30-day reclaimable archive and zero out active records."""
        self.purge_expired_archives(account_id)
        now = datetime.utcnow()
        expires_at = now + timedelta(days=RECLAIM_WINDOW_DAYS)

        # 1. Collect Orders & child entities
        orders = self.db.query(Order).filter(Order.account_id == account_id).all()
        order_ids = [o.id for o in orders]

        order_items = (
            self.db.query(OrderItem).filter(OrderItem.order_id.in_(order_ids)).all()
            if order_ids
            else []
        )
        status_histories = (
            self.db.query(OrderStatusHistory)
            .filter(OrderStatusHistory.order_id.in_(order_ids))
            .all()
            if order_ids
            else []
        )
        order_returns = (
            self.db.query(OrderReturn)
            .filter(OrderReturn.account_id == account_id)
            .all()
        )
        order_return_ids = [r.id for r in order_returns]
        order_return_items = (
            self.db.query(OrderReturnItem)
            .filter(OrderReturnItem.order_return_id.in_(order_return_ids))
            .all()
            if order_return_ids
            else []
        )

        # 2. Collect Deliveries & Offers
        deliveries = (
            self.db.query(Delivery)
            .filter(Delivery.account_id == account_id)
            .all()
        )
        delivery_ids = [d.id for d in deliveries]
        delivery_offers = (
            self.db.query(DeliveryOffer)
            .filter(
                (DeliveryOffer.account_id == account_id)
                | (DeliveryOffer.delivery_id.in_(delivery_ids))
            )
            .all()
            if delivery_ids
            else []
        )

        # 3. Collect Purchases & Lines
        purchase_orders = (
            self.db.query(PurchaseOrder)
            .filter(PurchaseOrder.account_id == account_id)
            .all()
        )
        purchase_ids = [p.id for p in purchase_orders]
        purchase_lines = (
            self.db.query(PurchaseOrderLine)
            .filter(PurchaseOrderLine.purchase_order_id.in_(purchase_ids))
            .all()
            if purchase_ids
            else []
        )

        # 4. Collect Stock Movements & Stock Takes
        stock_movements = (
            self.db.query(StockMovement)
            .filter(StockMovement.account_id == account_id)
            .all()
        )
        stock_takes = (
            self.db.query(StockTake)
            .filter(StockTake.account_id == account_id)
            .all()
        )
        stock_take_ids = [s.id for s in stock_takes]
        stock_take_lines = (
            self.db.query(StockTakeLine)
            .filter(StockTakeLine.stock_take_id.in_(stock_take_ids))
            .all()
            if stock_take_ids
            else []
        )

        # 5. Collect Expenses & Supplier Payments
        shop_expenses = (
            self.db.query(ShopExpense)
            .filter(ShopExpense.account_id == account_id)
            .all()
        )
        supplier_payments = (
            self.db.query(ShopSupplierPayment)
            .filter(ShopSupplierPayment.account_id == account_id)
            .all()
        )

        # 6. Collect Kitchen & Dining Operations
        kitchen_sessions = (
            self.db.query(KitchenShiftSession)
            .filter(KitchenShiftSession.account_id == account_id)
            .all()
        )
        kitchen_issues = (
            self.db.query(KitchenIssue)
            .filter(KitchenIssue.account_id == account_id)
            .all()
        )
        kitchen_issue_ids = [k.id for k in kitchen_issues]
        kitchen_issue_lines = (
            self.db.query(KitchenIssueLine)
            .filter(KitchenIssueLine.kitchen_issue_id.in_(kitchen_issue_ids))
            .all()
            if kitchen_issue_ids
            else []
        )
        inventory_items = (
            self.db.query(InventoryItem)
            .filter(InventoryItem.account_id == account_id)
            .all()
        )
        inventory_item_ids = [item.id for item in inventory_items]
        prepared_menu_stocks = (
            self.db.query(PreparedMenuStock)
            .filter(PreparedMenuStock.inventory_item_id.in_(inventory_item_ids))
            .all()
            if inventory_item_ids
            else []
        )

        # Collect Menu, Dishes, Recipes, and Modifiers to be erased
        category_norm = func.replace(func.lower(func.trim(Catalogue.category)), " ", "_")
        menu_inventory_items = (
            self.db.query(InventoryItem)
            .join(Catalogue, Catalogue.id == InventoryItem.product_id)
            .filter(
                InventoryItem.account_id == account_id,
                or_(
                    Catalogue.product_type.in_(("meal", "combo", "addon")),
                    category_norm.in_(MENU_CATEGORIES),
                    Catalogue.created_by_account_id == account_id,
                ),
            )
            .all()
        )
        menu_item_ids = [item.id for item in menu_inventory_items]
        menu_product_ids = [item.product_id for item in menu_inventory_items]

        menu_catalogues = (
            self.db.query(Catalogue)
            .filter(
                Catalogue.created_by_account_id == account_id,
                or_(
                    Catalogue.product_type.in_(("meal", "combo", "addon")),
                    category_norm.in_(MENU_CATEGORIES),
                    Catalogue.id.in_(menu_product_ids) if menu_product_ids else False,
                ),
            )
            .all()
        )
        menu_catalogue_ids = list(set([c.id for c in menu_catalogues] + menu_product_ids))

        recipe_lines = (
            self.db.query(RecipeLine)
            .filter(RecipeLine.account_id == account_id)
            .all()
        )
        recipe_serving_units = (
            self.db.query(RecipeServingUnit)
            .filter(RecipeServingUnit.account_id == account_id)
            .all()
        )
        kitchen_equiv_units = (
            self.db.query(KitchenEquivalenceUnit)
            .filter(KitchenEquivalenceUnit.account_id == account_id)
            .all()
        )
        modifier_groups = (
            self.db.query(ModifierGroup)
            .filter(ModifierGroup.account_id == account_id)
            .all()
        )
        mod_group_ids = [g.id for g in modifier_groups]
        modifier_options = (
            self.db.query(ModifierOption)
            .filter(ModifierOption.group_id.in_(mod_group_ids))
            .all()
            if mod_group_ids
            else []
        )
        mod_opt_ids = [o.id for o in modifier_options]
        modifier_option_recipes = (
            self.db.query(ModifierOptionRecipe)
            .filter(ModifierOptionRecipe.option_id.in_(mod_opt_ids))
            .all()
            if mod_opt_ids
            else []
        )
        catalogue_modifier_groups = (
            self.db.query(CatalogueModifierGroup)
            .filter(
                or_(
                    CatalogueModifierGroup.group_id.in_(mod_group_ids) if mod_group_ids else False,
                    CatalogueModifierGroup.product_id.in_(menu_catalogue_ids) if menu_catalogue_ids else False,
                )
            )
            .all()
            if (mod_group_ids or menu_catalogue_ids)
            else []
        )
        combo_components = (
            self.db.query(ComboComponent)
            .filter(
                or_(
                    ComboComponent.combo_id.in_(menu_catalogue_ids) if menu_catalogue_ids else False,
                    ComboComponent.component_product_id.in_(menu_catalogue_ids) if menu_catalogue_ids else False,
                )
            )
            .all()
            if menu_catalogue_ids
            else []
        )

        # 7. Collect Bookings & Operations Notifications
        bookings = (
            self.db.query(Booking)
            .filter(Booking.account_id == account_id)
            .all()
        )
        notifications = (
            self.db.query(MerchantNotification)
            .filter(MerchantNotification.account_id == account_id)
            .all()
        )

        # 8. M-PESA Transactions tied to merchant or orders
        mpesa_txns = (
            self.db.query(MpesaTransaction)
            .filter(
                (MpesaTransaction.account_id == account_id)
                | (MpesaTransaction.order_id.in_(order_ids) if order_ids else False)
            )
            .all()
        )

        # 9. Snapshot current state of inventory quantities & balances
        inventory_quantities = {
            item.id: {
                "stock_quantity": str(item.stock_quantity) if item.stock_quantity is not None else None,
                "kitchen_quantity": str(item.kitchen_quantity) if item.kitchen_quantity is not None else None,
                "prepared_quantity": str(item.prepared_quantity) if item.prepared_quantity is not None else None,
            }
            for item in inventory_items
        }

        account = self.db.get(Account, account_id)
        account_opening = {
            "opening_amount": str(account.opening_amount) if account and account.opening_amount is not None else None,
            "opening_amount_set_at": account.opening_amount_set_at.isoformat() if account and account.opening_amount_set_at else None,
            "opening_stock": str(account.opening_stock) if account and account.opening_stock is not None else None,
            "opening_stock_set_at": account.opening_stock_set_at.isoformat() if account and account.opening_stock_set_at else None,
            "opening_investment": str(account.opening_investment) if account and account.opening_investment is not None else None,
            "opening_investment_set_at": account.opening_investment_set_at.isoformat() if account and account.opening_investment_set_at else None,
        }

        customers = (
            self.db.query(ShopCustomer)
            .filter(ShopCustomer.account_id == account_id)
            .all()
        )
        customer_balances = {
            c.id: {
                "outstanding_balance": str(c.outstanding_balance) if c.outstanding_balance is not None else "0",
            }
            for c in customers
        }

        suppliers = (
            self.db.query(ShopSupplier)
            .filter(ShopSupplier.account_id == account_id)
            .all()
        )
        supplier_balances = {
            s.id: {
                "balance": str(s.balance) if s.balance is not None else "0",
            }
            for s in suppliers
        }

        # Build snapshot dictionary
        snapshot_json = {
            "orders": [_serialize_model(o) for o in orders],
            "order_items": [_serialize_model(i) for i in order_items],
            "status_histories": [_serialize_model(h) for h in status_histories],
            "order_returns": [_serialize_model(r) for r in order_returns],
            "order_return_items": [_serialize_model(ri) for ri in order_return_items],
            "deliveries": [_serialize_model(d) for d in deliveries],
            "delivery_offers": [_serialize_model(dof) for dof in delivery_offers],
            "purchase_orders": [_serialize_model(p) for p in purchase_orders],
            "purchase_lines": [_serialize_model(pl) for pl in purchase_lines],
            "stock_movements": [_serialize_model(sm) for sm in stock_movements],
            "stock_takes": [_serialize_model(st) for st in stock_takes],
            "stock_take_lines": [_serialize_model(stl) for stl in stock_take_lines],
            "shop_expenses": [_serialize_model(e) for e in shop_expenses],
            "supplier_payments": [_serialize_model(sp) for sp in supplier_payments],
            "kitchen_sessions": [_serialize_model(ks) for ks in kitchen_sessions],
            "kitchen_issues": [_serialize_model(ki) for ki in kitchen_issues],
            "kitchen_issue_lines": [_serialize_model(kil) for kil in kitchen_issue_lines],
            "prepared_menu_stocks": [_serialize_model(pms) for pms in prepared_menu_stocks],
            "menu_inventory_items": [_serialize_model(mi) for mi in menu_inventory_items],
            "menu_catalogues": [_serialize_model(mc) for mc in menu_catalogues],
            "recipe_lines": [_serialize_model(rl) for rl in recipe_lines],
            "recipe_serving_units": [_serialize_model(rsu) for rsu in recipe_serving_units],
            "kitchen_equiv_units": [_serialize_model(keu) for keu in kitchen_equiv_units],
            "modifier_groups": [_serialize_model(mg) for mg in modifier_groups],
            "modifier_options": [_serialize_model(mo) for mo in modifier_options],
            "modifier_option_recipes": [_serialize_model(mor) for mor in modifier_option_recipes],
            "catalogue_modifier_groups": [_serialize_model(cmg) for cmg in catalogue_modifier_groups],
            "combo_components": [_serialize_model(cc) for cc in combo_components],
            "bookings": [_serialize_model(b) for b in bookings],
            "notifications": [_serialize_model(n) for n in notifications],
            "mpesa_txns": [_serialize_model(m) for m in mpesa_txns],
            "inventory_quantities": inventory_quantities,
            "account_opening": account_opening,
            "customer_balances": customer_balances,
            "supplier_balances": supplier_balances,
        }

        summary_json = {
            "orders": len(orders),
            "expenses": len(shop_expenses),
            "purchases": len(purchase_orders),
            "stock_movements": len(stock_movements),
            "deliveries": len(deliveries),
            "supplier_payments": len(supplier_payments),
            "kitchen_issues": len(kitchen_issues),
            "bookings": len(bookings),
            "items_zeroed": len(inventory_items),
            "menu_items_erased": len(menu_inventory_items),
            "recipes_erased": len(recipe_lines),
            "modifier_groups_erased": len(modifier_groups),
        }

        archive = MerchantOperationsResetArchive(
            account_id=account_id,
            created_by_user_id=user_id,
            status="active",
            summary_json=summary_json,
            snapshot_json=snapshot_json,
            expires_at=expires_at,
            created_at=now,
            updated_at=now,
        )
        self.db.add(archive)
        self.db.flush()

        # Safely reset active operational data:
        # 1. Break circular and incoming foreign keys to Orders
        if order_ids:
            self.db.query(Order).filter(Order.id.in_(order_ids)).update(
                {Order.delivery_id: None, Order.mpesa_transaction_id: None},
                synchronize_session=False,
            )
            self.db.query(MpesaTransaction).filter(
                MpesaTransaction.order_id.in_(order_ids)
            ).update(
                {MpesaTransaction.order_id: None},
                synchronize_session=False,
            )
            self.db.query(Delivery).filter(
                Delivery.order_id.in_(order_ids)
            ).update(
                {Delivery.order_id: None},
                synchronize_session=False,
            )
            self.db.query(DeliveryOffer).filter(
                DeliveryOffer.order_id.in_(order_ids)
            ).update(
                {DeliveryOffer.order_id: None},
                synchronize_session=False,
            )
            self.db.query(StockMovement).filter(
                StockMovement.order_id.in_(order_ids)
            ).update(
                {StockMovement.order_id: None},
                synchronize_session=False,
            )
            self.db.flush()

        # 2. Delete M-PESA transactions
        mpesa_ids = [m.id for m in mpesa_txns]
        if mpesa_ids:
            self.db.query(MpesaTransaction).filter(
                MpesaTransaction.id.in_(mpesa_ids)
            ).delete(synchronize_session=False)

        # 3. Delete Deliveries & Offers
        if delivery_ids or order_ids:
            self.db.query(DeliveryOffer).filter(
                (DeliveryOffer.account_id == account_id)
                | (DeliveryOffer.delivery_id.in_(delivery_ids) if delivery_ids else False)
                | (DeliveryOffer.order_id.in_(order_ids) if order_ids else False)
            ).delete(synchronize_session=False)
            self.db.query(Delivery).filter(
                (Delivery.account_id == account_id)
                | (Delivery.id.in_(delivery_ids) if delivery_ids else False)
            ).delete(synchronize_session=False)

        # 4. Delete Order Returns & Return Items
        if order_return_ids:
            self.db.query(OrderReturnItem).filter(
                OrderReturnItem.order_return_id.in_(order_return_ids)
            ).delete(synchronize_session=False)
            self.db.query(OrderReturn).filter(
                OrderReturn.account_id == account_id
            ).delete(synchronize_session=False)

        # 5. Delete Order Items, Status History, and Orders
        if order_ids:
            self.db.query(OrderItem).filter(
                OrderItem.order_id.in_(order_ids)
            ).delete(synchronize_session=False)
            self.db.query(OrderStatusHistory).filter(
                OrderStatusHistory.order_id.in_(order_ids)
            ).delete(synchronize_session=False)
            self.db.query(Order).filter(
                Order.account_id == account_id
            ).delete(synchronize_session=False)

        # 6. Purchases
        if purchase_ids:
            self.db.query(PurchaseOrderLine).filter(
                PurchaseOrderLine.purchase_order_id.in_(purchase_ids)
            ).delete(synchronize_session=False)
            self.db.query(PurchaseOrder).filter(
                PurchaseOrder.account_id == account_id
            ).delete(synchronize_session=False)

        # Stock movements & stock takes
        if stock_take_ids:
            self.db.query(StockTakeLine).filter(
                StockTakeLine.stock_take_id.in_(stock_take_ids)
            ).delete(synchronize_session=False)
            self.db.query(StockTake).filter(
                StockTake.account_id == account_id
            ).delete(synchronize_session=False)

        self.db.query(StockMovement).filter(
            StockMovement.account_id == account_id
        ).delete(synchronize_session=False)

        # Expenses & Supplier Payments
        self.db.query(ShopExpense).filter(
            ShopExpense.account_id == account_id
        ).delete(synchronize_session=False)
        self.db.query(ShopSupplierPayment).filter(
            ShopSupplierPayment.account_id == account_id
        ).delete(synchronize_session=False)

        # Kitchen & dining
        if kitchen_issue_ids:
            self.db.query(KitchenIssueLine).filter(
                KitchenIssueLine.kitchen_issue_id.in_(kitchen_issue_ids)
            ).delete(synchronize_session=False)
            self.db.query(KitchenIssue).filter(
                KitchenIssue.account_id == account_id
            ).delete(synchronize_session=False)

        self.db.query(KitchenShiftSession).filter(
            KitchenShiftSession.account_id == account_id
        ).delete(synchronize_session=False)
        if inventory_item_ids:
            self.db.query(PreparedMenuStock).filter(
                PreparedMenuStock.inventory_item_id.in_(inventory_item_ids)
            ).delete(synchronize_session=False)

        # Bookings & Notifications
        self.db.query(Booking).filter(
            Booking.account_id == account_id
        ).delete(synchronize_session=False)
        self.db.query(MerchantNotification).filter(
            MerchantNotification.account_id == account_id
        ).delete(synchronize_session=False)

        # Delete Menu, recipes, modifier groups, and combo components
        if menu_catalogue_ids:
            self.db.query(ComboComponent).filter(
                or_(
                    ComboComponent.combo_id.in_(menu_catalogue_ids),
                    ComboComponent.component_product_id.in_(menu_catalogue_ids),
                )
            ).delete(synchronize_session=False)

        if mod_group_ids or menu_catalogue_ids:
            self.db.query(CatalogueModifierGroup).filter(
                or_(
                    CatalogueModifierGroup.group_id.in_(mod_group_ids) if mod_group_ids else False,
                    CatalogueModifierGroup.product_id.in_(menu_catalogue_ids) if menu_catalogue_ids else False,
                )
            ).delete(synchronize_session=False)

        if mod_opt_ids:
            self.db.query(ModifierOptionRecipe).filter(
                ModifierOptionRecipe.option_id.in_(mod_opt_ids)
            ).delete(synchronize_session=False)

        if mod_group_ids:
            self.db.query(ModifierOption).filter(
                ModifierOption.group_id.in_(mod_group_ids)
            ).delete(synchronize_session=False)

        self.db.query(ModifierGroup).filter(
            ModifierGroup.account_id == account_id
        ).delete(synchronize_session=False)

        self.db.query(RecipeLine).filter(
            RecipeLine.account_id == account_id
        ).delete(synchronize_session=False)
        self.db.query(RecipeServingUnit).filter(
            RecipeServingUnit.account_id == account_id
        ).delete(synchronize_session=False)
        self.db.query(KitchenEquivalenceUnit).filter(
            KitchenEquivalenceUnit.account_id == account_id
        ).delete(synchronize_session=False)

        if menu_item_ids:
            self.db.query(InventoryItem).filter(
                InventoryItem.id.in_(menu_item_ids),
                InventoryItem.account_id == account_id,
            ).delete(synchronize_session=False)

        user_catalogue_ids_to_del = [c.id for c in menu_catalogues if c.created_by_account_id == account_id]
        if user_catalogue_ids_to_del:
            self.db.query(Catalogue).filter(
                Catalogue.id.in_(user_catalogue_ids_to_del)
            ).delete(synchronize_session=False)

        # Zero out quantities and balances for remaining inventory items
        self.db.query(InventoryItem).filter(
            InventoryItem.account_id == account_id
        ).update(
            {
                InventoryItem.stock_quantity: 0,
                InventoryItem.kitchen_quantity: 0,
                InventoryItem.prepared_quantity: 0,
            },
            synchronize_session=False,
        )

        if account:
            account.opening_amount = None
            account.opening_amount_set_at = None
            account.opening_stock = None
            account.opening_stock_set_at = None
            account.opening_investment = None
            account.opening_investment_set_at = None

        self.db.query(ShopCustomer).filter(
            ShopCustomer.account_id == account_id
        ).update(
            {ShopCustomer.outstanding_balance: 0},
            synchronize_session=False,
        )
        self.db.query(ShopSupplier).filter(
            ShopSupplier.account_id == account_id
        ).update(
            {ShopSupplier.balance: 0},
            synchronize_session=False,
        )

        self.db.commit()
        logger.info(
            "Reset operations data for account=%s by user=%s (archive=%s)",
            account_id,
            user_id,
            archive.id,
        )

        return {
            "success": True,
            "archive_id": archive.id,
            "expires_at": expires_at.isoformat(),
            "days_remaining": RECLAIM_WINDOW_DAYS,
            "summary": summary_json,
        }

    def reclaim_operations_data(
        self,
        account_id: str,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """Restore archived operations data if within the 30-day window."""
        self.purge_expired_archives(account_id)
        now = datetime.utcnow()

        archive = (
            self.db.query(MerchantOperationsResetArchive)
            .filter(
                MerchantOperationsResetArchive.account_id == account_id,
                MerchantOperationsResetArchive.status == "active",
                MerchantOperationsResetArchive.expires_at > now,
            )
            .order_by(MerchantOperationsResetArchive.created_at.desc())
            .first()
        )

        if not archive or not archive.snapshot_json:
            raise ValueError(
                "No active backup found to reclaim, or the 30-day reclaim window has expired."
            )

        snapshot: dict[str, Any] = archive.snapshot_json

        # 0. Restore Menu Catalogues & Menu Inventory Items
        for row in snapshot.get("menu_catalogues", []):
            self.db.merge(_deserialize_model(Catalogue, row))
        self.db.flush()

        for row in snapshot.get("menu_inventory_items", []):
            self.db.merge(_deserialize_model(InventoryItem, row))
        self.db.flush()

        # Restore Kitchen & Recipe definitions
        for row in snapshot.get("kitchen_equiv_units", []):
            self.db.merge(_deserialize_model(KitchenEquivalenceUnit, row))
        for row in snapshot.get("recipe_serving_units", []):
            self.db.merge(_deserialize_model(RecipeServingUnit, row))
        for row in snapshot.get("recipe_lines", []):
            self.db.merge(_deserialize_model(RecipeLine, row))

        # Restore Modifiers and Combos
        for row in snapshot.get("modifier_groups", []):
            self.db.merge(_deserialize_model(ModifierGroup, row))
        self.db.flush()
        for row in snapshot.get("modifier_options", []):
            self.db.merge(_deserialize_model(ModifierOption, row))
        self.db.flush()
        for row in snapshot.get("modifier_option_recipes", []):
            self.db.merge(_deserialize_model(ModifierOptionRecipe, row))
        for row in snapshot.get("catalogue_modifier_groups", []):
            self.db.merge(_deserialize_model(CatalogueModifierGroup, row))
        for row in snapshot.get("combo_components", []):
            self.db.merge(_deserialize_model(ComboComponent, row))
        self.db.flush()

        # 1. Restore Notifications
        for row in snapshot.get("notifications", []):
            self.db.merge(_deserialize_model(MerchantNotification, row))

        # 2. Restore MPESA transactions
        for row in snapshot.get("mpesa_txns", []):
            self.db.merge(_deserialize_model(MpesaTransaction, row))

        # 3. Restore Purchases & Lines
        for row in snapshot.get("purchase_orders", []):
            self.db.merge(_deserialize_model(PurchaseOrder, row))
        for row in snapshot.get("purchase_lines", []):
            self.db.merge(_deserialize_model(PurchaseOrderLine, row))

        # 4. Restore Stock takes & movements
        for row in snapshot.get("stock_takes", []):
            self.db.merge(_deserialize_model(StockTake, row))
        for row in snapshot.get("stock_take_lines", []):
            self.db.merge(_deserialize_model(StockTakeLine, row))
        for row in snapshot.get("stock_movements", []):
            self.db.merge(_deserialize_model(StockMovement, row))

        # 5. Restore Expenses & Supplier payments
        for row in snapshot.get("shop_expenses", []):
            self.db.merge(_deserialize_model(ShopExpense, row))
        for row in snapshot.get("supplier_payments", []):
            self.db.merge(_deserialize_model(ShopSupplierPayment, row))

        # 6. Restore Kitchen & dining
        for row in snapshot.get("kitchen_sessions", []):
            self.db.merge(_deserialize_model(KitchenShiftSession, row))
        for row in snapshot.get("kitchen_issues", []):
            self.db.merge(_deserialize_model(KitchenIssue, row))
        for row in snapshot.get("kitchen_issue_lines", []):
            self.db.merge(_deserialize_model(KitchenIssueLine, row))
        for row in snapshot.get("prepared_menu_stocks", []):
            self.db.merge(_deserialize_model(PreparedMenuStock, row))

        # 7. Restore Bookings
        for row in snapshot.get("bookings", []):
            self.db.merge(_deserialize_model(Booking, row))

        # 8. Restore Orders (temporarily delivery_id = None to avoid circular FK)
        orders_data = snapshot.get("orders", [])
        for row in orders_data:
            ord_row = dict(row)
            ord_row["delivery_id"] = None
            self.db.merge(_deserialize_model(Order, ord_row))
        self.db.flush()

        for row in snapshot.get("order_items", []):
            self.db.merge(_deserialize_model(OrderItem, row))
        for row in snapshot.get("status_histories", []):
            self.db.merge(_deserialize_model(OrderStatusHistory, row))
        for row in snapshot.get("order_returns", []):
            self.db.merge(_deserialize_model(OrderReturn, row))
        for row in snapshot.get("order_return_items", []):
            self.db.merge(_deserialize_model(OrderReturnItem, row))

        # 9. Restore Deliveries & Offers
        for row in snapshot.get("deliveries", []):
            self.db.merge(_deserialize_model(Delivery, row))
        for row in snapshot.get("delivery_offers", []):
            self.db.merge(_deserialize_model(DeliveryOffer, row))
        self.db.flush()

        # 10. Re-link Order delivery_id & mpesa_transaction_id
        for row in orders_data:
            order_id = row.get("id")
            delivery_id = row.get("delivery_id")
            mpesa_txn_id = row.get("mpesa_transaction_id")
            if order_id and (delivery_id or mpesa_txn_id):
                self.db.query(Order).filter(Order.id == order_id).update(
                    {
                        Order.delivery_id: delivery_id,
                        Order.mpesa_transaction_id: mpesa_txn_id,
                    },
                    synchronize_session=False,
                )

        # 11. Restore Inventory Item Quantities
        inv_quantities: dict[str, Any] = snapshot.get("inventory_quantities", {})
        for item_id, qdata in inv_quantities.items():
            if isinstance(qdata, dict):
                stock_qty = (
                    Decimal(str(qdata["stock_quantity"]))
                    if qdata.get("stock_quantity") is not None
                    else None
                )
                kitchen_qty = (
                    Decimal(str(qdata["kitchen_quantity"]))
                    if qdata.get("kitchen_quantity") is not None
                    else None
                )
                prepared_qty = (
                    Decimal(str(qdata["prepared_quantity"]))
                    if qdata.get("prepared_quantity") is not None
                    else None
                )
                self.db.query(InventoryItem).filter(
                    InventoryItem.id == item_id,
                    InventoryItem.account_id == account_id,
                ).update(
                    {
                        InventoryItem.stock_quantity: stock_qty,
                        InventoryItem.kitchen_quantity: kitchen_qty,
                        InventoryItem.prepared_quantity: prepared_qty,
                    },
                    synchronize_session=False,
                )
            elif qdata is not None:
                self.db.query(InventoryItem).filter(
                    InventoryItem.id == item_id,
                    InventoryItem.account_id == account_id,
                ).update(
                    {InventoryItem.stock_quantity: Decimal(str(qdata))},
                    synchronize_session=False,
                )

        # 12. Restore Account opening figures
        account_opening: dict[str, Any] = snapshot.get("account_opening", {})
        account = self.db.get(Account, account_id)
        if account:
            account.opening_amount = (
                Decimal(account_opening["opening_amount"])
                if account_opening.get("opening_amount") is not None
                else None
            )
            account.opening_amount_set_at = (
                datetime.fromisoformat(account_opening["opening_amount_set_at"])
                if account_opening.get("opening_amount_set_at")
                else None
            )
            account.opening_stock = (
                Decimal(account_opening["opening_stock"])
                if account_opening.get("opening_stock") is not None
                else None
            )
            account.opening_stock_set_at = (
                datetime.fromisoformat(account_opening["opening_stock_set_at"])
                if account_opening.get("opening_stock_set_at")
                else None
            )
            account.opening_investment = (
                Decimal(account_opening["opening_investment"])
                if account_opening.get("opening_investment") is not None
                else None
            )
            account.opening_investment_set_at = (
                datetime.fromisoformat(account_opening["opening_investment_set_at"])
                if account_opening.get("opening_investment_set_at")
                else None
            )

        # 13. Restore Customer Balances
        customer_balances: dict[str, Any] = snapshot.get("customer_balances", {})
        for cust_id, bals in customer_balances.items():
            out_bal = bals.get("outstanding_balance") if isinstance(bals, dict) else bals
            if out_bal is not None:
                self.db.query(ShopCustomer).filter(
                    ShopCustomer.id == cust_id,
                    ShopCustomer.account_id == account_id,
                ).update(
                    {ShopCustomer.outstanding_balance: Decimal(str(out_bal))},
                    synchronize_session=False,
                )

        # 14. Restore Supplier Balances
        supplier_balances: dict[str, Any] = snapshot.get("supplier_balances", {})
        for supp_id, bals in supplier_balances.items():
            bal_val = (
                bals.get("balance")
                if isinstance(bals, dict) and "balance" in bals
                else (bals.get("outstanding_balance") if isinstance(bals, dict) else bals)
            )
            if bal_val is not None:
                self.db.query(ShopSupplier).filter(
                    ShopSupplier.id == supp_id,
                    ShopSupplier.account_id == account_id,
                ).update(
                    {ShopSupplier.balance: Decimal(str(bal_val))},
                    synchronize_session=False,
                )

        # 15. Mark archive as reclaimed
        archive.status = "reclaimed"
        archive.reclaimed_at = now
        archive.updated_at = now
        self.db.commit()

        logger.info(
            "Reclaimed operations data for account=%s by user=%s (archive=%s)",
            account_id,
            user_id,
            archive.id,
        )

        return {
            "success": True,
            "archive_id": archive.id,
            "reclaimed_at": now.isoformat(),
            "summary": archive.summary_json or {},
        }
