"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { nairobiDateKey, parseIso } from "@/lib/nairobi-time";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type { Order, OrdersListResponse } from "@/lib/types";

function firstName(name: string): string {
  const part = name.trim().split(/\s+/)[0];
  return part || "there";
}

function nairobiHour(): number {
  const hour = new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    hour: "numeric",
    hourCycle: "h23",
  }).format(new Date());
  return Number.parseInt(hour, 10);
}

function greetingWord(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function lastNairobiDays(count: number): { key: string; label: string }[] {
  const today = nairobiDateKey(new Date());
  const [year, month, day] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const offset = count - 1 - index;
    const date = new Date(Date.UTC(year, month - 1, day - offset, 12));
    return {
      key: date.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        weekday: "short",
      }).format(date),
    };
  });
}

function orderDayKey(order: Order): string | null {
  const created = parseIso(order.placed_at || order.created_at);
  return created ? nairobiDateKey(created) : null;
}

function saleTotal(order: Order): number {
  return Number(order.total) || 0;
}

export function TransChapHome() {
  const user = useAuthUser();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const shopName =
    user.active_account?.business_name ||
    user.account?.business_name ||
    "your shop";
  const name = firstName(user.name);
  const hello = greetingWord(nairobiHour());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<OrdersListResponse>(
        `${apiRoutes.orders}?source=walkin&per_page=100`,
      );
      setOrders(data.data);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const days = useMemo(() => lastNairobiDays(7), []);
  const todayKey = days[days.length - 1]?.key ?? nairobiDateKey(new Date());
  const yesterdayKey = days[days.length - 2]?.key ?? todayKey;

  const analytics = useMemo(() => {
    const byDay = new Map(days.map((day) => [day.key, { count: 0, revenue: 0 }]));
    const productTotals = new Map<string, { name: string; units: number; revenue: number }>();

    for (const order of orders) {
      const key = orderDayKey(order);
      const amount = saleTotal(order);
      if (key && byDay.has(key)) {
        const bucket = byDay.get(key);
        if (bucket) {
          bucket.count += 1;
          bucket.revenue += amount;
        }
      }
      for (const item of order.items ?? []) {
        const productName = item.product_name?.trim() || "Sale";
        const row = productTotals.get(productName) ?? {
          name: productName,
          units: 0,
          revenue: 0,
        };
        row.units += item.quantity || 1;
        row.revenue += item.line_total ?? (item.quantity || 1) * (item.unit_price ?? 0);
        productTotals.set(productName, row);
      }
    }

    const today = byDay.get(todayKey) ?? { count: 0, revenue: 0 };
    const yesterday = byDay.get(yesterdayKey) ?? { count: 0, revenue: 0 };
    const weekRevenue = [...byDay.values()].reduce((sum, day) => sum + day.revenue, 0);
    const weekCount = [...byDay.values()].reduce((sum, day) => sum + day.count, 0);
    const maxDayRevenue = Math.max(1, ...[...byDay.values()].map((day) => day.revenue));
    const topProduct = [...productTotals.values()].sort((a, b) => b.revenue - a.revenue)[0] ?? null;

    return {
      today,
      yesterday,
      weekRevenue,
      weekCount,
      topProduct,
      chart: days.map((day) => {
        const bucket = byDay.get(day.key) ?? { count: 0, revenue: 0 };
        return {
          ...day,
          ...bucket,
          height: Math.round((bucket.revenue / maxDayRevenue) * 100),
        };
      }),
    };
  }, [days, orders, todayKey, yesterdayKey]);

  const note =
    analytics.today.count === 0
      ? `Ready when you are — make the first sale of the day for ${shopName}.`
      : analytics.today.count === 1
        ? `Nice start, ${name}. One sale is already on the board.`
        : `Nice work, ${name}. ${analytics.today.count} sales so far today.`;

  return (
    <div className="trans-chap-home">
      <section className="trans-chap-welcome">
        <p className="trans-chap-welcome__hello">
          {hello}, {name}
        </p>
        <h2>Welcome to Trans Chap</h2>
        <p>{note}</p>
      </section>

      <section className="trans-chap-kpis" aria-label="Sales today">
        <article className="trans-chap-kpi trans-chap-kpi--wide">
          <span>Today</span>
          <strong>{loading ? "…" : formatKsh(analytics.today.revenue)}</strong>
          <em>
            {loading
              ? "Loading"
              : analytics.yesterday.revenue > 0
                ? `${analytics.today.revenue >= analytics.yesterday.revenue ? "+" : ""}${Math.round(((analytics.today.revenue - analytics.yesterday.revenue) / analytics.yesterday.revenue) * 100)}% vs yesterday`
                : `${analytics.today.count} ${analytics.today.count === 1 ? "sale" : "sales"}`}
          </em>
        </article>
        <article className="trans-chap-kpi">
          <span>Sales</span>
          <strong>{loading ? "…" : analytics.today.count.toLocaleString()}</strong>
          <em>Today</em>
        </article>
        <article className="trans-chap-kpi">
          <span>This week</span>
          <strong>{loading ? "…" : formatKsh(analytics.weekRevenue)}</strong>
          <em>
            {analytics.weekCount} {analytics.weekCount === 1 ? "sale" : "sales"}
          </em>
        </article>
      </section>

      <section className="trans-chap-week" aria-label="This week">
        <div className="trans-chap-week__head">
          <h3>This week</h3>
          <span>
            {analytics.topProduct
              ? `Top: ${analytics.topProduct.name}`
              : "Walk-in sales"}
          </span>
        </div>
        <div className="trans-chap-week__chart">
          {analytics.chart.map((day) => (
            <div
              key={day.key}
              className={`trans-chap-week__col${day.key === todayKey ? " is-today" : ""}`}
            >
              <span
                className="trans-chap-week__bar"
                style={{ height: `${loading ? 12 : Math.max(day.revenue > 0 ? 18 : 8, day.height)}%` }}
                title={`${day.label}: ${formatKsh(day.revenue)}`}
              />
              <em>{day.label.slice(0, 2)}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="trans-chap-recent">
        <div className="trans-chap-week__head">
          <h3>Recent sales</h3>
          <Link href="/trans-chap/make-a-sale">See all</Link>
        </div>
        {loading ? (
          <p className="trans-chap-sales__empty">Loading sales…</p>
        ) : orders.length === 0 ? (
          <p className="trans-chap-sales__empty">No sales yet. Head to Sales to start.</p>
        ) : (
          <ul className="trans-chap-recent__list">
            {orders.slice(0, 4).map((order) => (
              <li key={order.id}>
                <span>
                  <strong>{order.items?.[0]?.product_name || "Sale"}</strong>
                  <em>{order.customer_name || "Walk-in"}</em>
                </span>
                <strong>{formatKsh(order.total)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/trans-chap/make-a-sale/new" className="auth-split__btn">
        Make a sale
      </Link>
    </div>
  );
}
