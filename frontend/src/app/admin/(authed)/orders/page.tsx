"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { MotionFade } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { formatNairobiDate } from "@/lib/nairobi-time";
import type { AdminOrderSummary, AdminOrdersResponse, OrderStatus } from "@/lib/types";

const SKELETON_ROWS = 8;

const statusOptions: Array<{ value: "all" | OrderStatus; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "placed", label: "Created" },
  { value: "awaiting_payment", label: "Payment requested" },
  { value: "payment_received", label: "Payment received" },
  { value: "being_prepared", label: "Preparing" },
  { value: "ready", label: "Prepared" },
  { value: "out_for_delivery", label: "Out for delivery" },
  { value: "awaiting_delivery_confirmation", label: "Confirming delivery" },
  { value: "awaiting_pickup_confirmation", label: "Confirming pickup" },
  { value: "delivered", label: "Delivered" },
  { value: "picked_up", label: "Picked up" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" },
];

function formatDate(value: string | null): string {
  if (!value) return "—";
  return formatNairobiDate(value) || value;
}

function statusPillClass(status: OrderStatus): string {
  if (status === "delivered" || status === "picked_up") return "admin-pill admin-pill--success";
  if (status === "cancelled" || status === "refunded") return "admin-pill admin-pill--muted";
  return "admin-pill admin-pill--neutral";
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<AdminOrdersResponse>(apiRoutes.adminOrders)
      .then((res) => {
        if (cancelled) return;
        setOrders(res.data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load platform orders.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== "all" && order.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        order.order_number,
        order.merchant_name ?? "",
        order.customer_name ?? "",
        order.customer_phone ?? "",
        order.source,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [orders, query, statusFilter]);

  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <div>
          <h1 className="admin-page__title">Orders</h1>
          <p className="admin-page__lead">
            Platform-wide order tracking across all merchants. Use this view to audit processed
            sales and statuses.
          </p>
        </div>
        <div className="admin-page__header-meta">
          <span className="admin-chip">
            <i className="fas fa-receipt" aria-hidden="true" />
            {loading ? "…" : `${orders.length} total`}
          </span>
        </div>
      </header>

      <div className="admin-toolbar">
        <label className="admin-search">
          <i className="fas fa-search" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by order #, merchant, customer, phone, or source"
            aria-label="Search orders"
          />
        </label>
        <label style={{ minWidth: 220 }}>
          <span className="sr-only">Status</span>
          <select
            className="admin-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | OrderStatus)}
            aria-label="Filter orders by status"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <MotionFade>
          <p className="admin-error">{error}</p>
        </MotionFade>
      ) : null}

      {loading ? (
        <div className="admin-table-wrap" aria-busy="true">
          <table className="admin-table admin-table--skeleton">
            <thead>
              <tr>
                <th>Order</th>
                <th>Merchant</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Total</th>
                <th>Items</th>
                <th>Placed</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={i}>
                  <td><Skeleton variant="text" width={90} height={14} /></td>
                  <td><Skeleton variant="text" width={140} height={14} /></td>
                  <td><Skeleton variant="text" width={130} height={14} /></td>
                  <td><Skeleton variant="text" width={110} height={20} /></td>
                  <td><Skeleton variant="text" width={80} height={14} /></td>
                  <td><Skeleton variant="text" width={36} height={14} /></td>
                  <td><Skeleton variant="text" width={100} height={14} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : filtered.length === 0 ? (
        <MotionFade>
          <div className="admin-empty">
            <i className="fas fa-receipt" aria-hidden="true" />
            <h3>No orders found</h3>
            <p>{orders.length === 0 ? "No orders have been created yet." : "Try changing filters."}</p>
          </div>
        </MotionFade>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Merchant</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Total</th>
                <th>Items</th>
                <th>Placed</th>
              </tr>
            </thead>
            <motion.tbody variants={staggerContainer} initial="hidden" animate="visible">
              {filtered.map((order) => (
                <motion.tr key={order.id} variants={staggerItem}>
                  <td>
                    <Link href={`/admin/orders/${order.id}`} className="admin-table__primary-link">
                      <strong>{order.order_number}</strong>
                    </Link>
                  </td>
                  <td>{order.merchant_name || "Unknown merchant"}</td>
                  <td>{order.customer_name || order.customer_phone || "—"}</td>
                  <td>
                    <span className={statusPillClass(order.status)}>
                      {order.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td>{`${order.currency} ${Number(order.total || 0).toFixed(2)}`}</td>
                  <td>{order.items_count}</td>
                  <td>{formatDate(order.placed_at || order.created_at)}</td>
                </motion.tr>
              ))}
            </motion.tbody>
          </table>
        </div>
      )}
    </section>
  );
}
