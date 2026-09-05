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
import { formatKsh } from "@/lib/trans-chap-receipt";
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

export function TransChapHomePies() {
  const user = useAuthUser();
  const accountId = user.active_account?.id || user.account?.id;
  const [salesTotal, setSalesTotal] = useState(0);
  const [cashTotal, setCashTotal] = useState(0);
  const [creditTotal, setCreditTotal] = useState(0);
  const [mpesaTotal, setMpesaTotal] = useState(0);
  const [purchaseTotal, setPurchaseTotal] = useState(0);
  const [owingTotal, setOwingTotal] = useState(0);
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
    setSalesTotal(salesSum);
    setCashTotal(cash);
    setCreditTotal(credit);
    setMpesaTotal(mpesa);
    setPurchaseTotal(
      purchases.purchases
        .filter((row) => isToday(row.paidAt, todayKey))
        .reduce((sum, row) => sum + row.total, 0),
    );
    setOwingTotal(owing.owingTotal);
    setError(sales.error || purchases.error);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const profit = salesTotal - purchaseTotal;
  const paySlices = useMemo<Slice[]>(
    () =>
      [
        { name: "M-PESA", value: mpesaTotal, fill: "var(--trans-chap-mpesa)" },
        { name: "Credit", value: creditTotal, fill: "var(--trans-chap-credit)" },
        { name: "Cash", value: cashTotal, fill: "var(--trans-chap-cash)" },
      ].filter((slice) => slice.value > 0),
    [cashTotal, creditTotal, mpesaTotal],
  );

  if (loading) {
    return <TransChapTodaySkeleton />;
  }

  if (error && salesTotal === 0 && purchaseTotal === 0) {
    return <TransChapStatus tone="error">{error}</TransChapStatus>;
  }

  return (
    <MotionFade as="section" className="trans-chap-dash__today" aria-label="Today">
      <h3>Today</h3>
      <div className="trans-chap-dash__kpis">
        <article>
          <span>Sales</span>
          <strong>{formatKsh(salesTotal)}</strong>
        </article>
        <article>
          <span>Purchases</span>
          <strong>{formatKsh(purchaseTotal)}</strong>
        </article>
        <article className={profit < 0 ? "is-loss" : undefined}>
          <span>{profit < 0 ? "Loss" : "Profit"}</span>
          <strong>{formatKsh(profit)}</strong>
        </article>
      </div>
      {paySlices.length ? (
        <ul className="trans-chap-dash__pay" aria-label="How customers paid">
          {paySlices.map((slice) => (
            <li key={slice.name}>
              <i style={{ background: slice.fill }} aria-hidden />
              <span>{slice.name}</span>
              <strong>{formatKsh(slice.value)}</strong>
            </li>
          ))}
        </ul>
      ) : null}
      {owingTotal > 0 ? (
        <p className="trans-chap-dash__today-note">
          <Link href="/trans-chap/credit">{formatKsh(owingTotal)} still on the tab. Collect</Link>
        </p>
      ) : (
        <p className="trans-chap-dash__today-note">
          Profit is sales minus restock. Credit is on the tab, not in the drawer.
        </p>
      )}
    </MotionFade>
  );
}
