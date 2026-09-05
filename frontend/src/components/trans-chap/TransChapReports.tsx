"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthUser } from "@/components/app/AuthProvider";
import { FeedsAnalyticsDashboard } from "@/components/app/FeedsAnalyticsDashboard";
import { TransChapStatus } from "@/components/trans-chap/TransChapStatus";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { nairobiDateKey, parseIso } from "@/lib/nairobi-time";
import { fetchWalkinOrders, isCountedWalkinSale } from "@/lib/trans-chap-orders";
import { fetchTransChapPurchases, type TransChapPurchase } from "@/lib/trans-chap-purchases";
import { inventoryProductName } from "@/lib/trans-chap-product";
import { formatKsh } from "@/lib/trans-chap-receipt";
import {
  userCanAccessSection,
} from "@/lib/merchant-permissions";
import type {
  InventoryItem,
  InventoryResponse,
  Order,
} from "@/lib/types";

type WhenFilter = "today" | "week" | "all";

const WHEN_CHIPS: { id: WhenFilter; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "7 days" },
  { id: "all", label: "All" },
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

export function TransChapReports() {
  const user = useAuthUser();
  const canSeeFeedAnalytics =
    userCanAccessSection(user, "feeds") && Boolean(user.instagram_account);
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<TransChapPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState<WhenFilter>("today");
  const [section, setSection] = useState<"sales" | "feeds">(
    "sales",
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [sales, inventory, bought] = await Promise.all([
        fetchWalkinOrders(),
        apiFetch<InventoryResponse>(apiRoutes.inventory),
        fetchTransChapPurchases({
          accountId: user.active_account?.id || user.account?.id,
        }),
      ]);
      setOrders(sales.orders);
      setItems(inventory.data);
      setPurchases(bought.purchases);
      setError(sales.error || bought.error);
    } catch (err) {
      setOrders([]);
      setItems([]);
      setPurchases([]);
      setError(extractErrorMessage(err, "Could not load report."));
    } finally {
      setLoading(false);
    }
  }, [user.account?.id, user.active_account?.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const todayKey = nairobiDateKey(new Date());

  const report = useMemo(() => {
    const paid = orders.filter((order) => {
      if (!isCountedWalkinSale(order)) return false;
      const key = dateKeyFromIso(order.paid_at || order.placed_at || order.created_at);
      return inPeriod(key, when, todayKey);
    });
    const bought = purchases.filter((row) =>
      inPeriod(dateKeyFromIso(row.paidAt), when, todayKey),
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
    const units = paid.reduce(
      (sum, order) =>
        sum + (order.items?.reduce((qty, line) => qty + (line.quantity || 0), 0) ?? 0),
      0,
    );

    const productTotals = new Map<string, { qty: number; amount: number }>();
    for (const order of paid) {
      for (const line of order.items ?? []) {
        const name = line.product_name?.trim() || "Sale";
        const current = productTotals.get(name) ?? { qty: 0, amount: 0 };
        current.qty += line.quantity || 0;
        current.amount += line.line_total || 0;
        productTotals.set(name, current);
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

    return {
      salesTotal,
      cashTotal,
      creditTotal,
      mpesaTotal,
      purchaseTotal,
      profit: salesTotal - purchaseTotal,
      saleCount: paid.length,
      purchaseCount: bought.length,
      units,
      topProducts,
      lowStock,
    };
  }, [items, orders, purchases, todayKey, when]);

  return (
    <div className="trans-chap-sales trans-chap-reports">
      {canSeeFeedAnalytics ? (
        <div className="trans-chap-sales__filters">
          <div className="trans-chap-sales__chips" role="tablist" aria-label="Report section">
            <button
              type="button"
              role="tab"
              className={`trans-chap-sales__chip${section === "sales" ? " is-active" : ""}`}
              aria-selected={section === "sales"}
              onClick={() => setSection("sales")}
            >
              Sales
            </button>
            <button
              type="button"
              role="tab"
              className={`trans-chap-sales__chip${section === "feeds" ? " is-active" : ""}`}
              aria-selected={section === "feeds"}
              onClick={() => setSection("feeds")}
            >
              Feeds
            </button>
          </div>
        </div>
      ) : null}

      {section === "feeds" && canSeeFeedAnalytics ? (
        <div className="trans-chap-reports__feeds fb-app">
          <FeedsAnalyticsDashboard
            embedded
            settingsHref="/trans-chap/settings"
          />
        </div>
      ) : (
        <>
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

          {loading ? (
            <p className="trans-chap-sales__empty">Loading report…</p>
          ) : error && orders.length === 0 && purchases.length === 0 ? (
            <TransChapStatus tone="error">{error}</TransChapStatus>
          ) : (
            <div className="trans-chap-reports__body">
              <section className="trans-chap-reports__kpis" aria-label="Totals">
                <article className="trans-chap-reports__kpi">
                  <span>Sales</span>
                  <strong>{formatKsh(report.salesTotal)}</strong>
                  <small>
                    {report.saleCount} sale{report.saleCount === 1 ? "" : "s"} · {report.units} sold
                  </small>
                </article>
                <article className="trans-chap-reports__kpi">
                  <span>Purchases</span>
                  <strong>{formatKsh(report.purchaseTotal)}</strong>
                  <small>
                    {report.purchaseCount} purchase{report.purchaseCount === 1 ? "" : "s"}
                  </small>
                </article>
                <article
                  className={`trans-chap-reports__kpi trans-chap-reports__kpi--wide${
                    report.profit < 0 ? " is-loss" : ""
                  }`}
                >
                  <span>{report.profit < 0 ? "Loss" : "Profit"}</span>
                  <strong>{formatKsh(report.profit)}</strong>
                  <small>Sales minus restock spend in this period — not cost of goods sold</small>
                </article>
              </section>

              <section className="trans-chap-reports__split" aria-label="How customers paid">
                <article>
                  <span>M-PESA</span>
                  <strong>{formatKsh(report.mpesaTotal)}</strong>
                </article>
                <article>
                  <span>Credit</span>
                  <strong>{formatKsh(report.creditTotal)}</strong>
                </article>
                {report.cashTotal > 0 ? (
                  <article>
                    <span>Cash</span>
                    <strong>{formatKsh(report.cashTotal)}</strong>
                  </article>
                ) : null}
              </section>

              <section className="trans-chap-reports__block" aria-labelledby="trans-chap-top-products">
                <h2 id="trans-chap-top-products">Top products</h2>
                {report.topProducts.length === 0 ? (
                  <p className="trans-chap-sales__empty">No paid sales in this period.</p>
                ) : (
                  <ul>
                    {report.topProducts.map((row) => (
                      <li key={row.name}>
                        <span>
                          <strong>{row.name}</strong>
                          <small>
                            {row.qty} sold
                          </small>
                        </span>
                        <em>{formatKsh(row.amount)}</em>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="trans-chap-reports__block" aria-labelledby="trans-chap-stock-alerts">
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
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
