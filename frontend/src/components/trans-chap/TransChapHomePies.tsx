"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { TransChapTodaySkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { MotionFade } from "@/components/app/MotionList";
import { useAuthUser } from "@/components/app/AuthProvider";
import { fetchWalkinOrders, isCountedWalkinSale } from "@/lib/trans-chap-orders";
import { fetchTransChapPurchases } from "@/lib/trans-chap-purchases";
import { fetchOwingCustomers } from "@/lib/trans-chap-credit";
import { formatKesDigits, formatKsh } from "@/lib/trans-chap-receipt";
import { nairobiDateKey, parseIso } from "@/lib/nairobi-time";

type Slice = {
  name: string;
  value: number;
  fill: string;
};

function isToday(iso: string | null | undefined, todayKey: string): boolean {
  const date = parseIso(iso);
  return date ? nairobiDateKey(date) === todayKey : false;
}

function Money({ amount }: { amount: number }) {
  return (
    <strong aria-label={formatKsh(amount)}>
      <small>Ksh</small>
      {formatKesDigits(amount)}
    </strong>
  );
}

export function TransChapHomePies() {
  const user = useAuthUser();
  const accountId = user.active_account?.id || user.account?.id;
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesCount, setSalesCount] = useState(0);
  const [cashTotal, setCashTotal] = useState(0);
  const [creditTotal, setCreditTotal] = useState(0);
  const [mpesaTotal, setMpesaTotal] = useState(0);
  const [purchaseTotal, setPurchaseTotal] = useState(0);
  const [purchaseCount, setPurchaseCount] = useState(0);
  const [owingTotal, setOwingTotal] = useState(0);
  const [owingCount, setOwingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const todayKey = nairobiDateKey(new Date());
    const [sales, purchases, owing] = await Promise.all([
      fetchWalkinOrders(),
      fetchTransChapPurchases({ accountId }),
      fetchOwingCustomers(),
    ]);
    const paidToday = sales.orders.filter((order) => {
      if (!isCountedWalkinSale(order)) return false;
      return isToday(order.paid_at || order.placed_at || order.created_at, todayKey);
    });
    const mpesa = paidToday
      .filter((order) => order.payment_method === "mpesa")
      .reduce((sum, order) => sum + order.total, 0);
    const credit = paidToday
      .filter((order) => order.payment_method === "credit")
      .reduce((sum, order) => sum + order.total, 0);
    const cash = paidToday
      .filter((order) => order.payment_method !== "mpesa" && order.payment_method !== "credit")
      .reduce((sum, order) => sum + order.total, 0);
    const salesSum = paidToday.reduce((sum, order) => sum + order.total, 0);
    const purchasesToday = purchases.purchases.filter((row) => isToday(row.paidAt, todayKey));
    setSalesTotal(salesSum);
    setSalesCount(paidToday.length);
    setCashTotal(cash);
    setCreditTotal(credit);
    setMpesaTotal(mpesa);
    setPurchaseTotal(purchasesToday.reduce((sum, row) => sum + row.total, 0));
    setPurchaseCount(purchasesToday.length);
    setOwingTotal(owing.owingTotal);
    setOwingCount(owing.customers?.length ?? 0);
    setError(sales.error || purchases.error);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const profit = salesTotal - purchaseTotal;
  const paySlices = useMemo<Slice[]>(
    () => [
      { name: "M-PESA", value: mpesaTotal, fill: "var(--trans-chap-mpesa)" },
      { name: "Cash", value: cashTotal, fill: "var(--trans-chap-cash)" },
      { name: "Credit", value: creditTotal, fill: "var(--trans-chap-credit)" },
    ],
    [cashTotal, creditTotal, mpesaTotal],
  );
  const payMax = Math.max(salesTotal, 1);
  const hasPayments = paySlices.some((slice) => slice.value > 0);

  if (loading) {
    return <TransChapTodaySkeleton />;
  }

  if (error && salesTotal === 0 && purchaseTotal === 0) {
    return <TransChapStatus tone="error">{error}</TransChapStatus>;
  }

  return (
    <MotionFade as="div" className="trans-chap-dash__analytics" aria-label="Today’s analytics">
      <article
        className={`trans-chap-dash__spotlight${profit < 0 ? " is-loss" : ""}`}
      >
        <div className="trans-chap-dash__spotlight-copy">
          <span>{profit < 0 ? "Net loss today" : "Net profit today"}</span>
          <Money amount={profit} />
          <p>
            Sales {formatKsh(salesTotal)} − Purchases {formatKsh(purchaseTotal)}
          </p>
        </div>
        <i
          className={`fa-solid ${profit < 0 ? "fa-arrow-trend-down" : "fa-arrow-trend-up"}`}
          aria-hidden
        />
      </article>

      <div className="trans-chap-dash__stat-grid">
        <article className="trans-chap-dash__stat trans-chap-dash__stat--sale">
          <span>Sales</span>
          <Money amount={salesTotal} />
          <em>
            {salesCount === 0
              ? "No sales yet"
              : `${salesCount} sale${salesCount === 1 ? "" : "s"}`}
          </em>
        </article>
        <article className="trans-chap-dash__stat trans-chap-dash__stat--purchase">
          <span>Purchases</span>
          <Money amount={purchaseTotal} />
          <em>
            {purchaseCount === 0
              ? "No restock yet"
              : `${purchaseCount} purchase${purchaseCount === 1 ? "" : "s"}`}
          </em>
        </article>
      </div>

      <section className="trans-chap-dash__panel" aria-labelledby="trans-chap-pay-heading">
        <header className="trans-chap-dash__panel-head">
          <h3 id="trans-chap-pay-heading">How customers paid</h3>
          <span>{hasPayments ? formatKsh(salesTotal) : "Today"}</span>
        </header>
        {hasPayments ? (
          <ul className="trans-chap-dash__mix">
            {paySlices.map((slice) => {
              const pct = Math.round((slice.value / payMax) * 100);
              return (
                <li key={slice.name}>
                  <div className="trans-chap-dash__mix-meta">
                    <span>
                      <i style={{ background: slice.fill }} aria-hidden />
                      {slice.name}
                    </span>
                    <strong>{formatKsh(slice.value)}</strong>
                  </div>
                  <div
                    className="trans-chap-dash__mix-track"
                    role="presentation"
                    aria-hidden
                  >
                    <b
                      style={{
                        width: `${Math.max(slice.value > 0 ? 6 : 0, pct)}%`,
                        background: slice.fill,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="trans-chap-dash__empty">
            No paid sales yet today. Sales will break down into M-PESA, cash, and
            credit here.
          </p>
        )}
      </section>

      {owingTotal > 0 ? (
        <Link href="/trans-chap/credit" className="trans-chap-dash__owing">
          <span>
            <strong>{formatKsh(owingTotal)}</strong>
            <em>
              on the tab
              {owingCount > 0
                ? ` · ${owingCount} customer${owingCount === 1 ? "" : "s"}`
                : ""}
            </em>
          </span>
          <span className="trans-chap-dash__owing-cta">
            Collect
            <i className="fa-solid fa-chevron-right" aria-hidden />
          </span>
        </Link>
      ) : (
        <div className="trans-chap-dash__owing is-clear">
          <span>
            <strong>Tabs clear</strong>
            <em>No customer credit outstanding</em>
          </span>
          <i className="fa-solid fa-check" aria-hidden />
        </div>
      )}

      <p className="trans-chap-dash__foot">
        <Link href="/trans-chap/reports">Full reports</Link>
        <span>Profit is sales minus restock. Credit stays on the tab.</span>
      </p>
    </MotionFade>
  );
}
