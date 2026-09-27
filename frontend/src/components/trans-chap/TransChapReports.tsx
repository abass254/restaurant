"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthUser } from "@/components/app/AuthProvider";
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
import { formatKesDigits, formatKsh } from "@/lib/trans-chap-receipt";
import type {
  InventoryItem,
  InventoryResponse,
  Order,
} from "@/lib/types";

type WhenFilter = "today" | "week" | "all" | "net";

const WHEN_CHIPS: { id: WhenFilter; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "7 days" },
  { id: "all", label: "All" },
  { id: "net", label: "NET" },
];

function dateKeyFromIso(iso: string | null | undefined): string | null {
  const date = parseIso(iso);
  return date ? nairobiDateKey(date) : null;
}

function isWithinLastDays(key: string, days: number, todayKey: string): boolean {
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const [ky, km, kd] = key.split("-").map(Number);
  const diff =
    (Date.UTC(ty, tm - 1, td) - Date.UTC(ky, km - 1, kd)) / 86_400_000;
  return diff >= 0 && diff < days;
}

function inPeriod(key: string | null, when: WhenFilter, todayKey: string): boolean {
  if (when === "all") return true;
  if (!key) return false;
  if (when === "today") return key === todayKey;
  return isWithinLastDays(key, 7, todayKey);
}

function Money({ amount }: { amount: number }) {
  return (
    <strong aria-label={formatKsh(amount)}>
      <small>Ksh</small>
      {formatKesDigits(amount)}
    </strong>
  );
}

