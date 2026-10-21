"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TransChapRangeFilter } from "@/components/trans-chap/TransChapRangeFilter";
import { TransChapSalesChart } from "@/components/trans-chap/TransChapSalesChart";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { TransChapTodaySkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { MotionFade } from "@/components/app/MotionList";
import { useAuthUser } from "@/components/app/AuthProvider";
import { readPageCache, writePageCache } from "@/lib/api";
import { isShopOwner, userCanAccessSection } from "@/lib/merchant-permissions";
import { fetchWalkinOrders, isCountedWalkinSale } from "@/lib/trans-chap-orders";
import { fetchTransChapPurchases, type TransChapPurchase } from "@/lib/trans-chap-purchases";
import { fetchTransChapExpenses } from "@/lib/trans-chap-expenses";
import { RecordExpenseModal } from "@/components/trans-chap/RecordExpenseModal";
import { TransChapMarkupModal, type ProductSoldItem } from "@/components/trans-chap/TransChapMarkupModal";
import { internalErrorMessage } from "@/lib/alerts";
import { fetchOwingCustomers } from "@/lib/trans-chap-credit";
import { fetchShopSuppliers } from "@/lib/trans-chap-suppliers";
import { formatKesDigits, formatKsh } from "@/lib/trans-chap-receipt";
import { nairobiDateKey, parseIso } from "@/lib/nairobi-time";
import { orderPaymentPortions } from "@/lib/orders";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import {
  buildChartBuckets,
  inRange,
  rangeBounds,
  rangeForPreset,
  rangeLabel,
  type ChartBucket,
  type DateRange,
  type RangePreset,
} from "@/lib/trans-chap-range";
import type { Order, ShopExpense } from "@/lib/types";

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
  expense_total?: number;
  expense_count?: number;
  net_profit_after_expenses?: number;
  net_profit: number;
  cogs: number;
  gross_profit: number;
  gross_markup_percent?: number;
  gross_margin_percent?: number;
  payment_methods: {
    mpesa: number;
    cash: number;
    credit: number;
    other: number;
  };
  buckets: ChartBucket[];
  top_products: Array<{ name: string; qty: number; amount: number }>;
  products_sold?: ProductSoldItem[];
  owing_total: number;
  owing_count: number;
};

const PRESETS: RangePreset[] = ["today", "yesterday", "7d", "30d", "custom"];

function homeCacheKey(range: DateRange): string {
  return `trans-chap:home:${range.from}:${range.to}`;
}

type HomeSnapshot = {
  orders: Order[];
  purchases: TransChapPurchase[];
  expenses: ShopExpense[];
  expenseTotal: number;
  expenseCount: number;
  grossProfit?: number;
  cogs?: number;
  markupPercent?: number;
  productsSold?: ProductSoldItem[];
  owingTotal: number;
  owingCount: number;
  payableTotal: number;
  payableCount: number;
};



async function fetchSupplierPayables(): Promise<{
  payableTotal: number;
  payableCount: number;
  error: string | null;
}> {
  try {
    const owed = (await fetchShopSuppliers())
      .map((supplier) => Number(supplier.balance || 0))
      .filter((balance) => balance > 0);
    return {
      payableTotal: owed.reduce((sum, balance) => sum + balance, 0),
      payableCount: owed.length,
      error: null,
    };
  } catch {
    return { payableTotal: 0, payableCount: 0, error: internalErrorMessage() };
  }
}

/** Snapshot plus the range it was fetched for (may lag the selected range). */
type HomeData = HomeSnapshot & { range: DateRange };

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

