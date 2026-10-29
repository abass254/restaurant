"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { MotionFade } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import {
  formatMoney,
  PAYMENT_LABELS,
  SOURCE_ICONS,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/lib/orders";
import type {
  AdminMerchantSummary,
  AdminMerchantsResponse,
  AdminOrderSummary,
  AdminOrdersResponse,
  AdminOrdersStats,
  OrderPaymentMethod,
  OrderSource,
  OrderStatus,
} from "@/lib/types";

const SKELETON_ROWS = 10;

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

const sourceOptions: Array<{ value: "all" | OrderSource; label: string }> = [
  { value: "all", label: "All channels" },
  { value: "walkin", label: "Walk-in (POS)" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "phone_call", label: "Phone call" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "rider_request", label: "Rider request" },
];

const dateRangePresets = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 Days" },
  { value: "this_month", label: "This Month" },
  { value: "30d", label: "Last 30 Days" },
  { value: "custom", label: "Custom Range" },
];

function statusPillClass(status: OrderStatus): string {
  if (status === "delivered" || status === "picked_up" || status === "payment_received") {
    return "admin-pill admin-pill--success";
  }
  if (status === "cancelled" || status === "refunded") {
    return "admin-pill admin-pill--muted";
  }
  if (
    status === "awaiting_payment" ||
    status === "awaiting_delivery_confirmation" ||
    status === "awaiting_pickup_confirmation"
  ) {
    return "admin-pill admin-pill--warning";
  }
  return "admin-pill admin-pill--neutral";
}

