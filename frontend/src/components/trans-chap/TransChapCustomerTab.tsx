"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatNairobiDate } from "@/lib/nairobi-time";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type { CustomerTab, CustomerTabSale } from "@/lib/types";

type Props = {
  customerId: string;
  /** Changes whenever the balance changes so the breakdown refetches. */
  balance: number;
};

const STATE_LABEL: Record<CustomerTabSale["state"], string> = {
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
};

function SaleCard({ sale }: { sale: CustomerTabSale }) {
  return (
    <li className={`trans-chap-customer-tab__sale is-${sale.state}`}>
      <div className="trans-chap-customer-tab__sale-head">
        <div>
          <strong>#{sale.order_number}</strong>
          <span>{formatNairobiDate(sale.placed_at)}</span>
        </div>
        <div className="trans-chap-customer-tab__sale-amt">
          <strong>{formatKsh(sale.state === "paid" ? sale.total : sale.amount_due)}</strong>
          <span className={`trans-chap-customer-tab__pill is-${sale.state}`}>
            {sale.state === "partial"
              ? `${STATE_LABEL.partial} · of ${formatKsh(sale.total)}`
              : STATE_LABEL[sale.state]}
          </span>
        </div>
      </div>
      <ul className="trans-chap-customer-tab__items">
        {sale.items.map((item) => (
          <li key={item.id}>
            <span className="trans-chap-customer-tab__qty">{item.quantity}×</span>
            <span className="trans-chap-customer-tab__name">
              {item.name}
              {item.sell_unit ? <em> · {item.sell_unit}</em> : null}
            </span>
            <span className="trans-chap-customer-tab__line">{formatKsh(item.line_total)}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function TransChapCustomerTab({ customerId, balance }: Props) {
  const [tab, setTab] = useState<CustomerTab | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPaid, setShowPaid] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ data: CustomerTab }>(apiRoutes.customerTab(customerId))
      .then((res) => {
        if (cancelled) return;
        setTab(res.data);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err, "Could not load the tab."));
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, balance]);

  if (error) {
    return <p className="trans-chap-customer-tab__empty is-error">{error}</p>;
  }
  if (!tab) {
    return (
      <p className="trans-chap-customer-tab__empty" aria-busy="true">
        Loading items…
      </p>
    );
  }

  const open = tab.sales.filter((sale) => sale.state !== "paid");
  const paid = tab.sales.filter((sale) => sale.state === "paid");

  return (
    <div className="trans-chap-customer-tab">
      {open.length === 0 && tab.opening_balance_due <= 0 ? (
        <p className="trans-chap-customer-tab__empty">No unpaid credit sales.</p>
      ) : (
        <ul className="trans-chap-customer-tab__sales">
          {open.map((sale) => (
            <SaleCard key={sale.id} sale={sale} />
          ))}
          {tab.opening_balance_due > 0 ? (
            <li className="trans-chap-customer-tab__sale is-opening">
              <div className="trans-chap-customer-tab__sale-head">
                <div>
                  <strong>Opening balance</strong>
                  <span>Imported or carried over — no items recorded</span>
                </div>
                <div className="trans-chap-customer-tab__sale-amt">
                  <strong>{formatKsh(tab.opening_balance_due)}</strong>
                </div>
              </div>
            </li>
          ) : null}
        </ul>
      )}

      {paid.length > 0 ? (
        <>
          <button
            type="button"
            className="trans-chap-customer-tab__toggle"
            aria-expanded={showPaid}
            onClick={() => setShowPaid((v) => !v)}
          >
            <i className={`fa-solid fa-chevron-${showPaid ? "up" : "down"}`} aria-hidden />
            {showPaid ? "Hide" : "Show"} {paid.length} paid sale{paid.length === 1 ? "" : "s"}
          </button>
          {showPaid ? (
            <ul className="trans-chap-customer-tab__sales">
              {paid.map((sale) => (
                <SaleCard key={sale.id} sale={sale} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {tab.payments.length > 0 ? (
        <div className="trans-chap-customer-tab__payments">
          <span className="trans-chap-customer-tab__heading">Recent payments</span>
          <ul>
            {tab.payments.map((payment) => (
              <li key={payment.id}>
                <span>
                  {formatNairobiDate(payment.paid_at)}
                  <em>
                    {payment.receipt_code ?? (payment.manual ? "Recorded manually" : "M-PESA")}
                  </em>
                </span>
                <strong>−{formatKsh(payment.amount)}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
