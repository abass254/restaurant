"""Shop suppliers — vendor directory for a merchant account."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import ShopSupplier, ShopSupplierPayment
from app.services.rider_service import normalize_phone
from app.support.datetime_utils import utc_now


class SupplierServiceError(ValueError):
    """Business rule violation for shop supplier operations."""


class SupplierService:
    def __init__(self, db: Session):
        self.db = db

    def list_suppliers(
        self,
        account_id: str,
        *,
        query: str | None = None,
    ) -> list[ShopSupplier]:
        q = self.db.query(ShopSupplier).filter(ShopSupplier.account_id == account_id)
        needle = (query or "").strip()
        if needle:
            like = f"%{needle}%"
            q = q.filter(
                or_(
                    ShopSupplier.name.ilike(like),
                    ShopSupplier.phone.ilike(like),
                    ShopSupplier.notes.ilike(like),
                    ShopSupplier.email.ilike(like),
                    ShopSupplier.pin_number.ilike(like),
                    ShopSupplier.city.ilike(like),
                    ShopSupplier.address.ilike(like),
                )
            )
        return q.order_by(func.lower(ShopSupplier.name).asc(), ShopSupplier.id.asc()).all()

    def get_supplier(self, account_id: str, supplier_id: str) -> ShopSupplier:
        supplier = (
            self.db.query(ShopSupplier)
            .filter(
                ShopSupplier.id == supplier_id,
                ShopSupplier.account_id == account_id,
            )
            .first()
        )
        if supplier is None:
            raise SupplierServiceError("Supplier not found.")
        return supplier

    def _find_duplicate_phone(
        self,
        account_id: str,
        phone: str,
        *,
        exclude_id: str | None = None,
    ) -> ShopSupplier | None:
        normalized = normalize_phone(phone)
        q = self.db.query(ShopSupplier).filter(
            ShopSupplier.account_id == account_id,
            ShopSupplier.phone == normalized,
        )
        if exclude_id:
            q = q.filter(ShopSupplier.id != exclude_id)
        return q.first()

    def _find_duplicate_pin(
        self,
        account_id: str,
        pin_number: str,
        *,
        exclude_id: str | None = None,
    ) -> ShopSupplier | None:
        clean_pin = pin_number.strip().upper()
        if not clean_pin:
            return None
        q = self.db.query(ShopSupplier).filter(
            ShopSupplier.account_id == account_id,
            func.upper(ShopSupplier.pin_number) == clean_pin,
        )
        if exclude_id:
            q = q.filter(ShopSupplier.id != exclude_id)
        return q.first()

    def _find_phoneless_by_name(self, account_id: str, name: str) -> ShopSupplier | None:
        return (
            self.db.query(ShopSupplier)
            .filter(
                ShopSupplier.account_id == account_id,
                ShopSupplier.phone.is_(None),
                func.lower(ShopSupplier.name) == name.strip().lower(),
            )
            .order_by(ShopSupplier.created_at.asc(), ShopSupplier.id.asc())
            .first()
        )

    def create_supplier(
        self,
        account_id: str,
        *,
        name: str,
        phone: str | None = None,
        notes: str | None = None,
        balance: Any = 0,
        credit_limit: Any = 0,
        balance_due_date: date | None = None,
        address: str | None = None,
        postal_code: str | None = None,
        city: str | None = None,
        email: str | None = None,
        fax: str | None = None,
        pin_number: str | None = None,
        commit: bool = True,
    ) -> ShopSupplier:
        clean_name = (name or "").strip()
        clean_phone = normalize_phone(phone) if phone else None
        if not clean_name:
            raise SupplierServiceError("Supplier name is required.")
        if clean_phone and self._find_duplicate_phone(account_id, clean_phone):
            raise SupplierServiceError("A supplier with this phone number already exists.")
        if not clean_phone and self._find_phoneless_by_name(account_id, clean_name):
            raise SupplierServiceError("A supplier with this name already exists.")

        now = utc_now()
        supplier = ShopSupplier(
            account_id=account_id,
            name=clean_name,
            phone=clean_phone,
            notes=(notes or "").strip() or None,
            balance=balance if balance is not None else 0,
            credit_limit=credit_limit if credit_limit is not None else 0,
            balance_due_date=balance_due_date,
            address=(address or "").strip() or None,
            postal_code=(postal_code or "").strip() or None,
            city=(city or "").strip() or None,
            email=(email or "").strip().lower() or None,
            fax=(fax or "").strip() or None,
            pin_number=(pin_number or "").strip().upper() or None,
            created_at=now,
            updated_at=now,
        )
        self.db.add(supplier)
        if commit:
            self.db.commit()
            self.db.refresh(supplier)
        return supplier

    def upsert_import_supplier(
        self,
        account_id: str,
        *,
        name: str,
        phone: str | None,
        notes: str | None = None,
        balance: Any = None,
        address: str | None = None,
        postal_code: str | None = None,
        city: str | None = None,
        email: str | None = None,
        fax: str | None = None,
        pin_number: str | None = None,
        overwrite: bool = False,
        commit: bool = True,
    ) -> tuple[ShopSupplier, str]:
        """Create or update by phone / PIN (or name, for phoneless rows) for import.

        ``None`` values keep what the supplier already has unless ``overwrite``
        is set, in which case the file replaces every imported field.
        """
        clean_name = (name or "").strip()
        if not clean_name:
            raise SupplierServiceError("Supplier name is required.")
        clean_phone = normalize_phone(phone or "") or None

        existing = self._find_duplicate_phone(account_id, clean_phone) if clean_phone else None
        if existing is None and pin_number:
            existing = self._find_duplicate_pin(account_id, pin_number)
        if existing is None and not clean_phone:
            existing = self._find_phoneless_by_name(account_id, clean_name)

        if existing is None:
            if clean_phone:
                supplier = self.create_supplier(
                    account_id,
                    name=clean_name,
                    phone=clean_phone,
                    notes=notes,
                    balance=balance,
                    address=address,
                    postal_code=postal_code,
                    city=city,
                    email=email,
                    fax=fax,
                    pin_number=pin_number,
                    commit=commit,
                )
                return supplier, "created"
            now = utc_now()
            supplier = ShopSupplier(
                account_id=account_id,
                name=clean_name,
                phone=None,
                notes=(notes or "").strip() or None,
                balance=balance if balance is not None else 0,
                address=(address or "").strip() or None,
                postal_code=(postal_code or "").strip() or None,
                city=(city or "").strip() or None,
                email=(email or "").strip().lower() or None,
                fax=(fax or "").strip() or None,
                pin_number=(pin_number or "").strip().upper() or None,
                created_at=now,
                updated_at=now,
            )
            self.db.add(supplier)
            if commit:
                self.db.commit()
                self.db.refresh(supplier)
            return supplier, "created"

        existing.name = clean_name
        if clean_phone:
            existing.phone = clean_phone
        if notes is not None or overwrite:
            existing.notes = (notes or "").strip() or None
        if balance is not None or overwrite:
            existing.balance = balance if balance is not None else 0
        if address is not None or overwrite:
            existing.address = (address or "").strip() or None
        if postal_code is not None or overwrite:
            existing.postal_code = (postal_code or "").strip() or None
        if city is not None or overwrite:
            existing.city = (city or "").strip() or None
        if email is not None or overwrite:
            existing.email = (email or "").strip().lower() or None
        if fax is not None or overwrite:
            existing.fax = (fax or "").strip() or None
        if pin_number is not None or overwrite:
            existing.pin_number = (pin_number or "").strip().upper() or None

        existing.updated_at = utc_now()
        if commit:
            self.db.commit()
            self.db.refresh(existing)
        return existing, "updated"

    def update_supplier(
        self,
        account_id: str,
        supplier_id: str,
        *,
        name: str | None = None,
        phone: str | None = None,
        notes: str | None = None,
        balance: Any = None,
        credit_limit: Any = None,
        balance_due_date: date | None = None,
        clear_balance_due_date: bool = False,
        address: str | None = None,
        postal_code: str | None = None,
        city: str | None = None,
        email: str | None = None,
        fax: str | None = None,
        pin_number: str | None = None,
        clear_notes: bool = False,
    ) -> ShopSupplier:
        supplier = self.get_supplier(account_id, supplier_id)
        if name is not None:
            clean_name = name.strip()
            if not clean_name:
                raise SupplierServiceError("Supplier name is required.")
            supplier.name = clean_name
        if phone is not None:
            clean_phone = normalize_phone(phone)
            if not clean_phone:
                raise SupplierServiceError("Supplier phone is required.")
            if self._find_duplicate_phone(account_id, clean_phone, exclude_id=supplier.id):
                raise SupplierServiceError(
                    "A supplier with this phone number already exists."
                )
            supplier.phone = clean_phone
        if clear_notes:
            supplier.notes = None
        elif notes is not None:
            supplier.notes = notes.strip() or None
        if balance is not None:
            supplier.balance = balance
        if credit_limit is not None:
            supplier.credit_limit = credit_limit
        if clear_balance_due_date:
            supplier.balance_due_date = None
        elif balance_due_date is not None:
            supplier.balance_due_date = balance_due_date
        if address is not None:
            supplier.address = address.strip() or None
        if postal_code is not None:
            supplier.postal_code = postal_code.strip() or None
        if city is not None:
            supplier.city = city.strip() or None
        if email is not None:
            supplier.email = email.strip().lower() or None
        if fax is not None:
            supplier.fax = fax.strip() or None
        if pin_number is not None:
            supplier.pin_number = pin_number.strip().upper() or None

        supplier.updated_at = utc_now()
        self.db.commit()
        self.db.refresh(supplier)
        return supplier

    def delete_supplier(self, account_id: str, supplier_id: str) -> None:
        supplier = self.get_supplier(account_id, supplier_id)
        self.db.delete(supplier)
        self.db.commit()

    def record_payment(
        self,
        account_id: str,
        supplier_id: str,
        *,
        amount: float,
        payment_method: str | None = "mpesa",
        reference: str | None = None,
        cheque_maturity_date: date | None = None,
        notes: str | None = None,
        paid_at: datetime | None = None,
        created_by: str | None = None,
    ) -> tuple[ShopSupplier, ShopSupplierPayment]:
        if amount is None or amount <= 0:
            raise SupplierServiceError("Payment amount must be greater than zero.")
        normalized_method = (payment_method or "mpesa").strip().lower()
        if normalized_method not in ("cash", "mpesa", "cheque"):
            normalized_method = "mpesa"

        actual_maturity = cheque_maturity_date if normalized_method == "cheque" else None

        supplier = self.get_supplier(account_id, supplier_id)
        current_bal = float(supplier.balance or 0.0)
        supplier.balance = round(current_bal - float(amount), 2)
        supplier.updated_at = utc_now()

        now = utc_now()
        payment = ShopSupplierPayment(
            account_id=account_id,
            supplier_id=supplier_id,
            amount=round(float(amount), 2),
            payment_method=normalized_method,
            reference=(reference or "").strip() or None,
            cheque_maturity_date=actual_maturity,
            notes=(notes or "").strip() or None,
            paid_at=paid_at or now,
            created_by=created_by,
            created_at=now,
            updated_at=now,
        )
        self.db.add(payment)
        self.db.commit()
        self.db.refresh(payment)
        self.db.refresh(supplier)
        return supplier, payment

    def list_payments(
        self,
        account_id: str,
        supplier_id: str,
        *,
        limit: int = 50,
    ) -> list[ShopSupplierPayment]:
        # ensure supplier exists and belongs to account
        self.get_supplier(account_id, supplier_id)
        return (
            self.db.query(ShopSupplierPayment)
            .filter(
                ShopSupplierPayment.account_id == account_id,
                ShopSupplierPayment.supplier_id == supplier_id,
            )
            .order_by(ShopSupplierPayment.paid_at.desc(), ShopSupplierPayment.created_at.desc())
            .limit(limit)
            .all()
        )

