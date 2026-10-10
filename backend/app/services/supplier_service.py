"""Shop suppliers — vendor directory for a merchant account."""

from __future__ import annotations

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import ShopSupplier
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

    def create_supplier(
        self,
        account_id: str,
        *,
        name: str,
        phone: str,
        notes: str | None = None,
        balance: Any = 0,
        address: str | None = None,
        postal_code: str | None = None,
        city: str | None = None,
        email: str | None = None,
        fax: str | None = None,
        pin_number: str | None = None,
        commit: bool = True,
    ) -> ShopSupplier:
        clean_name = (name or "").strip()
        clean_phone = normalize_phone(phone)
        if not clean_name:
            raise SupplierServiceError("Supplier name is required.")
        if not clean_phone:
            raise SupplierServiceError("Supplier phone is required.")
        if self._find_duplicate_phone(account_id, clean_phone):
            raise SupplierServiceError("A supplier with this phone number already exists.")

        now = utc_now()
        supplier = ShopSupplier(
            account_id=account_id,
            name=clean_name,
            phone=clean_phone,
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
        return supplier

    def upsert_import_supplier(
        self,
        account_id: str,
        *,
        name: str,
        phone: str,
        notes: str | None = None,
        balance: Any = None,
        address: str | None = None,
        postal_code: str | None = None,
        city: str | None = None,
        email: str | None = None,
        fax: str | None = None,
        pin_number: str | None = None,
        commit: bool = True,
    ) -> tuple[ShopSupplier, str]:
        """Create or update by phone / PIN for Excel or CSV import."""
        clean_phone = normalize_phone(phone)
        if not clean_phone:
            raise SupplierServiceError("Supplier phone is required.")

        existing = self._find_duplicate_phone(account_id, clean_phone)
        if existing is None and pin_number:
            existing = self._find_duplicate_pin(account_id, pin_number)

        if existing is None:
            supplier = self.create_supplier(
                account_id,
                name=name,
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

        clean_name = (name or "").strip()
        if not clean_name:
            raise SupplierServiceError("Supplier name is required.")
        existing.name = clean_name
        existing.phone = clean_phone
        if notes is not None:
            existing.notes = notes.strip() or None
        if balance is not None:
            existing.balance = balance
        if address is not None:
            existing.address = address.strip() or None
        if postal_code is not None:
            existing.postal_code = postal_code.strip() or None
        if city is not None:
            existing.city = city.strip() or None
        if email is not None:
            existing.email = email.strip().lower() or None
        if fax is not None:
            existing.fax = fax.strip() or None
        if pin_number is not None:
            existing.pin_number = pin_number.strip().upper() or None

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
