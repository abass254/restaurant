"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/app/Skeleton";
import { OrdersSubNav } from "@/components/orders/OrdersSubNav";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { formatMoney, isOrderClosed, SOURCE_LABELS, STATUS_LABELS } from "@/lib/orders";
import { parseIso } from "@/lib/nairobi-time";
import type { Order, OrdersListResponse, OrderSource, OrderStatus } from "@/lib/types";

const RANGE_OPTIONS = [7, 30, 90] as const;

function percentage(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

export function OrdersAnalyticsDashboard() {
  const [days, setDays] = useState<(typeof RANGE_OPTIONS)[number]>(30);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
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
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to load order analytics."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cutoff = useMemo(() => Date.now() - days * 24 * 60 * 60 * 1000, [days]);

  const filtered = useMemo(
    () =>
      orders.filter((order) => {
        const created = parseIso(order.created_at);
        if (!created) return false;
        return created.getTime() >= cutoff;
      }),
    [orders, cutoff],
  );

  const summary = useMemo(() => {
    let totalRevenue = 0;
    let open = 0;
    let closed = 0;
    let delivery = 0;
    let pickup = 0;

    for (const order of filtered) {
      totalRevenue += order.total ?? 0;
      if (isOrderClosed(order.status)) closed += 1;
      else open += 1;
      if (order.fulfillment_type === "delivery") delivery += 1;
      if (order.fulfillment_type === "pickup") pickup += 1;
    }

    return {
      totalOrders: filtered.length,
      totalRevenue,
      averageOrderValue: filtered.length ? totalRevenue / filtered.length : 0,
      open,
      closed,
      delivery,
      pickup,
    };
  }, [filtered]);

  const bySource = useMemo(() => {
    const map = new Map<OrderSource, number>();
    for (const order of filtered) map.set(order.source, (map.get(order.source) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const byStatus = useMemo(() => {
    const map = new Map<OrderStatus, number>();
    for (const order of filtered) map.set(order.status, (map.get(order.status) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const currency = filtered[0]?.currency ?? "KES";

  return (
    <section className="app-panel orders-analytics-page">
      <header className="inventory-header">
        <div>
          <h1 className="app-title">Order analytics</h1>
          <p className="app-lead">Track order volume, revenue, and channel performance.</p>
        </div>
        <div className="ticket-analytics-range" role="group" aria-label="Date range">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={`ticket-analytics-range__btn${days === option ? " is-active" : ""}`}
              onClick={() => setDays(option)}
            >
              {option}d
            </button>
          ))}
        </div>
      </header>

      <div className="orders-page-nav">
        <OrdersSubNav />
      </div>

      {error ? <p className="app-error">{error}</p> : null}

      <div className="orders-analytics-summary">
        <article className="orders-analytics-tile">
          <span>Orders</span>
          {loading ? <Skeleton variant="text" width="60%" height={24} /> : <strong>{summary.totalOrders}</strong>}
          <small>Last {days} days</small>
        </article>
        <article className="orders-analytics-tile">
          <span>Revenue</span>
          {loading ? (
            <Skeleton variant="text" width="75%" height={24} />
          ) : (
            <strong>{formatMoney(summary.totalRevenue, currency)}</strong>
          )}
          <small>From completed and active orders</small>
        </article>
        <article className="orders-analytics-tile">
          <span>Avg order value</span>
          {loading ? (
            <Skeleton variant="text" width="70%" height={24} />
          ) : (
            <strong>{formatMoney(summary.averageOrderValue, currency)}</strong>
          )}
          <small>Total revenue / total orders</small>
        </article>
        <article className="orders-analytics-tile">
          <span>Open vs closed</span>
          {loading ? (
            <Skeleton variant="text" width="70%" height={24} />
          ) : (
            <strong>
              {summary.open} / {summary.closed}
            </strong>
          )}
          <small>{percentage(summary.closed, summary.totalOrders)} closed</small>
        </article>
      </div>

      <div className="orders-analytics-grid">
        <article className="orders-analytics-card">
          <header>
            <h2>Top order sources</h2>
            <p>Where orders are coming from in this period.</p>
          </header>
          {loading ? (
            <Skeleton variant="rect" height={180} />
          ) : bySource.length === 0 ? (
            <p className="app-muted">No orders in this range yet.</p>
          ) : (
            <ul className="orders-analytics-list">
              {bySource.map(([source, count]) => (
                <li key={source}>
                  <span>{SOURCE_LABELS[source]}</span>
                  <strong>{count}</strong>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="orders-analytics-card">
          <header>
            <h2>Status breakdown</h2>
            <p>Current lifecycle stages for recent orders.</p>
          </header>
          {loading ? (
            <Skeleton variant="rect" height={180} />
          ) : byStatus.length === 0 ? (
            <p className="app-muted">No status data available.</p>
          ) : (
            <ul className="orders-analytics-list">
              {byStatus.map(([status, count]) => (
                <li key={status}>
                  <span>{STATUS_LABELS[status]}</span>
                  <strong>{count}</strong>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="orders-analytics-card">
          <header>
            <h2>Fulfillment mix</h2>
            <p>Pickup versus delivery demand split.</p>
          </header>
          {loading ? (
            <Skeleton variant="rect" height={120} />
          ) : (
            <div className="orders-analytics-pairs">
              <div>
                <span>Delivery</span>
                <strong>{summary.delivery}</strong>
              </div>
              <div>
                <span>Pickup</span>
                <strong>{summary.pickup}</strong>
              </div>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
