"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TransChapRangeFilter } from "@/components/trans-chap/TransChapRangeFilter";
import { TransChapSalesChart } from "@/components/trans-chap/TransChapSalesChart";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { TransChapTodaySkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { MotionFade } from "@/components/app/MotionList";
import { useAuthUser } from "@/components/app/AuthProvider";
import { isShopOwner, userCanAccessSection } from "@/lib/merchant-permissions";
import { fetchWalkinOrders, isCountedWalkinSale } from "@/lib/trans-chap-orders";
import { fetchTransChapPurchases, type TransChapPurchase } from "@/lib/trans-chap-purchases";
import { fetchOwingCustomers } from "@/lib/trans-chap-credit";
import { formatKesDigits, formatKsh } from "@/lib/trans-chap-receipt";
import { nairobiDateKey, parseIso } from "@/lib/nairobi-time";
import { orderPaymentPortions } from "@/lib/orders";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import {
  buildChartBuckets,
  inRange,
  rangeForPreset,
  rangeLabel,
  type ChartBucket,
  type DateRange,
  type RangePreset,
} from "@/lib/trans-chap-range";
import type { Order } from "@/lib/types";

type Slice = {
  name: string;
  value: number;
  fill: string;
};

export type ReportsSummary = {
  sales_total: number;
  sales_count: number;
  units: number;
  purchase_total: number;
  purchase_count: number;
  net_profit: number;
  cogs: number;
  gross_profit: number;
  payment_methods: {
    mpesa: number;
    cash: number;
    credit: number;
    other: number;
  };
  buckets: ChartBucket[];
  top_products: Array<{ name: string; qty: number; amount: number }>;
  owing_total: number;
  owing_count: number;
};

const PRESETS: RangePreset[] = ["today", "yesterday", "7d", "30d", "custom"];

function orderTime(order: Order): Date | null {
  return parseIso(order.paid_at || order.placed_at || order.created_at);
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
  const owner = isShopOwner(user);
  const canInventory = userCanAccessSection(user, "inventory");
  const canCustomers = userCanAccessSection(user, "customer");
  const [summary, setSummary] = useState<ReportsSummary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [purchases, setPurchases] = useState<TransChapPurchase[]>([]);
  const [legacyOwingTotal, setLegacyOwingTotal] = useState(0);
  const [legacyOwingCount, setLegacyOwingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const todayKey = nairobiDateKey(new Date());
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("today", todayKey));

  const loadData = useCallback(
    async (targetRange: DateRange, isInitial = false) => {
      if (isInitial) {
        setLoading(true);
      } else {
        setIsUpdating(true);
      }

      try {
        // 1. Try server-side summary endpoint (fastest: < 30ms, 1 request)
        const summaryRes = await apiFetch<{ data: ReportsSummary }>(
          apiRoutes.reportsSummary(targetRange.from, targetRange.to),
        );
        if (summaryRes?.data) {
          setSummary(summaryRes.data);
          setError(null);
          return;
        }
      } catch {
        // Fallback to legacy client-side computation if server endpoint is unavailable
        try {
          const [sales, bought, owing] = await Promise.all([
            fetchWalkinOrders(),
            canInventory
              ? fetchTransChapPurchases({ accountId })
              : Promise.resolve({ purchases: [], error: null as string | null, truncated: false }),
            canCustomers
              ? fetchOwingCustomers()
              : Promise.resolve({
                  customers: [],
                  owingTotal: 0,
                  error: null as string | null,
                }),
          ]);
          setOrders(sales.orders.filter(isCountedWalkinSale));
          setPurchases(bought.purchases.filter((row) => !row.voidedAt));
          setLegacyOwingTotal(owing.owingTotal);
          setLegacyOwingCount(owing.customers?.length ?? 0);
          setError(sales.error || bought.error || owing.error);
        } catch (fallbackErr) {
          setError(
            fallbackErr instanceof Error ? fallbackErr.message : "Failed to load reports data",
          );
        }
      } finally {
        setLoading(false);
        setIsUpdating(false);
      }
    },
    [accountId, canCustomers, canInventory],
  );

  useEffect(() => {
    void loadData(range, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const handleRangeChange = useCallback(
    (newRange: DateRange) => {
      setRange(newRange);
      void loadData(newRange, false);
    },
    [loadData],
  );

  const stats = useMemo(() => {
    if (summary) {
      return {
        salesTotal: summary.sales_total,
        salesCount: summary.sales_count,
        purchaseTotal: summary.purchase_total,
        purchaseCount: summary.purchase_count,
        mpesaTotal: summary.payment_methods.mpesa,
        creditTotal: summary.payment_methods.credit,
        cashTotal: summary.payment_methods.cash,
        buckets: summary.buckets,
        owingTotal: summary.owing_total,
        owingCount: summary.owing_count,
      };
    }

    const salesRows = orders
      .map((order) => ({ order, when: orderTime(order) }))
      .filter((row): row is { order: Order; when: Date } => inRange(row.when, range));
    const purchaseRows = purchases
      .map((row) => ({ when: parseIso(row.paidAt), total: row.total }))
      .filter((row): row is { when: Date; total: number } => inRange(row.when, range));

    const sumBy = (method: (m: string | null | undefined) => boolean) =>
      salesRows.reduce(
        (sum, { order }) =>
          order.payment_method === "split"
            ? sum +
              orderPaymentPortions(order)
                .filter((part) => method(part.method))
                .reduce((s, part) => s + part.amount, 0)
            : method(order.payment_method)
              ? sum + order.total
              : sum,
        0,
      );

    return {
      salesTotal: salesRows.reduce((sum, row) => sum + row.order.total, 0),
      salesCount: salesRows.length,
      purchaseTotal: purchaseRows.reduce((sum, row) => sum + row.total, 0),
      purchaseCount: purchaseRows.length,
      mpesaTotal: sumBy((m) => m === "mpesa"),
      creditTotal: sumBy((m) => m === "credit"),
      cashTotal: sumBy((m) => m !== "mpesa" && m !== "credit"),
      buckets: buildChartBuckets(
        range,
        salesRows.map((row) => ({ when: row.when, total: row.order.total })),
        purchaseRows,
      ),
      owingTotal: legacyOwingTotal,
      owingCount: legacyOwingCount,
    };
  }, [summary, orders, purchases, range, legacyOwingTotal, legacyOwingCount]);

  const { salesTotal, salesCount, purchaseTotal, purchaseCount, owingTotal, owingCount } = stats;
  const profit = salesTotal - purchaseTotal;
  const period = rangeLabel(range, todayKey);
  const paySlices = useMemo<Slice[]>(
    () => [
      { name: "M-PESA", value: stats.mpesaTotal, fill: "var(--trans-chap-mpesa)" },
      { name: "Cash", value: stats.cashTotal, fill: "var(--trans-chap-cash)" },
      { name: "Credit", value: stats.creditTotal, fill: "var(--trans-chap-credit)" },
    ],
    [stats.cashTotal, stats.creditTotal, stats.mpesaTotal],
  );
  const payMax = Math.max(salesTotal, 1);
  const hasPayments = paySlices.some((slice) => slice.value > 0);
  if (loading) {
    return <TransChapTodaySkeleton />;
  }

  if (error && !summary && orders.length === 0 && purchases.length === 0) {
    return <TransChapStatus tone="error">{error}</TransChapStatus>;
  }

  return (
    <MotionFade
      as="div"
      className="trans-chap-dash__analytics"
      aria-label="Sales analytics"
      style={{ opacity: isUpdating ? 0.72 : 1, transition: "opacity 0.15s ease" }}
    >
      <article className={`trans-chap-dash__spotlight${profit < 0 ? " is-loss" : ""}`}>
        <TransChapRangeFilter
          value={range}
          onChange={handleRangeChange}
          todayKey={todayKey}
          presets={PRESETS}
        />

        <div className="trans-chap-dash__spotlight-main">
          <div className="trans-chap-dash__spotlight-copy">
            <span>
              {profit < 0 ? "Net loss" : "Net profit"} {period}
            </span>
            <Money amount={profit} />
            <p>
              Sales {formatKsh(salesTotal)} − Purchases {formatKsh(purchaseTotal)}
            </p>
          </div>
          <i
            className={`fa-solid ${profit < 0 ? "fa-arrow-trend-down" : "fa-arrow-trend-up"}`}
            aria-hidden
          />
        </div>

        <TransChapSalesChart
          buckets={stats.buckets}
          emptyText={`No sales or purchases ${period}.`}
        />

        <div className="trans-chap-dash__totals">
          <div className="trans-chap-dash__total is-sale">
            <span>
              <i aria-hidden /> Sales
            </span>
            <Money amount={salesTotal} />
            <em>
              {salesCount === 0
                ? "No sales"
                : `${salesCount} sale${salesCount === 1 ? "" : "s"}`}
            </em>
          </div>
          <div className="trans-chap-dash__total is-purchase">
            <span>
              <i aria-hidden /> Purchases
            </span>
            <Money amount={purchaseTotal} />
            <em>
              {purchaseCount === 0
                ? "No restock"
                : `${purchaseCount} purchase${purchaseCount === 1 ? "" : "s"}`}
            </em>
          </div>
        </div>
      </article>

      <section className="trans-chap-dash__panel" aria-labelledby="trans-chap-pay-heading">
        <header className="trans-chap-dash__panel-head">
          <h3 id="trans-chap-pay-heading">How customers paid</h3>
          <span>{hasPayments ? formatKsh(salesTotal) : period}</span>
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
            No paid sales {period}. Sales will break down into M-PESA, cash, and credit
            here.
          </p>
        )}
      </section>

      {canCustomers ? (
        owingTotal > 0 ? (
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
        )
      ) : null}

      {owner ? (
        <p className="trans-chap-dash__foot">
          <Link href="/trans-chap/reports">Full reports</Link>
          <span>Profit is sales minus restock. Credit stays on the tab.</span>
        </p>
      ) : null}
    </MotionFade>
  );
}
