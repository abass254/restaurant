"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapRangeFilter } from "@/components/trans-chap/TransChapRangeFilter";
import { TransChapSalesChart } from "@/components/trans-chap/TransChapSalesChart";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { TransChapStoreProfile } from "@/components/trans-chap/TransChapStoreProfile";
import { TransChapTodaySkeleton } from "@/components/trans-chap/TransChapSkeleton";
import { apiFetch } from "@/lib/api";
import { internalErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { nairobiDateKey, parseIso } from "@/lib/nairobi-time";
import { fetchWalkinOrders, isCountedWalkinSale } from "@/lib/trans-chap-orders";
import { fetchTransChapPurchases, type TransChapPurchase } from "@/lib/trans-chap-purchases";
import { inventoryProductName } from "@/lib/trans-chap-product";
import {
  buildChartBuckets,
  inRange,
  rangeForPreset,
  rangeLabel,
  type DateRange,
  type RangePreset,
} from "@/lib/trans-chap-range";
import { formatKesDigits, formatKsh } from "@/lib/trans-chap-receipt";
import type { InventoryItem, InventoryResponse, Order } from "@/lib/types";

type ReportView = "performance" | "worth";
type ProductSort = "amount" | "qty";

const PRESETS: RangePreset[] = ["today", "yesterday", "7d", "30d", "month", "all", "custom"];
const LIST_PREVIEW = 5;
const STOCK_PREVIEW = 6;

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

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export function TransChapReports() {
  const user = useAuthUser();
  const accountId = user.active_account?.id || user.account?.id;
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<TransChapPurchase[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingAmount, setOpeningAmount] = useState<number | null>(null);
  const [openingStock, setOpeningStock] = useState<number | null>(null);
  const [openingInvestment, setOpeningInvestment] = useState<number | null>(null);

  const todayKey = nairobiDateKey(new Date());
  const [view, setView] = useState<ReportView>("performance");
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("today", todayKey));
  const [productSort, setProductSort] = useState<ProductSort>("amount");
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [showAllStock, setShowAllStock] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [sales, inventory, bought, settingsData] = await Promise.all([
        fetchWalkinOrders(),
        apiFetch<InventoryResponse>(apiRoutes.inventory),
        fetchTransChapPurchases({ accountId }),
        apiFetch<{
          opening_amount?: number | string | null;
          opening_stock?: number | string | null;
          opening_investment?: number | string | null;
        }>(apiRoutes.settings).catch(() => null),
      ]);
      setOrders(sales.orders.filter(isCountedWalkinSale));
      setItems(inventory.data);
      setPurchases(bought.purchases.filter((row) => !row.voidedAt));
      setTruncated(sales.truncated || bought.truncated);
      setOpeningAmount(settingsData?.opening_amount ? Number(settingsData.opening_amount) : null);
      setOpeningStock(settingsData?.opening_stock ? Number(settingsData.opening_stock) : null);
      setOpeningInvestment(
        settingsData?.opening_investment ? Number(settingsData.opening_investment) : null,
      );
      setError(sales.error || bought.error ? internalErrorMessage() : null);
    } catch {
      setOrders([]);
      setItems([]);
      setPurchases([]);
      setOpeningAmount(null);
      setOpeningStock(null);
      setOpeningInvestment(null);
      setError(internalErrorMessage());
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const earliestKey = useMemo(() => {
    let earliest: string | null = null;
    const consider = (when: Date | null) => {
      if (!when) return;
      const key = nairobiDateKey(when);
      if (!earliest || key < earliest) earliest = key;
    };
    orders.forEach((order) => consider(orderTime(order)));
    purchases.forEach((row) => consider(parseIso(row.paidAt)));
    return earliest;
  }, [orders, purchases]);

  const itemLookup = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const byName = new Map(items.map((item) => [inventoryProductName(item), item]));
    return { byId, byName };
  }, [items]);

  const stockValue = useMemo(
    () =>
      items.reduce(
        (sum, item) => sum + Math.max(0, item.stock_quantity || 0) * (item.buying_price || 0),
        0,
      ),
    [items],
  );

  const lowStock = useMemo(
    () =>
      items
        .filter(
          (item) =>
            item.stock_quantity != null && (item.stock_quantity <= 0 || item.is_low_stock),
        )
        .sort((a, b) => (a.stock_quantity ?? 0) - (b.stock_quantity ?? 0)),
    [items],
  );

  const period = useMemo(() => {
    const sales = orders
      .map((order) => ({ order, when: orderTime(order) }))
      .filter((row): row is { order: Order; when: Date } => inRange(row.when, range));
    const bought = purchases
      .map((row) => ({ row, when: parseIso(row.paidAt) }))
      .filter((r): r is { row: TransChapPurchase; when: Date } => inRange(r.when, range));

    const sumSales = (match: (method: string | null | undefined) => boolean) =>
      sales
        .filter(({ order }) => match(order.payment_method))
        .reduce((sum, { order }) => sum + order.total, 0);
    const sumPurchases = (role: TransChapPurchase["inventoryRole"]) =>
      bought
        .filter(({ row }) => row.inventoryRole === role)
        .reduce((sum, { row }) => sum + row.total, 0);

    let cogs = 0;
    let units = 0;
    const products = new Map<string, { qty: number; amount: number }>();
    for (const { order } of sales) {
      for (const line of order.items ?? []) {
        const name = line.product_name?.trim() || "Sale";
        const qty = line.quantity || 0;
        const current = products.get(name) ?? { qty: 0, amount: 0 };
        current.qty += qty;
        current.amount += line.line_total || 0;
        products.set(name, current);
        units += qty;
        const inv = line.inventory_item_id
          ? itemLookup.byId.get(line.inventory_item_id)
          : itemLookup.byName.get(name);
        cogs += qty * (inv?.buying_price ?? 0);
      }
    }

    const salesTotal = sales.reduce((sum, { order }) => sum + order.total, 0);
    const purchaseTotal = bought.reduce((sum, { row }) => sum + row.total, 0);

    return {
      salesTotal,
      saleCount: sales.length,
      units,
      purchaseTotal,
      purchaseCount: bought.length,
      forSalePurchases: sumPurchases("for_sale"),
      rawPurchases: sumPurchases("raw_material"),
      bothPurchases: sumPurchases("both"),
      mpesaTotal: sumSales((m) => m === "mpesa"),
      creditTotal: sumSales((m) => m === "credit"),
      cashTotal: sumSales((m) => m !== "mpesa" && m !== "credit"),
      cogs,
      profit: salesTotal - cogs,
      products: [...products.entries()].map(([name, stats]) => ({ name, ...stats })),
      buckets: buildChartBuckets(
        range,
        sales.map(({ order, when }) => ({ when, total: order.total })),
        bought.map(({ row, when }) => ({ when, total: row.total })),
      ),
    };
  }, [itemLookup, orders, purchases, range]);

  const worth = useMemo(() => {
    const salesTotal = orders.reduce((sum, order) => sum + order.total, 0);
    const purchaseTotal = purchases.reduce((sum, row) => sum + row.total, 0);
    const creditTotal = orders
      .filter((order) => order.payment_method === "credit")
      .reduce((sum, order) => sum + order.total, 0);

    // OI - (OA + OS + TP - TS + TD - TC); supplier debt (TD) is not tracked yet.
    const OI = openingInvestment || 0;
    const OA = openingAmount || 0;
    const OS = openingStock || 0;
    const TD = 0;
    return {
      salesTotal,
      purchaseTotal,
      creditTotal,
      cashGenerated: OA + salesTotal - purchaseTotal,
      initialEquity: openingInvestment ?? OA + OS,
      netProfit: OI - (OA + OS + purchaseTotal - salesTotal + TD - creditTotal),
      trueValue: OA + OS + purchaseTotal - salesTotal + creditTotal - TD,
    };
  }, [openingAmount, openingInvestment, openingStock, orders, purchases]);

  const periodText = rangeLabel(range, todayKey);
  const margin = percent(period.profit, period.salesTotal);
  const avgSale = period.saleCount > 0 ? period.salesTotal / period.saleCount : 0;

  const sortedProducts = useMemo(
    () =>
      [...period.products].sort((a, b) =>
        productSort === "qty" ? b.qty - a.qty || b.amount - a.amount : b.amount - a.amount,
      ),
    [period.products, productSort],
  );
  const visibleProducts = showAllProducts ? sortedProducts : sortedProducts.slice(0, LIST_PREVIEW);
  const productMax = Math.max(
    1,
    ...sortedProducts.map((row) => (productSort === "qty" ? row.qty : row.amount)),
  );

  const outCount = lowStock.filter((item) => (item.stock_quantity ?? 0) <= 0).length;
  const visibleStock = showAllStock ? lowStock : lowStock.slice(0, STOCK_PREVIEW);

  const paySlices = [
    { key: "mpesa", label: "M-PESA", value: period.mpesaTotal },
    { key: "cash", label: "Cash", value: period.cashTotal },
    { key: "credit", label: "Credit", value: period.creditTotal },
  ];

  const purchaseNote = (() => {
    const parts = [
      `${period.purchaseCount} purchase${period.purchaseCount === 1 ? "" : "s"}`,
    ];
    if (period.rawPurchases > 0 || period.bothPurchases > 0) {
      if (period.forSalePurchases > 0) parts.push(`sale ${formatKsh(period.forSalePurchases)}`);
      if (period.rawPurchases > 0) parts.push(`raw ${formatKsh(period.rawPurchases)}`);
      if (period.bothPurchases > 0) parts.push(`both ${formatKsh(period.bothPurchases)}`);
    }
    return parts.join(" · ");
  })();

  return (
    <div className="trans-chap-sales trans-chap-reports">
      <TransChapStoreProfile>
        <div className="trans-chap-reports__toolbar">
          <div className="trans-chap-reports__views" role="tablist" aria-label="Report type">
            <button
              type="button"
              role="tab"
              aria-selected={view === "performance"}
              className={view === "performance" ? "is-on" : undefined}
              onClick={() => setView("performance")}
            >
              <i className="fa-solid fa-chart-column" aria-hidden />
              Performance
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "worth"}
              className={view === "worth" ? "is-on" : undefined}
              onClick={() => setView("worth")}
            >
              <i className="fa-solid fa-scale-balanced" aria-hidden />
              Business worth
            </button>
          </div>
          {view === "performance" ? (
            <TransChapRangeFilter
              value={range}
              onChange={(next) => {
                setRange(next);
                setShowAllProducts(false);
              }}
              todayKey={todayKey}
              presets={PRESETS}
              earliestKey={earliestKey}
            />
          ) : (
            <p className="trans-chap-reports__hint">
              Uses your full history and the opening figures from Settings.
            </p>
          )}
        </div>

        <div className="trans-chap-reports__scroll">
          {loading ? (
            <TransChapTodaySkeleton />
          ) : error && orders.length === 0 && purchases.length === 0 ? (
            <TransChapStatus tone="error">{error}</TransChapStatus>
          ) : view === "worth" ? (
            <div className="trans-chap-reports__body">
              <section
                className={`trans-chap-reports__profit trans-chap-reports__wide${
                  worth.netProfit < 0 ? " is-loss" : ""
                }`}
              >
                <div className="trans-chap-reports__profit-copy">
                  <span>{worth.netProfit < 0 ? "Net loss" : "Net profit"} · all time</span>
                  <Money amount={worth.netProfit} />
                  <p>Overall return on what you invested</p>
                </div>
                <i
                  className={`fa-solid ${
                    worth.netProfit < 0 ? "fa-arrow-trend-down" : "fa-arrow-trend-up"
                  }`}
                  aria-hidden
                />
              </section>

              <section className="trans-chap-reports__kpis trans-chap-reports__wide">
                <article className="trans-chap-reports__kpi trans-chap-reports__kpi--opening">
                  <span>Total invested</span>
                  <Money amount={worth.initialEquity} />
                  <small>Opening investment</small>
                </article>
                <article className="trans-chap-reports__kpi trans-chap-reports__kpi--opening">
                  <span>True value</span>
                  <Money amount={worth.trueValue} />
                  <small>Estimated business value</small>
                </article>
                <article className="trans-chap-reports__kpi trans-chap-reports__kpi--stock">
                  <span>Stock value</span>
                  <Money amount={stockValue} />
                  <small>Inventory at buying price</small>
                </article>
                <article className="trans-chap-reports__kpi trans-chap-reports__kpi--sale">
                  <span>Cash generated</span>
                  <Money amount={worth.cashGenerated} />
                  <small>Opening cash + sales − purchases</small>
                </article>
              </section>

              <section className="trans-chap-reports__block trans-chap-reports__wide">
                <header className="trans-chap-reports__block-head">
                  <h2>How it adds up</h2>
                </header>
                <dl className="trans-chap-reports__ledger">
                  <div>
                    <dt>Opening investment</dt>
                    <dd>{formatKsh(openingInvestment ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>Opening cash</dt>
                    <dd>{formatKsh(openingAmount ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>Opening stock</dt>
                    <dd>{formatKsh(openingStock ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>All sales</dt>
                    <dd className="is-plus">+{formatKsh(worth.salesTotal)}</dd>
                  </div>
                  <div>
                    <dt>All purchases</dt>
                    <dd className="is-minus">−{formatKsh(worth.purchaseTotal)}</dd>
                  </div>
                  <div>
                    <dt>Credit sales still owed</dt>
                    <dd>{formatKsh(worth.creditTotal)}</dd>
                  </div>
                </dl>
              </section>
            </div>
          ) : (
            <div className="trans-chap-reports__body">
              <section
                className={`trans-chap-reports__profit${period.profit < 0 ? " is-loss" : ""}`}
              >
                <div className="trans-chap-reports__profit-copy">
                  <span>
                    {period.profit < 0 ? "Gross loss" : "Gross profit"} {periodText}
                  </span>
                  <Money amount={period.profit} />
                  <p>
                    Sales {formatKsh(period.salesTotal)} − Cost of goods{" "}
                    {formatKsh(period.cogs)}
                  </p>
                </div>
                {period.salesTotal > 0 ? (
                  <span className="trans-chap-reports__margin">
                    <b>{margin}%</b>
                    margin
                  </span>
                ) : (
                  <i className="fa-solid fa-chart-line" aria-hidden />
                )}
              </section>

              <section className="trans-chap-reports__block trans-chap-reports__chart-block">
                <header className="trans-chap-reports__block-head">
                  <h2>Sales vs purchases</h2>
                  <ul className="trans-chap-reports__legend">
                    <li className="is-sale">Sales</li>
                    <li className="is-purchase">Purchases</li>
                  </ul>
                </header>
                <TransChapSalesChart
                  buckets={period.buckets}
                  height={190}
                  emptyText={`No sales or purchases ${periodText}.`}
                />
              </section>

              <section className="trans-chap-reports__kpis trans-chap-reports__wide">
                <article className="trans-chap-reports__kpi trans-chap-reports__kpi--sale">
                  <span>Sales</span>
                  <Money amount={period.salesTotal} />
                  <small>
                    {period.saleCount} sale{period.saleCount === 1 ? "" : "s"} · {period.units}{" "}
                    item{period.units === 1 ? "" : "s"}
                  </small>
                </article>
                <article className="trans-chap-reports__kpi trans-chap-reports__kpi--purchase">
                  <span>Purchases</span>
                  <Money amount={period.purchaseTotal} />
                  <small>{purchaseNote}</small>
                </article>
                <article className="trans-chap-reports__kpi trans-chap-reports__kpi--avg">
                  <span>Average sale</span>
                  <Money amount={avgSale} />
                  <small>Per receipt</small>
                </article>
                <article className="trans-chap-reports__kpi trans-chap-reports__kpi--stock">
                  <span>Stock value</span>
                  <Money amount={stockValue} />
                  <small>Right now, at buying price</small>
                </article>
              </section>

              <section className="trans-chap-reports__block">
                <header className="trans-chap-reports__block-head">
                  <h2>How customers paid</h2>
                  <span>{formatKsh(period.salesTotal)}</span>
                </header>
                {period.salesTotal > 0 ? (
                  <ul className="trans-chap-reports__mix">
                    {paySlices.map((slice) => {
                      const pct = percent(slice.value, period.salesTotal);
                      return (
                        <li key={slice.key} className={`is-${slice.key}`}>
                          <div>
                            <span>{slice.label}</span>
                            <strong>
                              {formatKsh(slice.value)}
                              <em>{pct}%</em>
                            </strong>
                          </div>
                          <div className="trans-chap-reports__track" aria-hidden>
                            <b style={{ width: `${slice.value > 0 ? Math.max(pct, 3) : 0}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="trans-chap-reports__empty">No paid sales {periodText}.</p>
                )}
              </section>

              <section className="trans-chap-reports__block">
                <header className="trans-chap-reports__block-head">
                  <h2>Top products</h2>
                  <div className="trans-chap-reports__toggle" role="group" aria-label="Sort by">
                    <button
                      type="button"
                      className={productSort === "amount" ? "is-on" : undefined}
                      aria-pressed={productSort === "amount"}
                      onClick={() => setProductSort("amount")}
                    >
                      Revenue
                    </button>
                    <button
                      type="button"
                      className={productSort === "qty" ? "is-on" : undefined}
                      aria-pressed={productSort === "qty"}
                      onClick={() => setProductSort("qty")}
                    >
                      Qty
                    </button>
                  </div>
                </header>
                {sortedProducts.length === 0 ? (
                  <p className="trans-chap-reports__empty">No paid sales {periodText}.</p>
                ) : (
                  <>
                    <ol className="trans-chap-reports__products">
                      {visibleProducts.map((row, index) => {
                        const metric = productSort === "qty" ? row.qty : row.amount;
                        return (
                          <li key={row.name}>
                            <em className="trans-chap-reports__rank">{index + 1}</em>
                            <div>
                              <div className="trans-chap-reports__product-row">
                                <strong>{row.name}</strong>
                                <b>
                                  {productSort === "qty"
                                    ? `${row.qty} sold`
                                    : formatKsh(row.amount)}
                                </b>
                              </div>
                              <div className="trans-chap-reports__product-meta">
                                <div className="trans-chap-reports__track" aria-hidden>
                                  <b style={{ width: `${percent(metric, productMax)}%` }} />
                                </div>
                                <small>
                                  {productSort === "qty"
                                    ? formatKsh(row.amount)
                                    : `${row.qty} sold`}
                                </small>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                    {sortedProducts.length > LIST_PREVIEW ? (
                      <button
                        type="button"
                        className="trans-chap-reports__more"
                        onClick={() => setShowAllProducts((v) => !v)}
                      >
                        {showAllProducts
                          ? "Show top 5"
                          : `Show all ${sortedProducts.length} products`}
                      </button>
                    ) : null}
                  </>
                )}
              </section>

              <section className="trans-chap-reports__block">
                <header className="trans-chap-reports__block-head">
                  <h2>Stock alerts</h2>
                  {lowStock.length > 0 ? (
                    <div className="trans-chap-reports__counts">
                      {outCount > 0 ? <span className="is-out">{outCount} out</span> : null}
                      {lowStock.length - outCount > 0 ? (
                        <span className="is-low">{lowStock.length - outCount} low</span>
                      ) : null}
                    </div>
                  ) : null}
                </header>
                {lowStock.length === 0 ? (
                  <p className="trans-chap-reports__empty">
                    <i className="fa-solid fa-circle-check" aria-hidden /> Everything is in
                    stock.
                  </p>
                ) : (
                  <>
                    <ul className="trans-chap-reports__stock">
                      {visibleStock.map((item) => {
                        const qty = item.stock_quantity ?? 0;
                        return (
                          <li key={item.id}>
                            <strong>{inventoryProductName(item)}</strong>
                            <span className={qty <= 0 ? "is-out" : "is-low"}>
                              {qty <= 0 ? "Out of stock" : `${qty} left`}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {lowStock.length > STOCK_PREVIEW ? (
                      <button
                        type="button"
                        className="trans-chap-reports__more"
                        onClick={() => setShowAllStock((v) => !v)}
                      >
                        {showAllStock ? "Show fewer" : `Show all ${lowStock.length} items`}
                      </button>
                    ) : null}
                  </>
                )}
              </section>

              {truncated ? (
                <p className="trans-chap-reports__hint trans-chap-reports__wide">
                  Only your most recent sales and purchases are loaded, so long date ranges
                  may be incomplete.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </TransChapStoreProfile>
    </div>
  );
}
