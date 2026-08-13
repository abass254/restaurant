"use client";

import Link from "next/link";
import { useMemo } from "react";
import { MotionItem, MotionList } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import type { InventoryItem, Order } from "@/lib/types";

type InventoryStats = {
  total: number;
  active: number;
  paused: number;
  lowStock: number;
  inStock: number;
  outOfStock: number;
};

type OrderStats = {
  total: number;
  paid: number;
  pending: number;
  failed: number;
  cancelled: number;
  revenue: number;
};

function emptyInventoryStats(): InventoryStats {
  return {
    total: 0,
    active: 0,
    paused: 0,
    lowStock: 0,
    inStock: 0,
    outOfStock: 0,
  };
}

function emptyOrderStats(): OrderStats {
  return {
    total: 0,
    paid: 0,
    pending: 0,
    failed: 0,
    cancelled: 0,
    revenue: 0,
  };
}

function computeInventoryStats(items: InventoryItem[]): InventoryStats {
  const stats = emptyInventoryStats();
  stats.total = items.length;
  for (const item of items) {
    if (item.is_active) stats.active += 1;
    else stats.paused += 1;

    if (item.is_low_stock) stats.lowStock += 1;

    const stock = item.stock_quantity;
    if (stock === null || stock === undefined) continue;
    if (stock <= 0) stats.outOfStock += 1;
    else stats.inStock += 1;
  }
  return stats;
}

function computeOrderStats(orders: Order[]): OrderStats {
  const stats = emptyOrderStats();
  stats.total = orders.length;
  for (const order of orders) {
    if (order.paid_at) {
      stats.paid += 1;
      stats.revenue += Number(order.total) || 0;
    } else if (order.status === "awaiting_payment" || order.status === "placed") {
      stats.pending += 1;
    } else if (order.status === "cancelled") {
      stats.cancelled += 1;
    } else if (order.status === "refunded") {
      stats.failed += 1;
    }
  }
  return stats;
}