function channelPillClass(source: OrderSource): string {
  switch (source) {
    case "walkin":
      return "admin-channel-pill admin-channel-pill--walkin";
    case "instagram":
      return "admin-channel-pill admin-channel-pill--instagram";
    case "whatsapp":
      return "admin-channel-pill admin-channel-pill--whatsapp";
    case "phone_call":
      return "admin-channel-pill admin-channel-pill--phone_call";
    default:
      return "admin-channel-pill";
  }
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState<AdminOrdersStats | null>(null);

  const [merchants, setMerchants] = useState<AdminMerchantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const [merchantFilter, setMerchantFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | OrderSource>("all");
  const [dateRange, setDateRange] = useState<string>("all");
  const [customDateFrom, setCustomDateFrom] = useState<string>("");
  const [customDateTo, setCustomDateTo] = useState<string>("");
  const [appliedDateFrom, setAppliedDateFrom] = useState<string>("");
  const [appliedDateTo, setAppliedDateTo] = useState<string>("");
  const [liveTracking, setLiveTracking] = useState<boolean>(true);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Load merchants list for the merchant filter dropdown
  useEffect(() => {
    apiFetch<AdminMerchantsResponse>(apiRoutes.adminMerchants)
      .then((res) => setMerchants(res.data))
      .catch(() => {});
  }, []);

  const loadOrders = useCallback(
    async (isBackground = false) => {
      if (!isBackground) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("per_page", String(perPage));

        if (debouncedSearch) params.set("q", debouncedSearch);
        if (statusFilter !== "all") params.set("status_filter", statusFilter);
        if (merchantFilter !== "all") params.set("account_id", merchantFilter);
        if (sourceFilter !== "all") params.set("source", sourceFilter);

        params.set("date_range", dateRange);
        if (dateRange === "custom") {
          if (appliedDateFrom) params.set("date_from", appliedDateFrom);
          if (appliedDateTo) params.set("date_to", appliedDateTo);
        }

        const url = `${apiRoutes.adminOrders}?${params.toString()}`;
        const res = await apiFetch<AdminOrdersResponse>(url);

        setOrders(res.data);
        setTotal(res.total);
        setTotalPages(res.total_pages || Math.max(1, Math.ceil(res.total / perPage)));
        if (res.stats) {
          setStats(res.stats);
        }
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof ApiError ? err.message : "Could not load platform orders.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      page,
      perPage,
      debouncedSearch,
      statusFilter,
      merchantFilter,
      sourceFilter,
      dateRange,
      appliedDateFrom,
      appliedDateTo,
    ],
  );

  // Trigger load whenever query or filters change
  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  // Live polling: reload silently in the background every 25 seconds
  useEffect(() => {
    if (!liveTracking) return;
    const interval = setInterval(() => {
      void loadOrders(true);
    }, 25000);
    return () => clearInterval(interval);
  }, [liveTracking, loadOrders]);

  function handleSelectDateRange(preset: string) {
    setDateRange(preset);
    setPage(1);
    if (preset !== "custom") {
      setCustomDateFrom("");
      setCustomDateTo("");
      setAppliedDateFrom("");
      setAppliedDateTo("");
    }
  }

  function handleApplyCustomDates() {
    setAppliedDateFrom(customDateFrom);
    setAppliedDateTo(customDateTo);
    setPage(1);
  }

  function resetFilters() {
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter("all");
    setMerchantFilter("all");
    setSourceFilter("all");
    setDateRange("all");
    setCustomDateFrom("");
    setCustomDateTo("");
    setAppliedDateFrom("");
    setAppliedDateTo("");
    setPage(1);
  }

  const startRecord = total > 0 ? (page - 1) * perPage + 1 : 0;
  const endRecord = Math.min(page * perPage, total);

  // Dynamic titles and subtitles based on dateRange
  const periodLabel = stats?.period_label || (dateRange === "today" ? "Today" : dateRange === "7d" ? "Last 7 days" : "All time");
  const isPeriodFiltered = dateRange !== "all";

  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <div>
          <h1 className="admin-page__title">Orders</h1>
          <p className="admin-page__lead">
            Platform-wide order tracking across all merchants. Real-time audit of sales, fulfillment,
            and statuses per date range.
          </p>
        </div>
        <div className="admin-page__header-meta" style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
          <button
            type="button"
            className={`admin-orders-live-toggle ${liveTracking ? "is-active" : ""}`}
            onClick={() => setLiveTracking((prev) => !prev)}
            title={liveTracking ? "Live auto-refresh enabled (25s)" : "Click to enable live auto-refresh"}
          >
            {liveTracking ? <span className="admin-live-dot" aria-hidden="true" /> : <i className="fas fa-pause" aria-hidden="true" />}
            <span>{liveTracking ? "Live tracking" : "Paused"}</span>
          </button>

          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => void loadOrders(false)}
            disabled={loading || refreshing}
            title="Refresh orders now"
          >
            <i className={`fas fa-arrows-rotate ${refreshing ? "fa-spin" : ""}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>

          <span className="admin-chip">
            <i className="fas fa-receipt" aria-hidden="true" />
            {loading && total === 0 ? "…" : `${total.toLocaleString()} total`}
          </span>
        </div>
      </header>

      {/* Dynamic Date Range Bar */}
      <nav className="admin-date-bar" aria-label="Order date range selector">
        <div className="admin-date-bar__presets">
          <span className="admin-date-bar__label">
            <i className="fas fa-calendar" aria-hidden="true" /> Date:
          </span>
          {dateRangePresets.map((preset) => (
            <button
              key={preset.value}
              type="button"
              className={`admin-date-pill ${dateRange === preset.value ? "is-active" : ""}`}
              onClick={() => handleSelectDateRange(preset.value)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {dateRange === "custom" && (
          <div className="admin-date-bar__custom">
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span>From:</span>
              <input
                type="date"
                className="admin-date-input"
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span>To:</span>
              <input
                type="date"
                className="admin-date-input"
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              style={{ height: 32, padding: "0 0.75rem", fontSize: "0.8rem" }}
              onClick={handleApplyCustomDates}
              disabled={!customDateFrom && !customDateTo}
            >
              Apply
            </button>
          </div>
        )}
      </nav>

      {/* Dynamic KPI Stat Cards */}
      <section className="admin-stat-grid" aria-label="Platform order summary metrics">
        <article className="admin-stat admin-stat--indigo">
          <span className="admin-stat__icon" aria-hidden="true">
            <i className="fas fa-receipt" />
          </span>
          <div className="admin-stat__body">
            <span className="admin-stat__label">
              {isPeriodFiltered ? `${periodLabel} Orders` : "Total Orders"}
            </span>
            {loading && !stats ? (
              <Skeleton variant="text" width={100} height={28} />
            ) : (
              <>
                <strong className="admin-stat__value">
                  {(stats?.total_orders ?? total).toLocaleString()}
                </strong>
                <span className="admin-stat__sub">
                  {merchantFilter !== "all"
                    ? "Selected merchant"
                    : isPeriodFiltered
                    ? `Period: ${periodLabel}`
                    : "All platform merchants"}
                </span>
              </>
            )}
          </div>
        </article>

        <article className="admin-stat admin-stat--emerald">
          <span className="admin-stat__icon" aria-hidden="true">
            <i className="fas fa-coins" />
          </span>
          <div className="admin-stat__body">
            <span className="admin-stat__label">
              {isPeriodFiltered ? `${periodLabel} Volume` : "Gross Volume"}
            </span>
            {loading && !stats ? (
              <Skeleton variant="text" width={130} height={28} />
            ) : (
              <>
                <strong className="admin-stat__value">
                  {formatMoney(stats?.total_revenue ?? 0)}
                </strong>
                <span className="admin-stat__sub">
                  {isPeriodFiltered ? `Paid & completed in ${periodLabel}` : "Paid & confirmed orders"}
                </span>
              </>
            )}
          </div>
        </article>

        <article className="admin-stat admin-stat--amber">
          <span className="admin-stat__icon" aria-hidden="true">
            <i className="fas fa-chart-line" />
          </span>
          <div className="admin-stat__body">
            <span className="admin-stat__label">
              {isPeriodFiltered ? "Avg Order Value (AOV)" : "Today’s Orders"}
            </span>
            {loading && !stats ? (
              <Skeleton variant="text" width={110} height={28} />
            ) : isPeriodFiltered ? (
              <>
                <strong className="admin-stat__value">
                  {formatMoney(stats?.average_order_value ?? 0)}
                </strong>
                <span className="admin-stat__sub">
                  Avg revenue per paid order in {periodLabel}
                </span>
              </>
            ) : (
              <>
                <strong className="admin-stat__value">
                  {(stats?.today_orders ?? 0).toLocaleString()}
                </strong>
                <span className="admin-stat__sub">
                  {formatMoney(stats?.today_revenue ?? 0)} today
                </span>
              </>
            )}
          </div>
        </article>

        <article className="admin-stat admin-stat--rose">
          <span className="admin-stat__icon" aria-hidden="true">
            <i className="fas fa-clock" />
          </span>
          <div className="admin-stat__body">
            <span className="admin-stat__label">Active In-Progress</span>
            {loading && !stats ? (
              <Skeleton variant="text" width={80} height={28} />
            ) : (
              <>
                <strong className="admin-stat__value">
                  {(stats?.active_orders ?? 0).toLocaleString()}
                </strong>
                <span className="admin-stat__sub">
                  {isPeriodFiltered ? `Active in ${periodLabel}` : "Preparing & dispatching"}
                </span>
              </>
            )}
          </div>
        </article>
      </section>

      {/* Dynamic Status Quick Filter Chips (reflecting active date range counts) */}
      {stats?.status_counts ? (
        <div className="admin-orders-chips" role="tablist" aria-label="Status quick filters">
          <button
            type="button"
            className={`admin-orders-chip ${statusFilter === "all" ? "is-active" : ""}`}
            onClick={() => {
              setStatusFilter("all");
              setPage(1);
            }}
          >
            <span>All</span>
            <span className="admin-orders-chip__count">
              {(stats.total_orders ?? total).toLocaleString()}
            </span>
          </button>
          <button
            type="button"
            className={`admin-orders-chip ${statusFilter === "payment_received" ? "is-active" : ""}`}
            onClick={() => {
              setStatusFilter("payment_received");
              setPage(1);
            }}
          >
            <span>Payment Received</span>
            <span className="admin-orders-chip__count">
              {(stats.status_counts.payment_received || 0).toLocaleString()}
            </span>
          </button>
          <button
            type="button"
            className={`admin-orders-chip ${statusFilter === "picked_up" ? "is-active" : ""}`}
            onClick={() => {
              setStatusFilter("picked_up");
              setPage(1);
            }}
          >
            <span>Picked Up</span>
            <span className="admin-orders-chip__count">
              {(stats.status_counts.picked_up || 0).toLocaleString()}
            </span>
          </button>
          <button
            type="button"
            className={`admin-orders-chip ${statusFilter === "being_prepared" ? "is-active" : ""}`}
            onClick={() => {
              setStatusFilter("being_prepared");
              setPage(1);
            }}
          >
            <span>Preparing</span>
            <span className="admin-orders-chip__count">
              {(stats.status_counts.being_prepared || 0).toLocaleString()}
            </span>
          </button>
          <button
            type="button"
            className={`admin-orders-chip ${statusFilter === "ready" ? "is-active" : ""}`}
            onClick={() => {
              setStatusFilter("ready");
              setPage(1);
            }}
          >
            <span>Ready</span>
            <span className="admin-orders-chip__count">
              {(stats.status_counts.ready || 0).toLocaleString()}
            </span>
          </button>
          <button
            type="button"
            className={`admin-orders-chip ${statusFilter === "out_for_delivery" ? "is-active" : ""}`}
            onClick={() => {
              setStatusFilter("out_for_delivery");
              setPage(1);
            }}
          >
            <span>Out for Delivery</span>
            <span className="admin-orders-chip__count">
              {(stats.status_counts.out_for_delivery || 0).toLocaleString()}
            </span>
          </button>
          <button
            type="button"
            className={`admin-orders-chip ${statusFilter === "awaiting_payment" ? "is-active" : ""}`}
            onClick={() => {
              setStatusFilter("awaiting_payment");
              setPage(1);
            }}
          >
            <span>Awaiting Payment</span>
            <span className="admin-orders-chip__count">
              {(stats.status_counts.awaiting_payment || 0).toLocaleString()}
            </span>
          </button>
          <button
            type="button"
            className={`admin-orders-chip ${statusFilter === "delivered" ? "is-active" : ""}`}
            onClick={() => {
              setStatusFilter("delivered");
              setPage(1);
            }}
          >
            <span>Delivered</span>
            <span className="admin-orders-chip__count">
              {(stats.status_counts.delivered || 0).toLocaleString()}
            </span>
          </button>
          <button
            type="button"
            className={`admin-orders-chip ${statusFilter === "cancelled" ? "is-active" : ""}`}
            onClick={() => {
              setStatusFilter("cancelled");
              setPage(1);
            }}
          >
            <span>Cancelled</span>
            <span className="admin-orders-chip__count">
              {(stats.status_counts.cancelled || 0).toLocaleString()}
            </span>
          </button>
          <button
            type="button"
            className={`admin-orders-chip ${statusFilter === "refunded" ? "is-active" : ""}`}
            onClick={() => {
              setStatusFilter("refunded");
              setPage(1);
            }}
          >
            <span>Refunded</span>
            <span className="admin-orders-chip__count">
              {(stats.status_counts.refunded || 0).toLocaleString()}
            </span>
          </button>
        </div>
      ) : null}

      {/* Filter Toolbar */}
      <div className="admin-toolbar" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <label className="admin-search" style={{ flex: "1 1 240px", minWidth: 200 }}>
          <i className="fas fa-search" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order #, customer, phone, email, or merchant…"
            aria-label="Search orders"
          />
        </label>

        {/* Merchant Filter */}
        <label style={{ minWidth: 170 }}>
          <span className="sr-only">Merchant</span>
          <select
            className="admin-input"
            value={merchantFilter}
            onChange={(e) => {
              setMerchantFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter orders by merchant"
          >
            <option value="all">All merchants</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.business_name}
              </option>
            ))}
          </select>
        </label>

        {/* Status Filter */}
        <label style={{ minWidth: 150 }}>
          <span className="sr-only">Status</span>
          <select
            className="admin-input"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as "all" | OrderStatus);
              setPage(1);
            }}
            aria-label="Filter orders by status"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {/* Source / Channel Filter */}
        <label style={{ minWidth: 140 }}>
          <span className="sr-only">Channel</span>
          <select
            className="admin-input"
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value as "all" | OrderSource);
              setPage(1);
            }}
            aria-label="Filter orders by channel"
          >
            {sourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {(search ||
          statusFilter !== "all" ||
          merchantFilter !== "all" ||
          sourceFilter !== "all" ||
          dateRange !== "all") && (
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={resetFilters}
            title="Clear all filters"
          >
            <i className="fas fa-xmark" aria-hidden="true" />
            <span>Reset filters</span>
          </button>
        )}
      </div>

      {error ? (
        <MotionFade>
          <p className="admin-error">{error}</p>
        </MotionFade>
      ) : null}

      {/* Orders Table */}
      {loading && orders.length === 0 ? (
        <div className="admin-table-wrap" aria-busy="true">
          <table className="admin-table admin-table--skeleton">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Merchant</th>
                <th>Customer</th>
                <th>Channel</th>
                <th>Payment</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Items</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th>Placed</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={i}>
                  <td><Skeleton variant="text" width={100} height={14} /></td>
                  <td><Skeleton variant="text" width={140} height={14} /></td>
                  <td><Skeleton variant="text" width={120} height={14} /></td>
                  <td><Skeleton variant="text" width={80} height={20} /></td>
                  <td><Skeleton variant="text" width={70} height={20} /></td>
                  <td><Skeleton variant="text" width={110} height={20} /></td>
                  <td><Skeleton variant="text" width={50} height={14} /></td>
                  <td><Skeleton variant="text" width={90} height={14} /></td>
                  <td><Skeleton variant="text" width={120} height={14} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : orders.length === 0 ? (
        <MotionFade>
          <div className="admin-empty">
            <i className="fas fa-receipt" aria-hidden="true" />
            <h3>No orders found</h3>
            <p>
              {total === 0 && !debouncedSearch && statusFilter === "all" && dateRange === "all"
                ? "No orders have been recorded on the platform yet."
                : `No orders match the selected filters for ${periodLabel}.`}
            </p>
            {(debouncedSearch ||
              statusFilter !== "all" ||
              merchantFilter !== "all" ||
              sourceFilter !== "all" ||
              dateRange !== "all") && (
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={resetFilters}
                style={{ marginTop: "1rem" }}
              >
                Reset all filters
              </button>
            )}
          </div>
        </MotionFade>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Merchant</th>
                <th>Customer</th>
                <th>Channel</th>
                <th>Payment</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Items</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th>Placed</th>
              </tr>
            </thead>
            <motion.tbody variants={staggerContainer} initial="hidden" animate="visible">
              {orders.map((order) => (
                <motion.tr key={order.id} variants={staggerItem}>
                  <td>
                    <Link href={`/admin/orders/${order.id}`} className="admin-table__primary-link">
                      <strong>{order.order_number}</strong>
                    </Link>
                  </td>
                  <td>
                    <span title={order.merchant_name || undefined}>
                      {order.merchant_name || "Unknown merchant"}
                    </span>
                  </td>
                  <td>
                    {order.customer_name ? (
                      <div>
                        <div>{order.customer_name}</div>
                        {order.customer_phone ? (
                          <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
                            {order.customer_phone}
                          </div>
                        ) : null}
                      </div>
                    ) : order.customer_phone ? (
                      order.customer_phone
                    ) : (
                      <span className="admin-muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className={channelPillClass(order.source)}>
                      <i className={SOURCE_ICONS[order.source] || "fas fa-bag-shopping"} aria-hidden="true" />
                      <span>{SOURCE_LABELS[order.source] || order.source}</span>
                    </span>
                  </td>
                  <td>
                    <span className="admin-pill admin-pill--neutral" style={{ textTransform: "uppercase", fontSize: "0.75rem" }}>
                      {order.payment_method ? PAYMENT_LABELS[order.payment_method as OrderPaymentMethod] || order.payment_method : "—"}
                    </span>
                  </td>
                  <td>
                    <span className={statusPillClass(order.status)}>
                      {STATUS_LABELS[order.status] || order.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    <strong>{order.items_count}</strong>
                    {order.lines_count && order.lines_count > 1 ? (
                      <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginLeft: "0.25rem" }}>
                        ({order.lines_count} lines)
                      </span>
                    ) : null}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    <strong>{formatMoney(order.total || 0, order.currency || "KES")}</strong>
                  </td>
                  <td style={{ whiteSpace: "nowrap", fontSize: "0.82rem" }}>
                    {formatNairobiDateTime(order.placed_at || order.created_at || "") || "—"}
                  </td>
                </motion.tr>
              ))}
            </motion.tbody>
          </table>
        </div>
      )}

      {/* Pagination Bar */}
      {total > 0 ? (
        <div className="admin-pagination">
          <div className="admin-pagination__info">
            <span>
              Showing <strong>{startRecord.toLocaleString()}</strong>–<strong>{endRecord.toLocaleString()}</strong> of{" "}
              <strong>{total.toLocaleString()}</strong> orders ({periodLabel})
            </span>

            <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", marginLeft: "0.5rem" }}>
              <span className="admin-muted">Per page:</span>
              <select
                className="admin-input"
                style={{ height: 32, padding: "0 0.5rem", fontSize: "0.82rem" }}
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>

          <div className="admin-pagination__controls">
            <button
              type="button"
              className="admin-pagination__btn"
              onClick={() => setPage(1)}
              disabled={page <= 1 || loading}
              title="First page"
            >
              <i className="fas fa-angles-left" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="admin-pagination__btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              title="Previous page"
            >
              <i className="fas fa-angle-left" aria-hidden="true" />
              <span style={{ marginLeft: "0.25rem" }}>Prev</span>
            </button>

            <span style={{ margin: "0 0.5rem", fontWeight: 600 }}>
              Page {page.toLocaleString()} of {totalPages.toLocaleString()}
            </span>

            <button
              type="button"
              className="admin-pagination__btn"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              title="Next page"
            >
              <span style={{ marginRight: "0.25rem" }}>Next</span>
              <i className="fas fa-angle-right" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="admin-pagination__btn"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages || loading}
              title="Last page"
            >
              <i className="fas fa-angles-right" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
