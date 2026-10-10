"""Public pay-bill page — customer pays outstanding credit via M-PESA STK."""

from __future__ import annotations

import logging
from decimal import Decimal

from sqlalchemy.orm import Session, joinedload

from app.config import Settings, get_settings
from app.core.credit_pay_tokens import (
    CreditPayTokenInvalid,
    mint_credit_pay_token,
    read_credit_pay_token,
)
from app.models import Account, MpesaTransaction, ShopCustomer
from app.services import mpesa_service
from app.services.customer_service import CustomerService, available_credit
from app.services.mpesa_service import MpesaApiError, MpesaConfigurationMissing
from app.services.platform_runtime import is_dev_runtime
from app.support.mpesa_amounts import min_collection_kes

logger = logging.getLogger(__name__)


class CreditPayError(RuntimeError):
    pass


class CreditPayUnavailable(RuntimeError):
    pass


def _money(value: object | None) -> float:
    return float(Decimal(str(value or 0)).quantize(Decimal("0.01")))


class CreditPayService:
    def __init__(self, db: Session, settings: Settings | None = None):
        self.db = db
        self.settings = settings or get_settings()

    @staticmethod
    def pay_bill_url(customer_id: str, settings: Settings | None = None) -> str | None:
        cfg = settings or get_settings()
        base = (cfg.frontend_url or "").rstrip("/")
        if not base:
            return None
        token = mint_credit_pay_token(customer_id)
        return f"{base}/pay-bill/{token}"

    def _customer(self, token: str) -> ShopCustomer:
        try:
            payload = read_credit_pay_token(token)
        except CreditPayTokenInvalid as exc:
            raise CreditPayUnavailable(str(exc)) from exc
        customer_id = str(payload.get("cid") or "").strip()
        customer = (
            self.db.query(ShopCustomer)
            .options(joinedload(ShopCustomer.account))
            .filter(ShopCustomer.id == customer_id)
            .first()
        )
        if customer is None:
            raise CreditPayUnavailable("This pay-bill link is no longer valid.")
        return customer

    def load(self, token: str) -> dict:
        customer = self._customer(token)
        account: Account | None = customer.account
        shop_name = (account.business_name if account else None) or "Shop"
        outstanding = _money(customer.outstanding_balance)
        return {
            "merchant": {"name": shop_name},
            "customer_name": customer.name,
            "phone": customer.phone,
            "currency": "KES",
            "outstanding_balance": outstanding,
            "credit_limit": _money(customer.credit_limit),
            "available_credit": _money(
                available_credit(customer.credit_limit, customer.outstanding_balance)
            ),
            "can_pay": outstanding > 0,
            "is_cleared": outstanding <= 0,
            "dev_mpesa_charge": 1 if is_dev_runtime(self.db) else None,
        }

    def submit(
        self,
        token: str,
        *,
        phone: str | None = None,
        amount: float | None = None,
        consent: bool = False,
    ) -> dict:
        if not consent:
            raise CreditPayError("Confirm you want to pay this bill with M-PESA.")

        customer = self._customer(token)
        outstanding = Decimal(str(customer.outstanding_balance or 0)).quantize(Decimal("0.01"))
        if outstanding <= 0:
            raise CreditPayError("This tab is already cleared.")

        pay_amount = (
            Decimal(str(amount)).quantize(Decimal("0.01"))
            if amount is not None
            else outstanding
        )
        if pay_amount <= 0:
            raise CreditPayError("Enter an amount greater than zero.")
        if pay_amount > outstanding:
            raise CreditPayError("That is more than this tab owes.")

        account_id = str(customer.account_id)
        profile = mpesa_service.get_merchant_profile(self.db, account_id)
        if not profile:
            raise CreditPayError("This shop cannot take M-PESA payments right now.")

        kes = int(round(float(pay_amount)))
        min_kes = min_collection_kes(
            profile.shortcode_type if profile else None,
            sandbox=mpesa_service.use_mpesa_sandbox(self.db),
        )
        if kes < min_kes:
            raise CreditPayError(f"M-PESA's minimum is KES {min_kes}.")

        phone_number = (phone or customer.phone or "").strip()
        if not phone_number:
            raise CreditPayError("Enter the M-PESA phone number to pay from.")
        try:
            txn = mpesa_service.stk_push(
                self.db,
                phone_number=phone_number,
                amount=kes,
                account_reference=f"TAB{customer.id[:8]}",
                transaction_desc=f"Tab {customer.name}"[:13],
                initiated_by_user_id=None,
                account_id=account_id,
                shop_customer_id=customer.id,
                credit_collect_amount=kes,
            )
        except MpesaConfigurationMissing as exc:
            raise CreditPayError(str(exc)) from exc
        except MpesaApiError as exc:
            raise CreditPayError(str(exc)) from exc

        return {
            **self.load(token),
            "mpesa_payment": {
                "id": txn.id,
                "status": txn.status,
                "amount": kes,
                "message": txn.result_desc,
                "can_retry": txn.status in {"failed", "cancelled"},
            },
        }

    def collection_status(self, token: str, transaction_id: str) -> dict:
        customer = self._customer(token)
        txn = (
            self.db.query(MpesaTransaction)
            .filter(
                MpesaTransaction.id == transaction_id,
                MpesaTransaction.shop_customer_id == customer.id,
                MpesaTransaction.account_id == customer.account_id,
            )
            .first()
        )
        if txn is None:
            raise CreditPayError("Payment not found.")

        if txn.status == "success":
            from app.services.mpesa_service import apply_credit_collection_if_paid

            apply_credit_collection_if_paid(self.db, txn)
            self.db.commit()
            self.db.refresh(customer)

        return {
            **self.load(token),
            "mpesa_payment": {
                "id": txn.id,
                "status": txn.status,
                "amount": txn.credit_collect_amount or txn.amount,
                "message": txn.result_desc,
                "collected": bool(txn.credit_collected_at),
                "can_retry": txn.status in {"failed", "cancelled"},
            },
        }