function formatKes(value: number): string {
  return `KES ${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

type DashboardInsightsProps = {
  inventoryItems: InventoryItem[];
  orderItems: Order[];
  inventoryLoading: boolean;
  ordersLoading: boolean;
  inventoryError: string | null;
  ordersError: string | null;
  ordersBlocked: boolean;
};

export function DashboardInsights({
  inventoryItems,
  orderItems,
  inventoryLoading,
  ordersLoading,
  inventoryError,
  ordersError,
  ordersBlocked,
}: DashboardInsightsProps) {
  const inv = useMemo(() => computeInventoryStats(inventoryItems), [inventoryItems]);
  const ord = useMemo(() => computeOrderStats(orderItems), [orderItems]);

  const activePct = pct(inv.active, inv.total);
  const stockedPct = pct(inv.inStock, inv.total);
  const paidPct = pct(ord.paid, ord.total);
  const pendingPct = pct(ord.pending, ord.total);

  return (
    <div className="dashboard-insights">
      <div className="dashboard-col dashboard-col--kpis">
        <MotionList as="div" className="soft-achievements" staggerChildren={0.06}>
          <AchievementCard
            icon="fa-boxes-stacked"
            tone="blue"
            label="Products"
            value={inv.total}
            loading={inventoryLoading}
            href="/inventory"
            btnLabel="Manage"
          />
          <AchievementCard
            icon="fa-warehouse"
            tone="teal"
            label="In stock"
            value={inv.inStock}
            loading={inventoryLoading}
            href="/inventory"
            btnLabel="View"
          />
          <AchievementCard
            icon="fa-receipt"
            tone="amber"
            label="Orders"
            value={ord.total}
            loading={ordersLoading}
            muted={ordersBlocked}
            href={ordersBlocked ? undefined : "/orders"}
            btnLabel="View"
          />
          <AchievementCard
            icon="fa-coins"
            tone="indigo"
            label="Revenue"
            value={ord.revenue}
            format={formatKes}
            loading={ordersLoading}
            muted={ordersBlocked}
            href={ordersBlocked ? undefined : "/orders"}
            btnLabel="Details"
          />
        </MotionList>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-col dashboard-col--catalog">
          <CatalogColumn
            loading={inventoryLoading}
            error={inventoryError}
            stats={inv}
            activePct={activePct}
            stockedPct={stockedPct}
          />
        </div>

        <div className="dashboard-col dashboard-col--activity">
          <OrdersCard
            loading={ordersLoading}
            blocked={ordersBlocked}
            error={ordersError}
            stats={ord}
            paidPct={paidPct}
            pendingPct={pendingPct}
          />
        </div>

        <div className="dashboard-col dashboard-col--actions">
          <header className="dashboard-actions__head">
            <h2 className="dashboard-insights__title">Quick actions</h2>
            <p className="dashboard-insights__sub">Jump to your most-used tools</p>
          </header>
          <div className="soft-action-cards">
            <Link href="/tickets" className="soft-action-card soft-action-card--blue">
              <span className="soft-action-card__tag">Support</span>
              <h3 className="soft-action-card__title">Tickets inbox</h3>
              <p className="soft-action-card__meta">Reply to customer messages</p>
            </Link>
            <Link href="/inventory" className="soft-action-card soft-action-card--amber">
              <span className="soft-action-card__tag">Catalog</span>
              <h3 className="soft-action-card__title">Manage inventory</h3>
              <p className="soft-action-card__meta">
                {inv.total > 0
                  ? `${inv.active} active products`
                  : "Add your first product"}
              </p>
            </Link>
            <Link href="/pos" className="soft-action-card soft-action-card--teal">
              <span className="soft-action-card__tag">Sales</span>
              <h3 className="soft-action-card__title">Point of sale</h3>
              <p className="soft-action-card__meta">Create orders in-store</p>
            </Link>
            <Link href="/settings" className="soft-action-card soft-action-card--indigo">
              <span className="soft-action-card__tag">Setup</span>
              <h3 className="soft-action-card__title">Shop settings</h3>
              <p className="soft-action-card__meta">Channels, payments & more</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function CatalogColumn({
  loading,
  error,
  stats,
  activePct,
  stockedPct,
}: {
  loading: boolean;
  error: string | null;
  stats: InventoryStats;
  activePct: number;
  stockedPct: number;
}) {
  const empty = !loading && !error && stats.total === 0;
  const ringPct = stats.total > 0 ? activePct : 0;

  return (
    <section className="soft-card">
      <header className="soft-card__head">
        <div>
          <h2 className="soft-card__title">Catalog overview</h2>
          <p className="soft-card__sub">Inventory stats</p>
        </div>
        <Link href="/inventory" className="soft-card__link">
          Manage
        </Link>
      </header>

      {loading ? (
        <div className="page-loading-shell__card-body" aria-busy="true" aria-live="polite">
          <Skeleton variant="text" height={12} width="100%" />
          <Skeleton variant="text" height={12} width="92%" />
          <Skeleton variant="rect" height={160} width="100%" />
        </div>
      ) : error ? (
        <p className="app-error">{error}</p>
      ) : empty ? (
        <EmptyHint
          icon="fa-box-open"
          title="No products yet"
          body="Add your first product or service to start tracking inventory."
          ctaHref="/inventory"
          ctaLabel="Add product"
        />
      ) : (
        <>
          <ul className="soft-list">
            <li className="soft-list__item">
              <div>
                <span className="soft-list__label">Active products</span>
                <span className="soft-list__tag">Live</span>
              </div>
              <span className="soft-list__value">{stats.active}</span>
            </li>
            <li className="soft-list__item">
              <div>
                <span className="soft-list__label">In stock</span>
                <span className="soft-list__meta">Available to sell</span>
              </div>
              <span className="soft-list__value">{stats.inStock}</span>
            </li>
            <li className="soft-list__item">
              <div>
                <span className="soft-list__label">Low stock</span>
                <span className="soft-list__meta">Needs attention</span>
              </div>
              <span className="soft-list__value">{stats.lowStock}</span>
            </li>
          </ul>

          <div className="soft-ring">
            <div className="soft-ring__chart">
              <RingChart percent={ringPct} secondaryPercent={stockedPct} />
              <div className="soft-ring__center">
                <strong>{stats.active}</strong>
                <span>active</span>
              </div>
            </div>
            <div className="soft-ring__stats">
              <div className="soft-ring__stat">
                <strong>{stats.total}</strong>
                <span>Total</span>
              </div>
              <div className="soft-ring__stat">
                <strong>{stats.paused}</strong>
                <span>Paused</span>
              </div>
            </div>
          </div>

          <div className="soft-metrics">
            <div className="soft-metric">
              <strong>{activePct}%</strong>
              <span>Active</span>
              <div className="soft-metric__bar">
                <div
                  className="soft-metric__bar-fill soft-metric__bar-fill--blue"
                  style={{ width: `${activePct}%` }}
                />
              </div>
            </div>
            <div className="soft-metric">
              <strong>{stockedPct}%</strong>
              <span>Stocked</span>
              <div className="soft-metric__bar">
                <div
                  className="soft-metric__bar-fill soft-metric__bar-fill--teal"
                  style={{ width: `${stockedPct}%` }}
                />
              </div>
            </div>
            <div className="soft-metric">
              <strong>{stats.outOfStock}</strong>
              <span>Empty</span>
              <div className="soft-metric__bar">
                <div
                  className="soft-metric__bar-fill soft-metric__bar-fill--amber"
                  style={{
                    width: `${pct(stats.outOfStock, stats.total)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function RingChart({
  percent,
  secondaryPercent,
}: {
  percent: number;
  secondaryPercent: number;
}) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const primary = (Math.min(100, Math.max(0, percent)) / 100) * c;
  const secondary = (Math.min(100, Math.max(0, secondaryPercent)) / 100) * c;

  return (
    <svg viewBox="0 0 160 160" aria-hidden="true">
      <circle
        cx="80"
        cy="80"
        r={r}
        fill="none"
        stroke="var(--app-border-light)"
        strokeWidth="12"
      />
      <circle
        cx="80"
        cy="80"
        r={r}
        fill="none"
        stroke="var(--app-accent-teal)"
        strokeWidth="12"
        strokeDasharray={`${secondary} ${c}`}
        strokeLinecap="round"
      />
      <circle
        cx="80"
        cy="80"
        r={r}
        fill="none"
        stroke="var(--app-accent-blue)"
        strokeWidth="12"
        strokeDasharray={`${primary} ${c}`}
        strokeDashoffset={-secondary}
        strokeLinecap="round"
      />
    </svg>
  );
}

function AchievementCard({
  icon,
  tone,
  label,
  value,
  loading,
  format,
  muted,
  href,
  btnLabel,
}: {
  icon: string;
  tone: "blue" | "teal" | "amber" | "indigo";
  label: string;
  value: number;
  loading: boolean;
  format?: (n: number) => string;
  muted?: boolean;
  href?: string;
  btnLabel: string;
}) {
  const display = format ? format(value) : value.toLocaleString();

  return (
    <MotionItem
      as="article"
      className={`soft-achievement soft-achievement--${tone}${muted ? " is-muted" : ""}`}
    >
      <span className="soft-achievement__icon" aria-hidden="true">
        <i className={`fa-solid ${icon}`} />
      </span>
      {loading ? (
        <Skeleton variant="text" height={22} width={64} />
      ) : (
        <span className="soft-achievement__value">{display}</span>
      )}
      <span className="soft-achievement__label">{label}</span>
      {href ? (
        <Link href={href} className="soft-achievement__btn">
          {btnLabel}
        </Link>
      ) : (
        <span className="soft-achievement__btn" style={{ opacity: 0.5 }}>
          {btnLabel}
        </span>
      )}
    </MotionItem>
  );
}

function OrdersCard({
  loading,
  blocked,
  error,
  stats,
  paidPct,
  pendingPct,
}: {
  loading: boolean;
  blocked: boolean;
  error: string | null;
  stats: OrderStats;
  paidPct: number;
  pendingPct: number;
}) {
  const empty = !loading && !blocked && !error && stats.total === 0;

  return (
    <section className="soft-card">
      <header className="soft-card__head">
        <div>
          <h2 className="soft-card__title">Order activity</h2>
          <p className="soft-card__sub">Sales and payments for your shop</p>
        </div>
        {!blocked ? (
          <Link href="/orders" className="soft-card__link">
            View all
          </Link>
        ) : null}
      </header>

      {loading ? (
        <div className="page-loading-shell__card-body" aria-busy="true" aria-live="polite">
          <Skeleton variant="text" height={12} width="100%" />
          <Skeleton variant="text" height={12} width="92%" />
          <Skeleton variant="text" height={12} width="78%" />
        </div>
      ) : blocked ? (
        <EmptyHint
          icon="fa-store"
          title="No shop linked"
          body="Complete onboarding to start tracking orders and revenue for your shop."
          ctaHref="/tools/onboarding"
          ctaLabel="Finish setup"
        />
      ) : error ? (
        <p className="app-error">{error}</p>
      ) : empty ? (
        <EmptyHint
          icon="fa-receipt"
          title="No orders yet"
          body="Create your first order from the POS or Instagram inbox."
          ctaHref="/pos"
          ctaLabel="Open POS"
        />
      ) : (
        <>
          <ProgressBlock
            label="Paid"
            value={stats.paid}
            total={stats.total}
            percent={paidPct}
            tone="emerald"
          />
          <ProgressBlock
            label="Pending"
            value={stats.pending}
            total={stats.total}
            percent={pendingPct}
            tone="amber"
          />

          <ul className="dashboard-card__breakdown">
            <BreakdownRow
              icon="fa-circle-check"
              tone="emerald"
              label="Paid"
              value={stats.paid}
            />
            <BreakdownRow
              icon="fa-hourglass-half"
              tone="amber"
              label="Pending"
              value={stats.pending}
            />
            <BreakdownRow
              icon="fa-circle-xmark"
              tone="rose"
              label="Failed"
              value={stats.failed}
            />
            <BreakdownRow
              icon="fa-ban"
              tone="slate"
              label="Cancelled"
              value={stats.cancelled}
            />
          </ul>

          <div className="dashboard-card__footnote">
            <span>Revenue collected</span>
            <strong>{formatKes(stats.revenue)}</strong>
          </div>
        </>
      )}
    </section>
  );
}

function ProgressBlock({
  label,
  value,
  total,
  percent,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  percent: number;
  tone: "indigo" | "emerald" | "amber" | "rose";
}) {
  return (
    <div className="dashboard-progress">
      <div className="dashboard-progress__row">
        <span className="dashboard-progress__label">{label}</span>
        <span className="dashboard-progress__count">
          <strong>{value.toLocaleString()}</strong>
          <span className="app-muted"> / {total.toLocaleString()}</span>
        </span>
      </div>
      <div
        className={`dashboard-progress__track dashboard-progress__track--${tone}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${label}: ${percent}%`}
      >
        <div
          className="dashboard-progress__fill"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <span className="dashboard-progress__pct">{percent}%</span>
    </div>
  );
}

function BreakdownRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: number;
  tone: "indigo" | "emerald" | "amber" | "rose" | "slate";
}) {
  return (
    <li className={`dashboard-breakdown dashboard-breakdown--${tone}`}>
      <span className="dashboard-breakdown__icon" aria-hidden="true">
        <i className={`fa-solid ${icon}`} />
      </span>
      <span className="dashboard-breakdown__label">{label}</span>
      <span className="dashboard-breakdown__value">
        {value.toLocaleString()}
      </span>
    </li>
  );
}

function EmptyHint({
  icon,
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  icon: string;
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="dashboard-empty">
      <i className={`fa-solid ${icon}`} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{body}</p>
      {ctaHref && ctaLabel ? (
        <Link href={ctaHref} className="btn btn-primary btn-sm">
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