export function TransChapHomePies({
  expenseModalOpen: externalModalOpen,
  setExpenseModalOpen: setExternalModalOpen,
}: {
  expenseModalOpen?: boolean;
  setExpenseModalOpen?: (open: boolean) => void;
} = {}) {
  const user = useAuthUser();
  const accountId = user.active_account?.id || user.account?.id;
  const owner = isShopOwner(user);
  const canInventory = userCanAccessSection(user, "inventory");
  const canCustomers = userCanAccessSection(user, "customer");
  const canSuppliers = canInventory || userCanAccessSection(user, "supplier");
  const [summary, setSummary] = useState<{ range: DateRange; data: ReportsSummary } | null>(null);
  const todayKey = nairobiDateKey(new Date());
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("today", todayKey));
  const [data, setData] = useState<HomeData | null>(() => {
    const snapshot = readPageCache<HomeSnapshot>(homeCacheKey(range));
    return snapshot ? { ...snapshot, range } : null;
  });
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalModalOpen, setInternalModalOpen] = useState(false);
  const [markupModalOpen, setMarkupModalOpen] = useState(false);
  const isModalOpen = externalModalOpen !== undefined ? externalModalOpen : internalModalOpen;
  const setModalOpen = setExternalModalOpen ?? setInternalModalOpen;
  const latestRequest = useRef(0);
  const rangeRef = useRef(range);


  const loadData = useCallback(
    async (targetRange: DateRange) => {
      const requestId = ++latestRequest.current;
      setRefreshing(true);
      try {
        const summaryRes = await apiFetch<{ data: ReportsSummary }>(
          apiRoutes.reportsSummary(targetRange.from, targetRange.to),
        );
        if (summaryRes?.data) {
          const payables = canSuppliers
            ? await fetchSupplierPayables()
            : { payableTotal: 0, payableCount: 0, error: null };
          if (requestId !== latestRequest.current) return;
          setSummary({ range: targetRange, data: summaryRes.data });
          setData((current) => ({
            orders: [],
            purchases: [],
            expenses: [],
            expenseTotal: summaryRes.data.expense_total ?? 0,
            expenseCount: summaryRes.data.expense_count ?? 0,
            grossProfit: summaryRes.data.gross_profit ?? 0,
            cogs: summaryRes.data.cogs ?? 0,
            markupPercent: summaryRes.data.gross_markup_percent ?? 0,
            productsSold: summaryRes.data.products_sold ?? [],
            owingTotal: summaryRes.data.owing_total,
            owingCount: summaryRes.data.owing_count,
            payableTotal: payables.payableTotal,
            payableCount: payables.payableCount,
            range: targetRange,
            ...(current?.range.from === targetRange.from && current.range.to === targetRange.to
              ? {
                  payableTotal: payables.error ? current.payableTotal : payables.payableTotal,
                  payableCount: payables.error ? current.payableCount : payables.payableCount,
                }
              : {}),
          }));
          setError(payables.error);
          setRefreshing(false);
          return;
        }
      } catch {
        // Fall back to the client-side report data if the summary endpoint is unavailable.
      }

      setSummary(null);
      const window = rangeBounds(targetRange);
      try {
        const [sales, bought, expensesRes, owing, payables] = await Promise.all([
          fetchWalkinOrders(window),
          canInventory
            ? fetchTransChapPurchases({ accountId, ...window })
            : Promise.resolve({ purchases: [], error: null as string | null, truncated: false }),
          fetchTransChapExpenses({ from: targetRange.from, to: targetRange.to }),
          canCustomers
            ? fetchOwingCustomers()
            : Promise.resolve({
                customers: [],
                owingTotal: 0,
                error: null as string | null,
              }),
          canSuppliers
            ? fetchSupplierPayables()
            : Promise.resolve({ payableTotal: 0, payableCount: 0, error: null as string | null }),
        ]);
        if (requestId !== latestRequest.current) return;

        const countedOrders = sales.orders.filter(isCountedWalkinSale);
        const prodMap = new Map<string, ProductSoldItem>();
        for (const ord of countedOrders) {
          for (const item of ord.items ?? []) {
            const name = item.product_name || "Item";
            const qty = item.quantity || 1;
            const factor = Number(item.unit_factor || 1);
            const totalPcs = qty * factor;
            const sellingAmount = item.line_total ?? (item.unit_price * qty);
            const entry = prodMap.get(name) || {
              name,
              sku: item.product_sku || undefined,
              qty: 0,
              total_pcs: 0,
              sell_unit: item.sell_unit || undefined,
              unit_factor: factor,
              selling_amount: 0,
              buying_amount: 0,
              markup: 0,
              selling_price: item.unit_price || (sellingAmount / qty),
              buying_price: 0,
            };
            entry.qty += qty;
            entry.total_pcs = (entry.total_pcs || 0) + totalPcs;
            entry.selling_amount += sellingAmount;
            entry.markup = entry.selling_amount - entry.buying_amount;
            prodMap.set(name, entry);
          }
        }
        const fallbackProductsSold = Array.from(prodMap.values()).sort((a, b) => b.markup - a.markup);

        const fresh: HomeSnapshot = {
          orders: countedOrders,
          purchases: bought.purchases.filter((row) => !row.voidedAt),
          expenses: expensesRes.expenses,
          expenseTotal: expensesRes.totalAmount,
          expenseCount: expensesRes.count,
          grossProfit: 0,
          cogs: 0,
          markupPercent: 0,
          productsSold: fallbackProductsSold,
          owingTotal: owing.owingTotal,
          owingCount: owing.customers?.length ?? 0,
          payableTotal: payables.payableTotal,
          payableCount: payables.payableCount,
        };
        setData({ ...fresh, range: targetRange });
        const failure = sales.error || bought.error || expensesRes.error || owing.error || payables.error;
        setError(failure);
        if (!failure) writePageCache(homeCacheKey(targetRange), fresh);
      } catch (fallbackErr) {
        if (requestId !== latestRequest.current) return;
        setError(
          fallbackErr instanceof Error ? fallbackErr.message : "Failed to load reports data",
        );
      } finally {
        if (requestId === latestRequest.current) setRefreshing(false);
      }
    },
    [accountId, canCustomers, canInventory, canSuppliers],
  );


  useEffect(() => {
    void loadData(rangeRef.current);
  }, [loadData]);

  function changeRange(next: DateRange) {
    rangeRef.current = next;
    setRange(next);
    setSummary(null);
    const snapshot = readPageCache<HomeSnapshot>(homeCacheKey(next));
    if (snapshot) setData({ ...snapshot, range: next });
    void loadData(next);
  }

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const purchases = useMemo(() => data?.purchases ?? [], [data]);
  const displayOwingTotal = summary?.range.from === range.from && summary.range.to === range.to
    ? summary.data.owing_total
    : data?.owingTotal ?? 0;
  const displayOwingCount = summary?.range.from === range.from && summary.range.to === range.to
    ? summary.data.owing_count
    : data?.owingCount ?? 0;
  const payableTotal = data?.payableTotal ?? 0;
  const payableCount = data?.payableCount ?? 0;
  const dataRange = range;

  const stats = useMemo(() => {
    if (summary?.range.from === range.from && summary.range.to === range.to) {
      return {
        salesTotal: summary.data.sales_total,
        salesCount: summary.data.sales_count,
        purchaseTotal: summary.data.purchase_total,
        purchaseCount: summary.data.purchase_count,
        expenseTotal: summary.data.expense_total ?? 0,
        expenseCount: summary.data.expense_count ?? 0,
        grossProfit: summary.data.gross_profit ?? 0,
        cogs: summary.data.cogs ?? 0,
        markupPercent: summary.data.gross_markup_percent ?? 0,
        mpesaTotal: summary.data.payment_methods.mpesa,
        creditTotal: summary.data.payment_methods.credit,
        cashTotal: summary.data.payment_methods.cash,
        buckets: summary.data.buckets,
        productsSold: summary.data.products_sold ?? [],
        owingTotal: summary.data.owing_total,
        owingCount: summary.data.owing_count,
      };
    }

    const salesRows = orders
      .map((order) => ({ order, when: orderTime(order) }))
      .filter((row): row is { order: Order; when: Date } => inRange(row.when, dataRange));
    const purchaseRows = purchases
      .map((row) => ({ when: parseIso(row.paidAt), total: row.total }))
      .filter((row): row is { when: Date; total: number } => inRange(row.when, dataRange));
    const expenseRows = (data?.expenses ?? [])
      .map((exp) => ({ when: parseIso(exp.spent_at), total: exp.amount }))
      .filter((row): row is { when: Date; total: number } => inRange(row.when, dataRange));

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
      expenseTotal: (data?.expenseTotal ?? 0) || expenseRows.reduce((sum, row) => sum + row.total, 0),
      expenseCount: (data?.expenseCount ?? 0) || expenseRows.length,
      grossProfit: data?.grossProfit ?? 0,
      cogs: data?.cogs ?? 0,
      markupPercent: data?.markupPercent ?? 0,
      mpesaTotal: sumBy((m) => m === "mpesa"),
      creditTotal: sumBy((m) => m === "credit"),
      cashTotal: sumBy((m) => m !== "mpesa" && m !== "credit"),
      buckets: buildChartBuckets(
        dataRange,
        salesRows.map((row) => ({ when: row.when, total: row.order.total })),
        purchaseRows,
        expenseRows,
      ),
      productsSold: data?.productsSold ?? [],
      owingTotal: displayOwingTotal,
      owingCount: displayOwingCount,
    };
  }, [summary, range, orders, purchases, data, dataRange, displayOwingTotal, displayOwingCount]);

  const {
    salesTotal,
    salesCount,
    expenseTotal,
    expenseCount,
    grossProfit,
    cogs,
    markupPercent,
    productsSold,
    owingTotal,
    owingCount,
  } = stats;
  const profit = salesTotal - expenseTotal;
  const period = rangeLabel(dataRange, todayKey);
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
  if (!data && !summary) {
    return error ? <TransChapStatus tone="error">{error}</TransChapStatus> : <TransChapTodaySkeleton />;
  }

  if (error && !summary && orders.length === 0 && purchases.length === 0) {
    return <TransChapStatus tone="error">{error}</TransChapStatus>;
  }

  return (
    <MotionFade
      as="div"
      className={`trans-chap-dash__analytics${refreshing ? " is-refreshing" : ""}`}
      aria-label="Sales analytics"
      aria-busy={refreshing || undefined}
    >
      <article className={`trans-chap-dash__spotlight${profit < 0 ? " is-loss" : ""}`}>
        <TransChapRangeFilter
          value={range}
          onChange={changeRange}
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
              Sales {formatKsh(salesTotal)} − Expenses {formatKsh(expenseTotal)}
              {grossProfit !== 0 || cogs > 0
                ? ` · Mark up ${formatKsh(grossProfit)}${cogs > 0 ? ` (+${markupPercent}%)` : ""}`
                : ""}
            </p>
          </div>
          <i
            className={`fa-solid ${profit < 0 ? "fa-arrow-trend-down" : "fa-arrow-trend-up"}`}
            aria-hidden
          />
        </div>

        <TransChapSalesChart
          buckets={stats.buckets}
          emptyText={`No sales or daily errands ${period}.`}
          secondaryKey="expenses"
          secondaryLabel="Expenses"
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
          <div
            className="trans-chap-dash__total is-markup"
            style={{ cursor: "pointer" }}
            onClick={() => setMarkupModalOpen(true)}
            role="button"
            tabIndex={0}
            title="Click to view products sold and mark up for this date"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setMarkupModalOpen(true);
              }
            }}
          >
            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>
                <i aria-hidden /> Mark up
              </span>
              <span style={{ fontSize: "0.68rem", color: "var(--trans-chap-markup, #10b981)", fontWeight: 700 }}>
                View list
              </span>
            </span>
            <Money amount={grossProfit} />
            <em>
              {cogs > 0
                ? `+${markupPercent}% · (selling − buying) × qty`
                : salesCount > 0
                  ? "(selling − buying) × qty"
                  : "No sales yet"}
            </em>
          </div>
          <div
            className="trans-chap-dash__total is-expense"
            style={{ cursor: "pointer" }}
            onClick={() => setModalOpen(true)}
            role="button"
            tabIndex={0}
            title="Click to record a daily errand or expense"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setModalOpen(true);
              }
            }}
          >
            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>
                <i aria-hidden /> Expenses
              </span>
              <span style={{ fontSize: "0.68rem", color: "var(--trans-chap-expense, #f59e0b)", fontWeight: 700 }}>
                + Record
              </span>
            </span>
            <Money amount={expenseTotal} />
            <em>
              {expenseCount === 0
                ? "No errands recorded"
                : `${expenseCount} errand${expenseCount === 1 ? "" : "s"}`}
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

      {canSuppliers ? (
        payableTotal > 0 ? (
          <Link
            href="/trans-chap/suppliers"
            className="trans-chap-dash__owing trans-chap-dash__owing--supplier"
          >
            <span>
              <strong>{formatKsh(payableTotal)}</strong>
              <em>
                owed to suppliers · {payableCount} supplier{payableCount === 1 ? "" : "s"}
              </em>
            </span>
            <span className="trans-chap-dash__owing-cta">
              Pay
              <i className="fa-solid fa-chevron-right" aria-hidden />
            </span>
          </Link>
        ) : (
          <div className="trans-chap-dash__owing trans-chap-dash__owing--supplier is-clear">
            <span>
              <strong>Suppliers paid</strong>
              <em>Nothing owed to suppliers</em>
            </span>
            <i className="fa-solid fa-check" aria-hidden />
          </div>
        )
      ) : null}

      {owner ? (
        <p className="trans-chap-dash__foot">
          <Link href="/trans-chap/reports">Full reports</Link>
          <span>Profit is sales minus daily errands. Stock purchases tracked in reports & restock.</span>
        </p>
      ) : null}

      <RecordExpenseModal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => void loadData(range)}
      />

      <TransChapMarkupModal
        isOpen={markupModalOpen}
        onClose={() => setMarkupModalOpen(false)}
        period={period}
        totalMarkup={grossProfit}
        totalSales={salesTotal}
        totalCogs={cogs}
        products={productsSold}
      />
    </MotionFade>

  );
}
