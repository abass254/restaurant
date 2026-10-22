"""Shop customers — profiles and credit limits."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import ShopCustomer
from app.services.rider_service import normalize_phone
from app.support.datetime_utils import utc_now

MONEY_QUANTUM = Decimal("0.01")
MAX_CREDIT_LIMIT = Decimal("99999999.99")
DEFAULT_CREDIT_LIMIT = Decimal("1000.00")
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


def _pay_date(value: date | str | None) -> date | None:
    if value is None or isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise CustomerServiceError("Date to pay must be in YYYY-MM-DD format.") from exc


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

    def _find_phoneless_by_name(self, account_id: str, name: str) -> ShopCustomer | None:
        return (
            self.db.query(ShopCustomer)
            .filter(
                ShopCustomer.account_id == account_id,
                ShopCustomer.phone.is_(None),
                func.lower(ShopCustomer.name) == name.strip().lower(),
            )
            .order_by(ShopCustomer.created_at.asc(), ShopCustomer.id.asc())
            .first()
        )

    def create_customer(
        self,
        account_id: str,
        *,
        name: str,
        phone: str,
        email: str | None = None,
        address: str | None = None,
        postal_code: str | None = None,
        city: str | None = None,
        fax: str | None = None,
        physical_location: str | None = None,
        date_to_pay: date | str | None = None,
        notes: str | None = None,
        credit_limit: object | None = DEFAULT_CREDIT_LIMIT,
        outstanding_balance: object | None = 0,
        allow_over_limit: bool = False,
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
        if not allow_over_limit and limit > 0 and opening > limit:
            raise CustomerServiceError(
                "Opening balance cannot be higher than the credit limit."
            )
        clean_location = (physical_location or "").strip() or None
        due_date = _pay_date(date_to_pay)

        now = utc_now()
        customer = ShopCustomer(
            account_id=account_id,
            name=clean_name,
            phone=clean_phone,
            email=clean_email,
            address=(address or "").strip() or clean_location,
            postal_code=(postal_code or "").strip() or None,
            city=(city or "").strip() or None,
            fax=(fax or "").strip() or None,
            physical_location=clean_location,
            date_to_pay=due_date,
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
        phone: str | None,
        email: str | None = None,
        address: str | None = None,
        postal_code: str | None = None,
        city: str | None = None,
        fax: str | None = None,
        notes: str | None = None,
        credit_limit: object | None = 0,
        outstanding_balance: object | None = 0,
        overwrite: bool = False,
        commit: bool = True,
    ) -> tuple[ShopCustomer, ImportUpsertStatus]:
        """Create or update for Excel import (sets opening outstanding).

        Matches by phone, or by name among phoneless customers when the row has
        no phone. ``None`` values keep what the customer already has unless
        ``overwrite`` is set, in which case the file replaces every imported field.
        Opening balances above the credit limit are kept as-is (carried-over debt);
        available credit is simply zero until it is paid down.
        """
        clean_name = (name or "").strip()
        if not clean_name:
            raise CustomerServiceError("Customer name is required.")
        clean_phone = normalize_phone(phone or "") or None
        if clean_phone:
            existing = self._find_duplicate_phone(account_id, clean_phone)
        else:
            existing = self._find_phoneless_by_name(account_id, clean_name)
        if existing is None:
            if clean_phone:
                customer = self.create_customer(
                    account_id,
                    name=clean_name,
                    phone=clean_phone,
                    email=email,
                    address=address,
                    postal_code=postal_code,
                    city=city,
                    fax=fax,
                    notes=notes,
                    credit_limit=credit_limit or 0,
                    outstanding_balance=outstanding_balance or 0,
                    allow_over_limit=True,
                    commit=commit,
                )
                return customer, "created"
            limit = _money(credit_limit)
            opening = _money(outstanding_balance, field="Opening balance")
            now = utc_now()
            customer = ShopCustomer(
                account_id=account_id,
                name=clean_name,
                phone=None,
                email=(email or "").strip().lower() or None,
                address=(address or "").strip() or None,
                postal_code=(postal_code or "").strip() or None,
                city=(city or "").strip() or None,
                fax=(fax or "").strip() or None,
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
            return customer, "created"

        if credit_limit is None and not overwrite:
            credit_limit = existing.credit_limit
        if outstanding_balance is None and not overwrite:
            outstanding_balance = existing.outstanding_balance
        limit = _money(credit_limit)
        opening = _money(outstanding_balance, field="Opening balance")

        existing.name = clean_name
        existing.phone = clean_phone
        if email is not None or overwrite:
            existing.email = (email or "").strip().lower() or None
        if address is not None or overwrite:
            existing.address = (address or "").strip() or None
        if postal_code is not None or overwrite:
            existing.postal_code = (postal_code or "").strip() or None
        if city is not None or overwrite:
            existing.city = (city or "").strip() or None
        if fax is not None or overwrite:
            existing.fax = (fax or "").strip() or None
        if notes is not None or overwrite:
            existing.notes = (notes or "").strip() or None
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
        postal_code: str | None = None,
        city: str | None = None,
        fax: str | None = None,
        physical_location: str | None = None,
        date_to_pay: date | str | None = None,
        notes: str | None = None,
        credit_limit: object | None = None,
        outstanding_balance: object | None = None,
        clear_email: bool = False,
        clear_address: bool = False,
        clear_physical_location: bool = False,
        clear_date_to_pay: bool = False,
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
        if postal_code is not None:
            customer.postal_code = postal_code.strip() or None
        if city is not None:
            customer.city = city.strip() or None
        if fax is not None:
            customer.fax = fax.strip() or None
        if clear_physical_location:
            customer.physical_location = None
        elif physical_location is not None:
            customer.physical_location = physical_location.strip() or None
        if clear_date_to_pay:
            customer.date_to_pay = None
        elif date_to_pay is not None:
            customer.date_to_pay = _pay_date(date_to_pay)
        if clear_notes:
            customer.notes = None
        elif notes is not None:
            customer.notes = notes.strip() or None
        if credit_limit is not None:
            new_limit = _money(credit_limit)
            outstanding = _money(customer.outstanding_balance, field="Outstanding balance")
            if new_limit > 0 and new_limit < outstanding:
                raise CustomerServiceError(
                    "Credit limit cannot be lower than the amount already outstanding."
                )
            customer.credit_limit = new_limit
        if outstanding_balance is not None:
            opening = _money(outstanding_balance, field="Outstanding balance")
            limit = _money(customer.credit_limit)
            if limit > 0 and opening > limit:
                raise CustomerServiceError(
                    "Outstanding balance cannot be higher than the credit limit."
                )
            customer.outstanding_balance = opening
        customer.updated_at = utc_now()
        self.db.commit()
        self.db.refresh(customer)
        return customer

    def find_by_phone(self, account_id: str, phone: str) -> ShopCustomer | None:
        normalized = normalize_phone(phone)
        if not normalized:
            return None
        return (
            self.db.query(ShopCustomer)
            .filter(
                ShopCustomer.account_id == account_id,
                ShopCustomer.phone == normalized,
            )
            .first()
        )

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
        customer_id: str | None = None,
        name: str,
        phone: str | None = None,
    ) -> ShopCustomer:
        """Find a customer by id, phone, or name, or create one, without committing."""
        if customer_id:
            existing = (
                self.db.query(ShopCustomer)
                .filter(
                    ShopCustomer.account_id == account_id,
                    ShopCustomer.id == customer_id,
                )
                .with_for_update()
                .first()
            )
            if existing is not None:
                return existing

        clean_name = (name or "").strip()
        clean_phone = normalize_phone(phone) if phone else None
        if not clean_name:
            raise CustomerServiceError("Customer name is required for credit sales.")

        if clean_phone:
            existing = self._locked_by_phone(account_id, clean_phone)
            if existing is not None:
                return existing

        existing_by_name = (
            self.db.query(ShopCustomer)
            .filter(
                ShopCustomer.account_id == account_id,
                func.lower(ShopCustomer.name) == clean_name.lower(),
            )
            .with_for_update()
            .first()
        )
        if existing_by_name is not None:
            return existing_by_name

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

    def charge_credit(
        self,
        customer: ShopCustomer,
        amount: object,
        *,
        date_to_pay: date | str | None = None,
    ) -> None:
        sale = _money(amount, field="Sale total")
        if sale <= 0:
            raise CustomerServiceError("Credit sale total must be greater than zero.")
        due_date = _pay_date(date_to_pay)
        outstanding = _money(customer.outstanding_balance, field="Outstanding balance")
        limit = _money(customer.credit_limit)
        leftover = available_credit(limit, outstanding)
        if limit > 0 and sale > leftover:
            raise CustomerServiceError(
                f"Only Ksh{leftover} credit is left for this customer."
            )
        customer.outstanding_balance = outstanding + sale
        if due_date is not None:
            customer.date_to_pay = due_date
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
        phone: str | None = None,
        name: str | None = None,
        customer_id: str | None = None,
        amount: object,
    ) -> None:
        customer = None
        if customer_id:
            customer = (
                self.db.query(ShopCustomer)
                .filter(
                    ShopCustomer.account_id == account_id,
                    ShopCustomer.id == customer_id,
                )
                .with_for_update()
                .first()
            )
        if customer is None and phone:
            customer = self._locked_by_phone(account_id, phone)
        if customer is None and name:
            customer = (
                self.db.query(ShopCustomer)
                .filter(
                    ShopCustomer.account_id == account_id,
                    func.lower(ShopCustomer.name) == name.strip().lower(),
                )
                .with_for_update()
                .first()
            )
        if customer is None:
            return
        self.release_credit(customer, amount)

    def rebalance_order_credit(
        self,
        account_id: str,
        *,
        previous_phone: str | None,
        previous_amount: object,
        phone: str | None,
        name: str | None,
        amount: object,
        customer_id: str | None = None,
        previous_name: str | None = None,
    ) -> None:
        """After an order edit, charge or release the change in what it puts on credit."""
        before = _money(previous_amount, field="Sale total")
        after = _money(amount, field="Sale total")
        is_same_customer = (
            (previous_phone and phone and normalize_phone(previous_phone) == normalize_phone(phone))
            or (not previous_phone and not phone and (previous_name or "").strip().lower() == (name or "").strip().lower())
        )
        if is_same_customer:
            change = after - before
            if change < 0:
                if phone:
                    self.release_credit_for_order(account_id, phone=phone, amount=-change)
                else:
                    self.release_credit_for_order(
                        account_id,
                        name=name,
                        customer_id=customer_id,
                        amount=-change,
                    )
            elif change > 0:
                if customer_id:
                    customer = self.get_or_create_for_sale(
                        account_id,
                        customer_id=customer_id,
                        name=name or "",
                        phone=phone or "",
                    )
                else:
                    customer = self.get_or_create_for_sale(
                        account_id,
                        name=name or "",
                        phone=phone or "",
                    )
                self.charge_credit(customer, change)
            return
        if before > 0:
            if previous_phone:
                self.release_credit_for_order(account_id, phone=previous_phone, amount=before)
            else:
                self.release_credit_for_order(
                    account_id,
                    name=previous_name,
                    amount=before,
                )
        if after > 0:
            if customer_id:
                customer = self.get_or_create_for_sale(
                    account_id,
                    customer_id=customer_id,
                    name=name or "",
                    phone=phone or "",
                )
            else:
                customer = self.get_or_create_for_sale(
                    account_id,
                    name=name or "",
                    phone=phone or "",
                )
            self.charge_credit(customer, after)

    def delete_customer(self, account_id: str, customer_id: str) -> None:
        customer = self.get_customer(account_id, customer_id)
        outstanding = _money(customer.outstanding_balance, field="Outstanding balance")
        if outstanding > 0:
            raise CustomerServiceError(
                "This customer still has an outstanding balance and cannot be removed."
            )
        self.db.delete(customer)
        self.db.commit()
