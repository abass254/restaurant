"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { extractErrorMessage } from "@/lib/alerts";
import { Skeleton } from "@/components/app/Skeleton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
  ALL_FULFILLMENT_TYPES,
  ALL_SOURCES,
  ALL_STATUSES,
  FULFILLMENT_ICONS,
  FULFILLMENT_LABELS,
  SOURCE_ICONS,
  SOURCE_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
  formatMoney,
  isOrderClosed,
} from "@/lib/orders";
import { OrdersSubNav } from "@/components/orders/OrdersSubNav";
import type {
  Order,
  OrderFulfillmentType,
  OrdersListResponse,
  OrderSource,
  OrderStatus,
} from "@/lib/types";
import { nairobiRelativeTimeFormatter, parseIso } from "@/lib/nairobi-time";

const RELATIVE_FORMATTER = nairobiRelativeTimeFormatter();

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const date = parseIso(iso);
  if (!date) return "—";
  const diffMs = date.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return RELATIVE_FORMATTER.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return RELATIVE_FORMATTER.format(diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return RELATIVE_FORMATTER.format(diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  return RELATIVE_FORMATTER.format(diffDay, "day");
}

export default function OrdersPage() {
  const reduce = useReducedMotion();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<OrderSource | "all">("all");
  const [fulfillmentFilter, setFulfillmentFilter] =
    useState<OrderFulfillmentType | "all">("all");
  const [search, setSearch] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (fulfillmentFilter !== "all")
        params.set("fulfillment_type", fulfillmentFilter);
      if (search.trim()) params.set("q", search.trim());
      params.set("per_page", "100");
      const url = `${apiRoutes.orders}?${params.toString()}`;
      const data = await apiFetch<OrdersListResponse>(url);
      setOrders(data.data);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to load orders."));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter, fulfillmentFilter, search]);

  // Debounce the text search; instant on dropdowns.
  useEffect(() => {
    const t = window.setTimeout(() => void reload(), search ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [reload, search]);

  const tableOrders = useMemo(() => {
    return [...orders].sort((a, b) => {
      const aClosed = isOrderClosed(a.status);
      const bClosed = isOrderClosed(b.status);
      if (aClosed !== bClosed) return aClosed ? 1 : -1;
      const aTime = parseIso(a.created_at)?.getTime() ?? 0;
      const bTime = parseIso(b.created_at)?.getTime() ?? 0;
      return bTime - aTime;
    });
  }, [orders]);

  return (
    <section className="app-panel inventory-panel">
      <header className="inventory-header">
        <div>
          <h1 className="app-title">Orders</h1>
          <p className="app-lead">
            Everything placed through the POS and your social channels.
          </p>
        </div>
        <Link href="/pos" className="btn btn-primary btn-sm">
          <i className="fa-solid fa-cash-register" aria-hidden="true" />
          Open POS
        </Link>
      </header>
      <div className="orders-page-nav">
        <OrdersSubNav />
      </div>

      <div className="inventory-toolbar">
        <label className="inventory-toolbar__search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by order #, customer name, phone, or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <div className="orders-filters">
          <label className="orders-filter">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as OrderStatus | "all")
              }
            >
              <option value="all">All statuses</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="orders-filter">
            <span>Source</span>
            <select
              value={sourceFilter}
              onChange={(e) =>
                setSourceFilter(e.target.value as OrderSource | "all")
              }
            >
              <option value="all">All sources</option>
              {ALL_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="orders-filter">
            <span>Type</span>
            <select
              value={fulfillmentFilter}
              onChange={(e) =>
                setFulfillmentFilter(
                  e.target.value as OrderFulfillmentType | "all",
                )
              }
            >
              <option value="all">Pickup &amp; delivery</option>
              {ALL_FULFILLMENT_TYPES.map((f) => (
                <option key={f} value={f}>
                  {FULFILLMENT_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? <p className="app-error">{error}</p> : null}

      {loading ? (
        <OrdersSkeleton />
      ) : orders.length === 0 ? (
        <EmptyOrders />
      ) : (
        <OrdersTable orders={tableOrders} reduce={!!reduce} />
      )}
    </section>
  );
}

function OrdersTable({
  orders,
  reduce,
}: {
  orders: Order[];
  reduce: boolean;
}) {
  return (
    <div className="inventory-table-wrap">
      <table className="inventory-table orders-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Source</th>
            <th>Type</th>
            <th>Items</th>
            <th>Total</th>
            <th>Phase</th>
            <th>Status</th>
            <th>When</th>
          </tr>
        </thead>
        <motion.tbody
          variants={reduce ? undefined : staggerContainer}
          initial={reduce ? false : "hidden"}
          animate={reduce ? undefined : "visible"}
        >
          {orders.map((order) => {
            const closed = isOrderClosed(order.status);
            const tone = STATUS_TONES[order.status];
            return (
              <motion.tr
                key={order.id}
                variants={reduce ? undefined : staggerItem}
              >
                <td>
                  <Link href={`/orders/${order.id}`} className="orders-link">
                    <strong>{order.order_number}</strong>
                  </Link>
                </td>
                <td>
                  <div className="orders-customer">
                    <span>{order.customer_name ?? "—"}</span>
                    {order.customer_phone ? (
                      <span className="app-muted">{order.customer_phone}</span>
                    ) : null}
                  </div>
                </td>
                <td>
                  <span className="orders-meta-pill">
                    <i className={SOURCE_ICONS[order.source]} aria-hidden="true" />
                    {SOURCE_LABELS[order.source]}
                  </span>
                </td>
                <td>
                  <span className="orders-meta-pill">
                    <i
                      className={FULFILLMENT_ICONS[order.fulfillment_type]}
                      aria-hidden="true"
                    />
                    {FULFILLMENT_LABELS[order.fulfillment_type]}
                  </span>
                </td>
                <td>{order.items_count ?? order.items?.length ?? 0}</td>
                <td>
                  <strong>{formatMoney(order.total, order.currency)}</strong>
                </td>
                <td>
                  <span
                    className={`orders-status-pill orders-status-pill--${closed ? "muted" : "info"}`}
                  >
                    {closed ? "Closed" : "In progress"}
                  </span>
                </td>
                <td>
                  <span className={`orders-status-pill orders-status-pill--${tone}`}>
                    {STATUS_LABELS[order.status]}
                  </span>
                </td>
                <td className="app-muted">{relativeTime(order.created_at)}</td>
              </motion.tr>
            );
          })}
        </motion.tbody>
      </table>
    </div>
  );
}

function OrdersSkeleton() {
  const rows = Array.from({ length: 6 });
  return (
    <div className="inventory-table-wrap" aria-busy="true" aria-live="polite">
      <table className="inventory-table orders-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Source</th>
            <th>Type</th>
            <th>Items</th>
            <th>Total</th>
            <th>Phase</th>
            <th>Status</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((_, i) => (
            <tr key={i}>
              {Array.from({ length: 9 }).map((__, j) => (
                <td key={j}>
                  <Skeleton variant="text" width="70%" height={12} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyOrders() {
  return (
    <div className="inventory-empty">
      <i className="fa-solid fa-receipt" aria-hidden="true" />
      <h2>No orders yet</h2>
      <p>
        Place your first order from the Point of Sale to see it here. Orders
        from Instagram, WhatsApp, and other channels will also show up
        automatically.
      </p>
      <Link href="/pos" className="btn btn-primary btn-sm">
        <i className="fa-solid fa-cash-register" aria-hidden="true" />
        Open POS
      </Link>
    </div>
  );
}
