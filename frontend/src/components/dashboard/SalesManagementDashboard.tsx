"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { formatMoney } from "@/lib/orders";
import { nairobiDateKey, parseIso } from "@/lib/nairobi-time";
import { useAuthUser } from "@/components/app/AuthProvider";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import { DashboardInsights } from "@/components/dashboard/DashboardInsights";
import type { InventoryItem, InventoryResponse, Order, OrdersListResponse } from "@/lib/types";

const POLL_MS = 30_000;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const ACCENT_KEYS = ["amber", "teal", "indigo", "blue"] as const;
type AccentKey = (typeof ACCENT_KEYS)[number];

type ChartColors = {
  primary: string;
  teal: string;
  amber: string;
  blue: string;
  indigo: string;
  border: string;
  muted: string;
  surface: string;
};

const FALLBACK_CHART_COLORS: ChartColors = {
  primary: "#1877f2",
  teal: "#7ec8b8",
  amber: "#f5c77a",
  blue: "#6eb3ff",
  indigo: "#a5b4fc",
  border: "#e8eaef",
  muted: "#6b7280",
  surface: "#ffffff",
};

function readChartColors(): ChartColors {
  if (typeof window === "undefined") return FALLBACK_CHART_COLORS;
  const style = getComputedStyle(document.documentElement);
  const pick = (token: string, fallback: string) =>
    style.getPropertyValue(token).trim() || fallback;
  return {
    primary: pick("--app-primary", FALLBACK_CHART_COLORS.primary),
    teal: pick("--app-accent-teal", FALLBACK_CHART_COLORS.teal),
    amber: pick("--app-accent-amber", FALLBACK_CHART_COLORS.amber),
    blue: pick("--app-accent-blue", FALLBACK_CHART_COLORS.blue),
    indigo: pick("--app-accent-indigo", FALLBACK_CHART_COLORS.indigo),
    border: pick("--app-border", FALLBACK_CHART_COLORS.border),
    muted: pick("--app-text-secondary", FALLBACK_CHART_COLORS.muted),
    surface: pick("--app-surface", FALLBACK_CHART_COLORS.surface),
  };
}

function accentVar(key: AccentKey): string {
  return `var(--app-accent-${key})`;
}