export function TransChapReports() {
  const user = useAuthUser();
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<TransChapPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState<WhenFilter>("today");
  const [openingAmount, setOpeningAmount] = useState<number | null>(null);
  const [openingStock, setOpeningStock] = useState<number | null>(null);
  const [openingInvestment, setOpeningInvestment] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [sales, inventory, bought, settingsData] = await Promise.all([
        fetchWalkinOrders(),
        apiFetch<InventoryResponse>(apiRoutes.inventory),
        fetchTransChapPurchases({
          accountId: user.active_account?.id || user.account?.id,
        }),
        apiFetch<any>(apiRoutes.settings).catch(() => null),
      ]);
      setOrders(sales.orders);
      setItems(inventory.data);
      setPurchases(bought.purchases);
      setOpeningAmount(settingsData?.opening_amount ? Number(settingsData.opening_amount) : null);
      setOpeningStock(settingsData?.opening_stock ? Number(settingsData.opening_stock) : null);
      setOpeningInvestment(settingsData?.opening_investment ? Number(settingsData.opening_investment) : null);
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
  }, [user.account?.id, user.active_account?.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const todayKey = nairobiDateKey(new Date());

  const report = useMemo(() => {
    // For NET tab, we use ALL history to calculate cash flow accurately
    const isNet = when === "net";
    const filterWhen = isNet ? "all" : when;

    const paid = orders.filter((order) => {
      if (!isCountedWalkinSale(order)) return false;
      const key = dateKeyFromIso(order.paid_at || order.placed_at || order.created_at);
      return inPeriod(key, filterWhen, todayKey);
    });
    const bought = purchases.filter((row) =>
      inPeriod(dateKeyFromIso(row.paidAt), filterWhen, todayKey),
    );

    const salesTotal = paid.reduce((sum, order) => sum + order.total, 0);
    const mpesaTotal = paid
      .filter((order) => order.payment_method === "mpesa")
      .reduce((sum, order) => sum + order.total, 0);
    const creditTotal = paid
      .filter((order) => order.payment_method === "credit")
      .reduce((sum, order) => sum + order.total, 0);
    const cashTotal = paid
      .filter((order) => order.payment_method !== "mpesa" && order.payment_method !== "credit")
      .reduce((sum, order) => sum + order.total, 0);
    const purchaseTotal = bought.reduce((sum, row) => sum + row.total, 0);
    const forSalePurchaseTotal = bought
      .filter((row) => row.inventoryRole === "for_sale")
      .reduce((sum, row) => sum + row.total, 0);
    const rawPurchaseTotal = bought
      .filter((row) => row.inventoryRole === "raw_material")
      .reduce((sum, row) => sum + row.total, 0);
    const bothPurchaseTotal = bought
      .filter((row) => row.inventoryRole === "both")
      .reduce((sum, row) => sum + row.total, 0);
    const units = paid.reduce(
      (sum, order) =>
        sum + (order.items?.reduce((qty, line) => qty + (line.quantity || 0), 0) ?? 0),
      0,
    );

    const itemByInvId = new Map(items.map((i) => [i.id, i]));
    let cogsTotal = 0;

    const productTotals = new Map<string, { qty: number; amount: number }>();
    for (const order of paid) {
      for (const line of order.items ?? []) {
        const name = line.product_name?.trim() || "Sale";
        const current = productTotals.get(name) ?? { qty: 0, amount: 0 };
        current.qty += line.quantity || 0;
        current.amount += line.line_total || 0;
        productTotals.set(name, current);

        let buyingPrice = 0;
        if (line.inventory_item_id) {
          const inv = itemByInvId.get(line.inventory_item_id);
          if (inv && inv.buying_price != null) {
            buyingPrice = inv.buying_price;
          }
        } else {
          const inv = items.find((i) => inventoryProductName(i) === name);
          if (inv && inv.buying_price != null) {
            buyingPrice = inv.buying_price;
          }
        }
        cogsTotal += (line.quantity || 0) * buyingPrice;
      }
    }
    const topProducts = [...productTotals.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 5)
      .map(([name, stats]) => ({ name, ...stats }));

    const lowStock = items.filter(
      (item) =>
        item.stock_quantity != null &&
        (item.stock_quantity <= 0 || item.is_low_stock),
    );

    const stockValue = items.reduce(
      (sum, item) => sum + Math.max(0, item.stock_quantity || 0) * (item.buying_price || 0),
      0
    );
    
    // For NET tab, we calculate total cash flow and net equity
    const cashOnHand = (openingAmount || 0) + salesTotal - purchaseTotal; 
    const currentEquity = cashOnHand + stockValue;
    
    const initialEquity = openingInvestment != null 
      ? openingInvestment 
      : ((openingAmount || 0) + (openingStock || 0));
      
    // As requested: OI - (OA + OS + TP - TS + TD - TC)
    // We treat openingInvestment as OI. If null, we default to 0 to avoid breaking the math.
    const OI = openingInvestment || 0;
    const OA = openingAmount || 0;
    const OS = openingStock || 0;
    const TP = purchaseTotal;
    const TS = salesTotal;
    const TC = creditTotal; // Amount customers have not paid
    const TD = 0; // Amount not paid to suppliers (to be implemented if tracked)

    const netProfit = OI - (OA + OS + TP - TS + TD - TC);
    const trueValue = (OA + OS + TP - TS) + TC - TD;

    return {
      salesTotal,
      cashTotal,
      creditTotal,
      mpesaTotal,
      purchaseTotal,
      forSalePurchaseTotal,
      rawPurchaseTotal,
      bothPurchaseTotal,
      cogsTotal,
      stockValue,
      cashOnHand,
      currentEquity,
      trueValue,
      initialEquity,
      netProfit,
      profit: salesTotal - cogsTotal,
      saleCount: paid.length,
      purchaseCount: bought.length,
      units,
      topProducts,
      lowStock,
    };
  }, [items, orders, purchases, todayKey, when]);

  const purchaseBreakdown = (() => {
    const parts = [
      `${report.purchaseCount} purchase${report.purchaseCount === 1 ? "" : "s"}`,
    ];
    if (report.rawPurchaseTotal > 0 || report.bothPurchaseTotal > 0) {
      if (report.forSalePurchaseTotal > 0) {
        parts.push(`sale ${formatKsh(report.forSalePurchaseTotal)}`);
      }
      if (report.rawPurchaseTotal > 0) {
        parts.push(`raw ${formatKsh(report.rawPurchaseTotal)}`);
      }
      if (report.bothPurchaseTotal > 0) {
        parts.push(`both ${formatKsh(report.bothPurchaseTotal)}`);
      }
    }
    return parts.join(" · ");
  })();

  return (
    <div className="trans-chap-sales trans-chap-reports">
      <TransChapStoreProfile>
        <div className="trans-chap-sales__filters">
          <div className="trans-chap-sales__chips" role="group" aria-label="Report period">
            {WHEN_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className={`trans-chap-sales__chip${when === chip.id ? " is-active" : ""}`}
                aria-pressed={when === chip.id}
                onClick={() => setWhen(chip.id)}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        <div className="trans-chap-reports__scroll">
          {loading ? (
            <TransChapTodaySkeleton />
          ) : error && orders.length === 0 && purchases.length === 0 ? (
            <TransChapStatus tone="error">{error}</TransChapStatus>
          ) : (
            <div className="trans-chap-reports__body">
              {when === "net" ? (
                <>
                  <section
                    className={`trans-chap-reports__profit${report.netProfit < 0 ? " is-loss" : ""}`}
                    aria-label={report.netProfit < 0 ? "Loss" : "Profit"}
                  >
                    <div className="trans-chap-reports__profit-copy">
                      <span>{report.netProfit < 0 ? "Net Loss" : "Net Profit"}</span>
                      <Money amount={report.netProfit} />
                      <p>Overall Return on Investment</p>
                    </div>
                    <i
                      className={`fa-solid ${report.netProfit < 0 ? "fa-arrow-trend-down" : "fa-arrow-trend-up"}`}
                      aria-hidden
                    />
                  </section>
                  <section className="trans-chap-reports__kpis" aria-label="Totals">
                    <article className="trans-chap-reports__kpi trans-chap-reports__kpi--opening">
                      <span>Total Invested</span>
                      <Money amount={report.initialEquity} />
                      <small>Initial Equity Baseline</small>
                    </article>
                    <article className="trans-chap-reports__kpi trans-chap-reports__kpi--opening">
                      <span>True Value</span>
                      <Money amount={report.trueValue} />
                      <small>Est. Total Merchant Value</small>
                    </article>
                    <article className="trans-chap-reports__kpi trans-chap-reports__kpi--stock">
                      <span>Stock Value</span>
                      <Money amount={report.stockValue} />
                      <small>Value of physical inventory</small>
                    </article>
                    <article className="trans-chap-reports__kpi trans-chap-reports__kpi--sale">
                      <span>Cash Generated</span>
                      <Money amount={report.cashOnHand} />
                      <small>Total Sales minus Total Purchases</small>
                    </article>
                  </section>
                </>
              ) : (
                <>
                  <section
                    className={`trans-chap-reports__profit${report.profit < 0 ? " is-loss" : ""}`}
                    aria-label={report.profit < 0 ? "Loss" : "Profit"}
                  >
                    <div className="trans-chap-reports__profit-copy">
                      <span>{report.profit < 0 ? "Loss" : "Profit"}</span>
                      <Money amount={report.profit} />
                      <p>Sales minus cost of goods sold in this period</p>
                    </div>
                    <i
                      className={`fa-solid ${report.profit < 0 ? "fa-arrow-trend-down" : "fa-arrow-trend-up"}`}
                      aria-hidden
                    />
                  </section>

              <section className="trans-chap-reports__kpis" aria-label="Totals">
                <article className="trans-chap-reports__kpi trans-chap-reports__kpi--sale">
                  <span>Sales</span>
                  <Money amount={report.salesTotal} />
                  <small>
                    {report.saleCount} sale{report.saleCount === 1 ? "" : "s"} · {report.units}{" "}
                    sold
                  </small>
                </article>
                <article className="trans-chap-reports__kpi trans-chap-reports__kpi--purchase">
                  <span>Purchases</span>
                  <Money amount={report.purchaseTotal} />
                  <small>{purchaseBreakdown}</small>
                </article>
                <article className="trans-chap-reports__kpi trans-chap-reports__kpi--stock">
                  <span>Current Stock</span>
                  <Money amount={report.stockValue} />
                  <small>Total inventory value</small>
                </article>
                {openingAmount !== null ? (
                  <article className="trans-chap-reports__kpi trans-chap-reports__kpi--opening">
                    <span>Opening Stock</span>
                    <Money amount={openingAmount} />
                    <small>Set from settings</small>
                  </article>
                ) : null}
              </section>

                </>
              )}

              <section className="trans-chap-reports__split" aria-label="How customers paid">
                <article className="trans-chap-reports__pay trans-chap-reports__pay--mpesa">
                  <span>M-PESA</span>
                  <Money amount={report.mpesaTotal} />
                </article>
                <article className="trans-chap-reports__pay trans-chap-reports__pay--credit">
                  <span>Credit</span>
                  <Money amount={report.creditTotal} />
                </article>
                {report.cashTotal > 0 ? (
                  <article className="trans-chap-reports__pay trans-chap-reports__pay--cash">
                    <span>Cash</span>
                    <Money amount={report.cashTotal} />
                  </article>
                ) : null}
              </section>

              <section
                className="trans-chap-reports__block"
                aria-labelledby="trans-chap-top-products"
              >
                <h2 id="trans-chap-top-products">Top products</h2>
                {report.topProducts.length === 0 ? (
                  <p className="trans-chap-sales__empty">No paid sales in this period.</p>
                ) : (
                  <ul>
                    {report.topProducts.map((row, index) => (
                      <li key={row.name}>
                        <em className="trans-chap-reports__rank" aria-hidden>
                          {index + 1}
                        </em>
                        <span>
                          <strong>{row.name}</strong>
                          <small>{row.qty} sold</small>
                        </span>
                        <b>{formatKsh(row.amount)}</b>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section
                className="trans-chap-reports__block"
                aria-labelledby="trans-chap-stock-alerts"
              >
                <h2 id="trans-chap-stock-alerts">Stock alerts</h2>
                {report.lowStock.length === 0 ? (
                  <p className="trans-chap-sales__empty">No low-stock items right now.</p>
                ) : (
                  <ul>
                    {report.lowStock.map((item) => {
                      const qty = item.stock_quantity ?? 0;
                      return (
                        <li key={item.id}>
                          <span>
                            <strong>{inventoryProductName(item)}</strong>
                            <small>{qty <= 0 ? "Out of stock" : `${qty} left`}</small>
                          </span>
                          <b className={qty <= 0 ? "is-out" : "is-low"}>
                            {qty <= 0 ? "Out" : "Low"}
                          </b>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>
      </TransChapStoreProfile>
    </div>
  );
}
