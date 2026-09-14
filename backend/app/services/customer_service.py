"""Shop customers — profiles and credit limits."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Literal

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import ShopCustomer
from app.services.rider_service import normalize_phone
from app.support.datetime_utils import utc_now

MONEY_QUANTUM = Decimal("0.01")
MAX_CREDIT_LIMIT = Decimal("99999999.99")
ImportUpsertStatus = Literal["created", "updated"]


class CustomerServiceError(ValueError):
    """Business rule violation for shop customer operations."""


def _money(value: object | None, *, field: str = "Credit limit") -> Decimal:
    if value is None or value == "":
        return Decimal("0.00")
    try:
        amount = Decimal(str(value)).quantize(MONEY_QUANTUM)
    except (InvalidOperation, ValueError) as exc:
        raise CustomerServiceError(f"{field} must be a valid amount.") from exc
    if amount < 0:
        raise CustomerServiceError(f"{field} cannot be negative.")
    if amount > MAX_CREDIT_LIMIT:
        raise CustomerServiceError(f"{field} is too large.")
    return amount


def available_credit(
    credit_limit: object | None,
    outstanding_balance: object | None,
) -> Decimal:
    remaining = _money(credit_limit) - _money(outstanding_balance, field="Outstanding balance")
    return remaining if remaining > 0 else Decimal("0.00")


class CustomerService:
    def __init__(self, db: Session):
        self.db = db

    def list_customers(
        self,
        account_id: str,
        *,
        query: str | None = None,
        owing: bool = False,
    ) -> list[ShopCustomer]:
        q = self.db.query(ShopCustomer).filter(ShopCustomer.account_id == account_id)
        needle = (query or "").strip()
        if needle:
            like = f"%{needle}%"
            q = q.filter(
                or_(
                    ShopCustomer.name.ilike(like),
                    ShopCustomer.phone.ilike(like),
                    ShopCustomer.email.ilike(like),
                )
            )
        if owing:
            q = q.filter(ShopCustomer.outstanding_balance > 0)
            return q.order_by(
                ShopCustomer.outstanding_balance.desc(),
                func.lower(ShopCustomer.name).asc(),
                ShopCustomer.id.asc(),
            ).all()
        return q.order_by(func.lower(ShopCustomer.name).asc(), ShopCustomer.id.asc()).all()

    def get_customer(self, account_id: str, customer_id: str) -> ShopCustomer:
        customer = (
            self.db.query(ShopCustomer)
            .filter(
                ShopCustomer.id == customer_id,
                ShopCustomer.account_id == account_id,
            )
            .first()
        )
        if customer is None:
            raise CustomerServiceError("Customer not found.")
        return customer

    def _find_duplicate_phone(
        self,
        account_id: str,
        phone: str,
        *,
        exclude_id: str | None = None,
    ) -> ShopCustomer | None:
        normalized = normalize_phone(phone)
        q = self.db.query(ShopCustomer).filter(
            ShopCustomer.account_id == account_id,
            ShopCustomer.phone == normalized,
        )
        if exclude_id:
            q = q.filter(ShopCustomer.id != exclude_id)
        return q.first()

    def create_customer(
        self,
        account_id: str,
        *,
        name: str,
        phone: str,
        email: str | None = None,
        address: str | None = None,
        notes: str | None = None,
        credit_limit: object | None = 0,
        outstanding_balance: object | None = 0,
        commit: bool = True,
    ) -> ShopCustomer:
        clean_name = (name or "").strip()
        clean_phone = normalize_phone(phone)
        clean_email = (email or "").strip().lower() or None
        if not clean_name:
            raise CustomerServiceError("Customer name is required.")
        if not clean_phone:
            raise CustomerServiceError("Customer phone is required.")
        if self._find_duplicate_phone(account_id, clean_phone):
            raise CustomerServiceError("A customer with this phone number already exists.")

        limit = _money(credit_limit)
        opening = _money(outstanding_balance, field="Opening balance")
        if limit > 0 and opening > limit:
            raise CustomerServiceError(
                "Opening balance cannot be higher than the credit limit."
            )

        now = utc_now()
        customer = ShopCustomer(
            account_id=account_id,
            name=clean_name,
            phone=clean_phone,
            email=clean_email,
            address=(address or "").strip() or None,
            notes=(notes or "").strip() or None,
            credit_limit=limit,
            outstanding_balance=opening,
            created_at=now,
            updated_at=now,
        )
        self.db.add(customer)
        if commit:
            self.db.commit()
            self.db.refresh(customer)
        return customer

    def upsert_import_customer(
        self,
        account_id: str,
        *,
        name: str,
        phone: str,
        email: str | None = None,
        address: str | None = None,
        notes: str | None = None,
        credit_limit: object | None = 0,
        outstanding_balance: object | None = 0,
        commit: bool = True,
    ) -> tuple[ShopCustomer, ImportUpsertStatus]:
        """Create or update by phone for Excel import (sets opening outstanding)."""
        clean_phone = normalize_phone(phone)
        if not clean_phone:
            raise CustomerServiceError("Customer phone is required.")
        existing = self._find_duplicate_phone(account_id, clean_phone)
        if existing is None:
            customer = self.create_customer(
                account_id,
                name=name,
                phone=clean_phone,
                email=email,
                address=address,
                notes=notes,
                credit_limit=credit_limit,
                outstanding_balance=outstanding_balance,
                commit=commit,
            )
            return customer, "created"

        clean_name = (name or "").strip()
        if not clean_name:
            raise CustomerServiceError("Customer name is required.")
        limit = _money(credit_limit)
        opening = _money(outstanding_balance, field="Opening balance")
        if limit > 0 and opening > limit:
            raise CustomerServiceError(
                "Opening balance cannot be higher than the credit limit."
            )

        existing.name = clean_name
        existing.phone = clean_phone
        if email is not None:
            existing.email = email.strip().lower() or None
        if address is not None:
            existing.address = address.strip() or None
        if notes is not None:
            existing.notes = notes.strip() or None
        existing.credit_limit = limit
        existing.outstanding_balance = opening
        existing.updated_at = utc_now()
        if commit:
            self.db.commit()
            self.db.refresh(existing)
        return existing, "updated"

    def update_customer(
        self,
        account_id: str,
        customer_id: str,
        *,
        name: str | None = None,
        phone: str | None = None,
        email: str | None = None,
        address: str | None = None,
        notes: str | None = None,
        credit_limit: object | None = None,
        clear_email: bool = False,
        clear_address: bool = False,
        clear_notes: bool = False,
    ) -> ShopCustomer:
        customer = self.get_customer(account_id, customer_id)
        if name is not None:
            clean_name = name.strip()
            if not clean_name:
                raise CustomerServiceError("Customer name is required.")
            customer.name = clean_name
        if phone is not None:
            clean_phone = normalize_phone(phone)
            if not clean_phone:
                raise CustomerServiceError("Customer phone is required.")
            if self._find_duplicate_phone(account_id, clean_phone, exclude_id=customer.id):
                raise CustomerServiceError("A customer with this phone number already exists.")
            customer.phone = clean_phone
        if clear_email:
            customer.email = None
        elif email is not None:
            customer.email = email.strip().lower() or None
        if clear_address:
            customer.address = None
        elif address is not None:
            customer.address = address.strip() or None
        if clear_notes:
            customer.notes = None
        elif notes is not None:
            customer.notes = notes.strip() or None
        if credit_limit is not None:
            new_limit = _money(credit_limit)
            outstanding = _money(customer.outstanding_balance, field="Outstanding balance")
            if new_limit < outstanding:
                raise CustomerServiceError(
                    "Credit limit cannot be lower than the amount already outstanding."
                )
            customer.credit_limit = new_limit
        customer.updated_at = utc_now()
        self.db.commit()
        self.db.refresh(customer)
        return customer

    def _locked_by_phone(self, account_id: str, phone: str) -> ShopCustomer | None:
        normalized = normalize_phone(phone)
        if not normalized:
            return None
        return (
            self.db.query(ShopCustomer)
            .filter(
                ShopCustomer.account_id == account_id,
                ShopCustomer.phone == normalized,
            )
            .with_for_update()
            .first()
        )

    def get_or_create_for_sale(
        self,
        account_id: str,
        *,
        name: str,
        phone: str,
    ) -> ShopCustomer:
        """Find a customer by phone, or create one, without committing."""
        clean_name = (name or "").strip()
        clean_phone = normalize_phone(phone)
        if not clean_name:
            raise CustomerServiceError("Customer name is required for credit sales.")
        if not clean_phone:
            raise CustomerServiceError("Customer phone is required for credit sales.")
        existing = self._locked_by_phone(account_id, clean_phone)
        if existing is not None:
            return existing
        now = utc_now()
        customer = ShopCustomer(
            account_id=account_id,
            name=clean_name,
            phone=clean_phone,
            credit_limit=Decimal("0.00"),
            outstanding_balance=Decimal("0.00"),
            created_at=now,
            updated_at=now,
        )
        self.db.add(customer)
        self.db.flush()
        return customer

    def charge_credit(self, customer: ShopCustomer, amount: object) -> None:
        sale = _money(amount, field="Sale total")
        if sale <= 0:
            raise CustomerServiceError("Credit sale total must be greater than zero.")
        outstanding = _money(customer.outstanding_balance, field="Outstanding balance")
        limit = _money(customer.credit_limit)
        leftover = available_credit(limit, outstanding)
        if limit > 0 and sale > leftover:
            raise CustomerServiceError(
                f"Only Ksh{leftover} credit is left for this customer."
            )
        customer.outstanding_balance = outstanding + sale
        customer.updated_at = utc_now()

    def release_credit(self, customer: ShopCustomer, amount: object) -> None:
        sale = _money(amount, field="Sale total")
        outstanding = _money(customer.outstanding_balance, field="Outstanding balance")
        remaining = outstanding - sale
        customer.outstanding_balance = remaining if remaining > 0 else Decimal("0.00")
        customer.updated_at = utc_now()

    def collect_credit(self, customer: ShopCustomer, amount: object) -> Decimal:
        """Take money off a tab. Applies at most the outstanding balance."""
        payment = _money(amount, field="Collection")
        if payment <= 0:
            raise CustomerServiceError("Collection must be greater than zero.")
        outstanding = _money(customer.outstanding_balance, field="Outstanding balance")
        if outstanding <= 0:
            raise CustomerServiceError("This customer does not owe anything.")
        applied = payment if payment <= outstanding else outstanding
        customer.outstanding_balance = outstanding - applied
        customer.updated_at = utc_now()
        return applied

    def release_credit_for_order(
        self,
        account_id: str,
        *,
        phone: str | None,
        amount: object,
    ) -> None:
        if not phone:
            return
        customer = self._locked_by_phone(account_id, phone)
        if customer is None:
            return
        self.release_credit(customer, amount)

    def delete_customer(self, account_id: str, customer_id: str) -> None:
        customer = self.get_customer(account_id, customer_id)
        outstanding = _money(customer.outstanding_balance, field="Outstanding balance")
        if outstanding > 0:
            raise CustomerServiceError(
                "This customer still has an outstanding balance and cannot be removed."
            )
        self.db.delete(customer)
        self.db.commit()
