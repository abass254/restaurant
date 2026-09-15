"""Tests for customer WhatsApp reminder endpoint via OpenWA API."""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from decimal import Decimal
import pytest

from app.services.openwa_service import OpenWaSendResult


@patch("app.api.v1.customers.OpenWaAgentService")
def test_send_customer_whatsapp_reminder_invokes_openwa(mock_agent_cls: MagicMock) -> None:
    mock_agent = MagicMock()
    mock_agent.configured = True
    mock_agent.send_text.return_value = OpenWaSendResult(ok=True, message_id="msg-123")
    mock_agent_cls.return_value = mock_agent

    db = MagicMock()
    customer = MagicMock()
    customer.id = "cust-1"
    customer.name = "Abass Ahmed"
    customer.phone = "+254712345678"
    customer.outstanding_balance = Decimal("200.00")

    account = MagicMock()
    account.business_name = "Nextverse Electronics"

    db.query.return_value.filter.return_value.first.return_value = account

    from app.api.v1.customers import send_customer_whatsapp_reminder
    session = {"user_id": "u-1", "user_role": "owner"}
    request = MagicMock()

    with patch("app.api.v1.customers.require_user"), \
         patch("app.api.v1.customers.assert_merchant_section_any_access"), \
         patch("app.api.v1.customers.require_merchant_account_id", return_value="acct-1"), \
         patch("app.api.v1.customers.validate_csrf"), \
         patch("app.api.v1.customers.CustomerService") as mock_svc_cls:
        
        mock_svc = MagicMock()
        mock_svc.get_customer.return_value = customer
        mock_svc_cls.return_value = mock_svc

        res = send_customer_whatsapp_reminder("cust-1", request, db, session)
        assert res["sent"] is True
        assert res["message_id"] == "msg-123"
        mock_agent.send_text.assert_called_once()
        call_kwargs = mock_agent.send_text.call_args.kwargs
        assert call_kwargs["to"] == "+254712345678"
        assert "Nextverse Electronics" in call_kwargs["text"]
        assert "Ksh200.00" in call_kwargs["text"]