function accentSoftVar(key: AccentKey): string {
  return `var(--app-accent-${key}-soft)`;
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function formatDelta(delta: number | null): string {
  if (delta == null) return "—";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}% from yesterday`;
}

function isPaid(order: Order): boolean {
  return Boolean(order.paid_at);
}

function orderRevenue(order: Order): number {
  return isPaid(order) ? Number(order.total) || 0 : 0;
}

function productsSoldInOrders(orders: Order[]): number {
  let total = 0;
  for (const order of orders) {
    for (const item of order.items ?? []) {
      total += item.quantity;
    }
  }
  return total;
}

function uniqueCustomers(orders: Order[]): number {
  const phones = new Set<string>();
  for (const order of orders) {
    const phone = order.customer_phone?.trim();
    if (phone) phones.add(phone);
  }
  return phones.size;
}

function compactMoney(value: number, currency: string): string {
  if (value >= 1_000_000) return `${currency} ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${currency} ${Math.round(value / 1_000)}k`;
  return formatMoney(value, currency);
}

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
  formatter?: (value: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="smd-tooltip">
      {label ? <strong>{label}</strong> : null}
      <ul>
        {payload.map((entry) => (
          <li key={entry.name}>
            <span style={{ background: entry.color }} />
            {entry.name}:{" "}
            {formatter
              ? formatter(entry.value ?? 0, entry.name ?? "")
              : (entry.value ?? 0).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SalesManagementDashboard() {
  const user = useAuthUser();
  const hasShop = Boolean(user.account);
  const shopName = user.account?.business_name ?? user.name ?? "your shop";

  const [orders, setOrders] = useState<Order[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(hasShop);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [chartColors, setChartColors] = useState(FALLBACK_CHART_COLORS);

  const loadInventory = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setInventoryLoading(true);
    try {
      const data = await apiFetch<InventoryResponse>(apiRoutes.inventory);
      setInventory(data.data);
      setInventoryError(null);
    } catch (err: unknown) {
      if (!silent) {
        setInventoryError(err instanceof ApiError ? err.message : "Could not load inventory.");
      }
    } finally {
      if (!silent) setInventoryLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async (opts?: { silent?: boolean }) => {
    if (!hasShop) return;
    const silent = opts?.silent ?? false;
    if (!silent) setOrdersLoading(true);
    try {
      const first = await apiFetch<OrdersListResponse>(`${apiRoutes.orders}?per_page=100&page=1`);
      const pages = Math.min(first.meta.last_page, 10);
      const combined = [...first.data];
      if (pages > 1) {
        const results = await Promise.all(
          Array.from({ length: pages - 1 }, (_, idx) =>
            apiFetch<OrdersListResponse>(`${apiRoutes.orders}?per_page=100&page=${idx + 2}`),
          ),
        );
        for (const page of results) combined.push(...page.data);
      }
      setOrders(combined);
      setOrdersError(null);
    } catch (err: unknown) {
      if (!silent) {
        setOrdersError(err instanceof ApiError ? err.message : "Could not load orders.");
      }
    } finally {
      if (!silent) setOrdersLoading(false);
    }
  }, [hasShop]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    setChartColors(readChartColors());
    const observer = new MutationObserver(() => setChartColors(readChartColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadInventory({ silent: true });
      if (hasShop) void loadOrders({ silent: true });
    }, POLL_MS);
    return () => window.clearInterval(interval);
  }, [loadInventory, loadOrders, hasShop]);

  const loading = ordersLoading || inventoryLoading;
  const currency = orders[0]?.currency ?? "KES";

  const todayKey = useMemo(() => nairobiDateKey(new Date()), []);
  const yesterdayKey = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return nairobiDateKey(d);
  }, []);

  const ordersForDay = useCallback(
    (key: string) =>
      orders.filter((order) => {
        const created = parseIso(order.created_at);
        return created ? nairobiDateKey(created) === key : false;
      }),
    [orders],
  );

  const todayOrders = useMemo(() => ordersForDay(todayKey), [ordersForDay, todayKey]);
  const yesterdayOrders = useMemo(() => ordersForDay(yesterdayKey), [ordersForDay, yesterdayKey]);

  const kpis = useMemo(() => {
    const todayRevenue = todayOrders.reduce((sum, o) => sum + orderRevenue(o), 0);
    const yesterdayRevenue = yesterdayOrders.reduce((sum, o) => sum + orderRevenue(o), 0);
    const todayCount = todayOrders.length;
    const yesterdayCount = yesterdayOrders.length;
    const todayUnits = productsSoldInOrders(todayOrders);
    const yesterdayUnits = productsSoldInOrders(yesterdayOrders);
    const todayCustomers = uniqueCustomers(todayOrders);
    const yesterdayCustomers = uniqueCustomers(yesterdayOrders);

    return [
      {
        key: "revenue",
        icon: "fa-coins",
        accent: "amber" as AccentKey,
        label: "Total sales",
        value: compactMoney(todayRevenue, currency),
        delta: formatDelta(pctChange(todayRevenue, yesterdayRevenue)),
      },
      {
        key: "orders",
        icon: "fa-receipt",
        accent: "teal" as AccentKey,
        label: "Total orders",
        value: todayCount.toLocaleString(),
        delta: formatDelta(pctChange(todayCount, yesterdayCount)),
      },
      {
        key: "units",
        icon: "fa-box-open",
        accent: "indigo" as AccentKey,
        label: "Products sold",
        value: todayUnits.toLocaleString(),
        delta: formatDelta(pctChange(todayUnits, yesterdayUnits)),
      },
      {
        key: "customers",
        icon: "fa-user-plus",
        accent: "blue" as AccentKey,
        label: "New customers",
        value: todayCustomers.toLocaleString(),
        delta: formatDelta(pctChange(todayCustomers, yesterdayCustomers)),
      },
    ];
  }, [currency, todayOrders, yesterdayOrders]);

  const channelLevels = useMemo(() => {
    const now = new Date();
    const buckets = Array.from({ length: 7 }, (_, idx) => {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - (6 - idx));
      const key = nairobiDateKey(d);
      const dayIndex = (d.getUTCDay() + 6) % 7;
      return {
        key,
        label: DAY_LABELS[dayIndex],
        delivery: 0,
        pickup: 0,
      };
    });
    const map = new Map(buckets.map((b) => [b.key, b]));

    for (const order of orders) {
      const created = parseIso(order.created_at);
      if (!created) continue;
      const key = nairobiDateKey(created);
      const bucket = map.get(key);
      if (!bucket) continue;
      if (order.fulfillment_type === "delivery") bucket.delivery += 1;
      else bucket.pickup += 1;
    }

    return buckets;
  }, [orders]);

  const topProducts = useMemo(() => {
    const totals = new Map<string, { name: string; units: number; revenue: number }>();
    for (const order of orders) {
      for (const item of order.items ?? []) {
        const name = item.product_name?.trim() || "Unnamed product";
        const row = totals.get(name) ?? { name, units: 0, revenue: 0 };
        row.units += item.quantity;
        row.revenue += item.line_total ?? item.quantity * (item.unit_price ?? 0);
        totals.set(name, row);
      }
    }

    const ranked = [...totals.values()].sort((a, b) => b.revenue - a.revenue);
    const maxRevenue = ranked[0]?.revenue ?? 1;

    if (ranked.length === 0 && inventory.length > 0) {
      return inventory.slice(0, 5).map((item, idx) => {
        const name = item.product?.name ?? `Product ${idx + 1}`;
        const stock = item.stock_quantity ?? 0;
        const popularity = Math.min(100, Math.max(8, stock > 0 ? 55 + idx * 8 : 20));
        return {
          id: item.id,
          name,
          popularity,
          salesPct: `${Math.max(5, 100 - idx * 12)}%`,
          accent: ACCENT_KEYS[idx % ACCENT_KEYS.length],
        };
      });
    }

    return ranked.slice(0, 5).map((row, idx) => ({
      id: row.name,
      name: row.name,
      popularity: Math.round((row.revenue / maxRevenue) * 100),
      salesPct: `${Math.round((row.units / Math.max(1, productsSoldInOrders(orders))) * 100)}%`,
      accent: ACCENT_KEYS[idx % ACCENT_KEYS.length],
    }));
  }, [orders, inventory]);

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return topProducts;
    return topProducts.filter((p) => p.name.toLowerCase().includes(q));
  }, [productQuery, topProducts]);

  const fulfilmentTrend = useMemo(() => {
    const now = new Date();
    const points = Array.from({ length: 14 }, (_, idx) => {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - (13 - idx));
      const key = nairobiDateKey(d);
      return {
        key,
        label: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`,
        thisPeriod: 0,
        lastPeriod: 0,
      };
    });
    const map = new Map(points.map((p) => [p.key, p]));

    for (const order of orders) {
      const created = parseIso(order.created_at);
      if (!created) continue;
      const key = nairobiDateKey(created);
      const point = map.get(key);
      if (point) point.thisPeriod += orderRevenue(order);

      const shifted = new Date(created);
      shifted.setUTCDate(shifted.getUTCDate() + 14);
      const shiftedKey = nairobiDateKey(shifted);
      const shiftedPoint = map.get(shiftedKey);
      if (shiftedPoint) shiftedPoint.lastPeriod += orderRevenue(order);
    }

    return points;
  }, [orders]);

  const fulfilmentTotals = useMemo(() => {
    const thisTotal = fulfilmentTrend.reduce((sum, row) => sum + row.thisPeriod, 0);
    const lastTotal = fulfilmentTrend.reduce((sum, row) => sum + row.lastPeriod, 0);
    return { thisTotal, lastTotal };
  }, [fulfilmentTrend]);

  const earnings = useMemo(() => {
    const totalValue = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const collected = orders.reduce((sum, o) => sum + orderRevenue(o), 0);
    const collectionRate = totalValue > 0 ? Math.round((collected / totalValue) * 100) : 0;
    const pending = Math.max(0, totalValue - collected);
    const profitHint =
      fulfilmentTotals.lastTotal > 0
        ? `Revenue is ${Math.abs(
            Math.round(
              ((fulfilmentTotals.thisTotal - fulfilmentTotals.lastTotal) /
                fulfilmentTotals.lastTotal) *
                100,
            ),
          )}% ${fulfilmentTotals.thisTotal >= fulfilmentTotals.lastTotal ? "more" : "less"} than prior period`
        : "Track payments to see collection trends";
    return { totalValue, collected, pending, collectionRate, profitHint };
  }, [orders, fulfilmentTotals]);

  const monthlyTrend = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, idx) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - idx), 1));
      return {
        key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
        label: MONTH_LABELS[d.getUTCMonth()],
        orders: 0,
      };
    });
    const map = new Map(months.map((m) => [m.key, m]));

    for (const order of orders) {
      const created = parseIso(order.created_at);
      if (!created) continue;
      const key = `${created.getUTCFullYear()}-${String(created.getUTCMonth() + 1).padStart(2, "0")}`;
      const month = map.get(key);
      if (month) month.orders += 1;
    }

    return months;
  }, [orders]);

  const peakMonth = useMemo(() => {
    let best = monthlyTrend[0];
    for (const row of monthlyTrend) {
      if (row.orders > (best?.orders ?? 0)) best = row;
    }
    return best;
  }, [monthlyTrend]);

  const gaugeData = [
    { name: "collected", value: earnings.collectionRate },
    { name: "remaining", value: Math.max(0, 100 - earnings.collectionRate) },
  ];

  return (
    <section className="app-panel smd-panel">
      <header className="smd-header">
        <div className="smd-header__intro">
          <h1 className="app-title">Dashboard</h1>
          <p className="app-lead">
            {shopName}&apos;s overview — catalog health, orders, and sales performance.
          </p>
        </div>
      </header>

      <div className="dashboard-section">
        <DashboardInsights
          inventoryItems={inventory}
          orderItems={orders}
          inventoryLoading={inventoryLoading}
          ordersLoading={ordersLoading}
          inventoryError={inventoryError}
          ordersError={ordersError}
          ordersBlocked={!hasShop}
        />
      </div>

      {!hasShop ? (
        <div className="smd-setup-banner">
          <i className="fa-solid fa-chart-line" aria-hidden="true" />
          <p>Finish shop setup to unlock sales charts and trend analytics below.</p>
          <Link href="/tools/onboarding" className="btn btn-primary btn-sm">
            Continue setup
          </Link>
        </div>
      ) : (
        <div className="dashboard-section dashboard-section--analytics">
          {ordersError ? <p className="app-error smd-error">{ordersError}</p> : null}
          {inventoryError ? <p className="app-error smd-error">{inventoryError}</p> : null}

          <header className="dashboard-section__head">
            <h2 className="dashboard-section__title">Sales analytics</h2>
            <p className="dashboard-section__sub">Trends, channels, and product performance</p>
          </header>

          <div className="smd-grid">
            <article className="smd-card smd-card--span-8">
              <header className="smd-card__head">
                <h2>Today&apos;s sales</h2>
              </header>
              <MotionList as="div" className="smd-kpi-row" staggerChildren={0.05}>
                {kpis.map((kpi) => (
                  <MotionItem key={kpi.key} as="div" className={`smd-kpi smd-kpi--${kpi.accent}`}>
                    <span className="smd-kpi__icon" style={{ background: accentSoftVar(kpi.accent) }}>
                      <i className={`fa-solid ${kpi.icon}`} style={{ color: accentVar(kpi.accent) }} />
                    </span>
                    <div className="smd-kpi__body">
                      {loading ? (
                        <Skeleton variant="text" height={26} width={72} />
                      ) : (
                        <strong>{kpi.value}</strong>
                      )}
                      <span>{kpi.label}</span>
                      {loading ? (
                        <Skeleton variant="text" height={12} width={120} />
                      ) : (
                        <small>{kpi.delta}</small>
                      )}
                    </div>
                  </MotionItem>
                ))}
              </MotionList>
            </article>

            <article className="smd-card smd-card--span-4">
              <header className="smd-card__head smd-card__head--split">
                <h2>Channels</h2>
                <div className="smd-legend">
                  <span>
                    <i style={{ background: chartColors.teal }} /> Delivery
                  </span>
                  <span>
                    <i style={{ background: chartColors.indigo }} /> Pickup
                  </span>
                </div>
              </header>
              <div className="smd-chart smd-chart--compact">
                {loading ? (
                  <Skeleton variant="rect" height={180} width="100%" />
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={channelLevels} barGap={4}>
                      <CartesianGrid stroke={chartColors.border} vertical={false} strokeDasharray="4 4" />
                      <XAxis dataKey="label" tick={{ fill: chartColors.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="delivery" name="Delivery" fill={chartColors.teal} radius={[6, 6, 0, 0]} maxBarSize={18} />
                      <Bar dataKey="pickup" name="Pickup" fill={chartColors.indigo} radius={[6, 6, 0, 0]} maxBarSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </article>

            <article className="smd-card smd-card--span-7">
              <header className="smd-card__head smd-card__head--split">
                <h2>Top products</h2>
                <div className="smd-card__head-tools">
                  <label className="smd-inline-search">
                    <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                    <input
                      type="search"
                      value={productQuery}
                      onChange={(e) => setProductQuery(e.target.value)}
                      placeholder="Search products…"
                      aria-label="Search products"
                    />
                  </label>
                  <Link href="/inventory" className="smd-card__link">
                    View catalog
                  </Link>
                </div>
              </header>
              <div className="smd-table-wrap">
                <table className="smd-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th>Popularity</th>
                      <th>Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={4}>
                          <Skeleton variant="rect" height={120} width="100%" />
                        </td>
                      </tr>
                    ) : filteredProducts.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="smd-table__empty">
                          No products match your search yet.
                        </td>
                      </tr>
                    ) : (
                      filteredProducts.map((product, idx) => (
                        <tr key={product.id}>
                          <td>{String(idx + 1).padStart(2, "0")}</td>
                          <td>{product.name}</td>
                          <td>
                            <div className="smd-popularity">
                              <div className="smd-popularity__track">
                                <div
                                  className={`smd-popularity__fill smd-popularity__fill--${product.accent}`}
                                  style={{ width: `${product.popularity}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={`smd-pill smd-pill--${product.accent}`}>
                              {product.salesPct}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="smd-card smd-card--span-5">
              <header className="smd-card__head smd-card__head--split">
                <h2>Customer fulfilment</h2>
                <div className="smd-legend">
                  <span>
                    <i style={{ background: chartColors.indigo }} /> Prior
                  </span>
                  <span>
                    <i style={{ background: chartColors.teal }} /> Current
                  </span>
                </div>
              </header>
              <div className="smd-chart">
                {loading ? (
                  <Skeleton variant="rect" height={200} width="100%" />
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={fulfilmentTrend}>
                      <defs>
                        <linearGradient id="smdFillCurrent" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={chartColors.teal} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={chartColors.teal} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="smdFillPrior" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={chartColors.indigo} stopOpacity={0.2} />
                          <stop offset="100%" stopColor={chartColors.indigo} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={chartColors.border} vertical={false} strokeDasharray="4 4" />
                      <XAxis dataKey="label" tick={{ fill: chartColors.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip
                        content={
                          <ChartTooltip
                            formatter={(value) => formatMoney(value, currency)}
                          />
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="lastPeriod"
                        name="Prior period"
                        stroke={chartColors.indigo}
                        fill="url(#smdFillPrior)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="thisPeriod"
                        name="Current period"
                        stroke={chartColors.teal}
                        fill="url(#smdFillCurrent)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="smd-footnotes">
                <div>
                  <span>Current</span>
                  <strong>{formatMoney(fulfilmentTotals.thisTotal, currency)}</strong>
                </div>
                <div>
                  <span>Prior</span>
                  <strong>{formatMoney(fulfilmentTotals.lastTotal, currency)}</strong>
                </div>
              </div>
            </article>

            <article className="smd-card smd-card--span-8">
              <header className="smd-card__head smd-card__head--split">
                <h2>Order insights</h2>
                <div className="smd-legend">
                  <span>
                    <i style={{ background: chartColors.amber }} /> Monthly orders
                  </span>
                  {peakMonth ? (
                    <span className="smd-legend__peak">
                      Peak: {peakMonth.label} ({peakMonth.orders})
                    </span>
                  ) : null}
                </div>
              </header>
              <div className="smd-chart smd-chart--tall">
                {loading ? (
                  <Skeleton variant="rect" height={240} width="100%" />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={monthlyTrend}>
                      <defs>
                        <linearGradient id="smdLineGlow" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={chartColors.primary} stopOpacity={0.25} />
                          <stop offset="100%" stopColor={chartColors.primary} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={chartColors.border} vertical={false} strokeDasharray="4 4" />
                      <XAxis dataKey="label" tick={{ fill: chartColors.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip content={<ChartTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="orders"
                        stroke="none"
                        fill="url(#smdLineGlow)"
                      />
                      <Line
                        type="monotone"
                        dataKey="orders"
                        name="Orders"
                        stroke={chartColors.primary}
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 5, fill: chartColors.amber, stroke: chartColors.surface, strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </article>

            <article className="smd-card smd-card--span-4">
              <header className="smd-card__head">
                <h2>Collections</h2>
              </header>
              <div className="smd-earnings">
                <div className="smd-earnings__copy">
                  <span>Outstanding</span>
                  {loading ? (
                    <Skeleton variant="text" height={28} width={120} />
                  ) : (
                    <strong>{formatMoney(earnings.pending, currency)}</strong>
                  )}
                  <p>{earnings.profitHint}</p>
                </div>
                <div className="smd-gauge">
                  {loading ? (
                    <Skeleton variant="circle" height={140} width={140} />
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={140}>
                        <PieChart>
                          <Pie
                            data={gaugeData}
                            dataKey="value"
                            startAngle={180}
                            endAngle={0}
                            innerRadius="72%"
                            outerRadius="100%"
                            stroke="none"
                            paddingAngle={0}
                          >
                            <Cell fill={chartColors.teal} />
                            <Cell fill={chartColors.border} />
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="smd-gauge__label">
                        <strong>{earnings.collectionRate}%</strong>
                        <span>collected</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </article>
          </div>
        </div>
      )}
    </section>
  );
}
