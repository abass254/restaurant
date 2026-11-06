"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRoutes } from "@/lib/config";
import { internalErrorMessage } from "@/lib/alerts";
import { fetchAllPages } from "@/lib/paged-fetch";
import { formatKsh } from "@/lib/trans-chap-receipt";
import type { Order, OrderStatus, OrdersListResponse } from "@/lib/types";

const OPEN_STATUSES: OrderStatus[] = [
  "placed",
  "awaiting_payment",
  "payment_received",
  "being_prepared",
  "ready",
];

const LATE_MINUTES = 20;

type Stage = "new" | "cooking" | "ready";

function stageOf(order: Order): Stage {
  if (order.status === "being_prepared") return "cooking";
  if (order.status === "ready") return "ready";
  return "new";
}

function placedMs(order: Order): number {
  return Date.parse(order.placed_at || order.created_at || "") || 0;
}

function minutesSince(ms: number, now: number): number {
  return ms ? Math.max(0, Math.floor((now - ms) / 60_000)) : 0;
}

function waitLabel(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function tableLabel(raw: string): string {
  const value = raw.trim();
  return value.toLowerCase().startsWith("table") ? value : `Table ${value}`;
}

type TableTab = {
  key: string;
  label: string;
  total: number;
  orders: number;
  oldest: number;
  server: string | null;
  ready: boolean;
};

export function RestaurantHomeBoard({ canKitchen }: { canKitchen: boolean }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const results = await Promise.all(
      OPEN_STATUSES.map((status) =>
        fetchAllPages<OrdersListResponse["data"][number]>(
          (page) => `${apiRoutes.orders}?status=${status}&per_page=100&page=${page}`,
          5,
        ),
      ),
    );
    if (results.some((result) => result.failed)) {
      setError(internalErrorMessage());
      return;
    }
    const unique = new Map<string, Order>();
    for (const result of results) for (const order of result.rows) unique.set(order.id, order);
    setOrders([...unique.values()]);
    setNow(Date.now());
    setError(null);
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 15_000);
    const onEvent = () => void load();
    window.addEventListener("trans-chap:refresh-counts", onEvent);
    window.addEventListener("TransChap:notification", onEvent);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.removeEventListener("trans-chap:refresh-counts", onEvent);
      window.removeEventListener("TransChap:notification", onEvent);
    };
  }, [load]);

  const board = useMemo(() => {
    const rows = orders ?? [];
    const stages: Record<Stage, Order[]> = { new: [], cooking: [], ready: [] };
    for (const order of rows) stages[stageOf(order)].push(order);

    const waiting = [...stages.new, ...stages.cooking];
    const oldestWait = waiting.length
      ? minutesSince(Math.min(...waiting.map(placedMs).filter(Boolean), now), now)
      : 0;
    const late = waiting.filter((order) => minutesSince(placedMs(order), now) >= LATE_MINUTES).length;

    const tables = new Map<string, TableTab>();
    let takeaway = 0;
    let delivery = 0;
    for (const order of rows) {
      const table = order.table_number?.trim();
      if (order.fulfillment_type === "dine_in" && table) {
        const key = table.toLowerCase();
        const entry = tables.get(key) ?? {
          key,
          label: tableLabel(table),
          total: 0,
          orders: 0,
          oldest: 0,
          server: order.server_name?.trim() || null,
          ready: false,
        };
        const placed = placedMs(order);
        entry.total += order.total;
        entry.orders += 1;
        if (placed && (!entry.oldest || placed < entry.oldest)) entry.oldest = placed;
        entry.ready = entry.ready || order.status === "ready";
        tables.set(key, entry);
      } else if (order.fulfillment_type === "delivery") {
        delivery += 1;
      } else {
        takeaway += 1;
      }
    }

    return {
      stages,
      oldestWait,
      late,
      tables: [...tables.values()].sort((a, b) => a.oldest - b.oldest),
      takeaway,
      delivery,
      openValue: rows.reduce((sum, order) => sum + order.total, 0),
    };
  }, [orders, now]);

  if (!orders) {
    return error ? (
      <p className="rs-home__note is-error">{error}</p>
    ) : (
      <section className="rs-home is-loading" aria-label="Live service" aria-busy>
        <div className="rs-home__stages">
          <span className="rs-home__skeleton" />
          <span className="rs-home__skeleton" />
          <span className="rs-home__skeleton" />
        </div>
      </section>
    );
  }

  const stageTiles: Array<{ id: Stage; label: string; icon: string }> = [
    { id: "new", label: "New", icon: "fa-bell-concierge" },
    { id: "cooking", label: "Cooking", icon: "fa-fire-burner" },
    { id: "ready", label: "Ready", icon: "fa-circle-check" },
  ];
  const openCount = orders.length;

  return (
    <section className="rs-home" aria-labelledby="rs-home-heading">
      <header className="rs-home__head">
        <div>
          <h3 id="rs-home-heading">
            <span className="rs-home__live" aria-hidden />
            Live service
          </h3>
          <p>
            {openCount === 0
              ? "No open orders right now"
              : `${openCount} open order${openCount === 1 ? "" : "s"} · ${formatKsh(board.openValue)}`}
          </p>
        </div>
        {canKitchen ? (
          <Link href="/trans-chap/kitchen" className="rs-home__link">
            Kitchen
            <i className="fa-solid fa-chevron-right" aria-hidden />
          </Link>
        ) : null}
      </header>

      <div className="rs-home__stages">
        {stageTiles.map((tile) => {
          const count = board.stages[tile.id].length;
          const body = (
            <>
              <span className="rs-home__stage-label">
                <i className={`fa-solid ${tile.icon}`} aria-hidden />
                {tile.label}
              </span>
              <strong>{count}</strong>
            </>
          );
          const className = `rs-home__stage is-${tile.id}${count > 0 ? " has-items" : ""}`;
          return canKitchen ? (
            <Link key={tile.id} href="/trans-chap/kitchen" className={className}>
              {body}
            </Link>
          ) : (
            <div key={tile.id} className={className}>
              {body}
            </div>
          );
        })}
      </div>

      {board.stages.new.length + board.stages.cooking.length > 0 ? (
        <p className={`rs-home__note${board.late > 0 ? " is-late" : ""}`}>
          <i className={`fa-solid ${board.late > 0 ? "fa-triangle-exclamation" : "fa-clock"}`} aria-hidden />
          {board.late > 0
            ? `${board.late} ticket${board.late === 1 ? "" : "s"} waiting over ${LATE_MINUTES} min · oldest ${waitLabel(board.oldestWait)}`
            : `Oldest ticket waiting ${waitLabel(board.oldestWait)}`}
        </p>
      ) : null}

      <div className="rs-home__tables">
        <div className="rs-home__subhead">
          <h4>Tables in service</h4>
          <span>
            {board.takeaway > 0 ? `${board.takeaway} takeaway` : null}
            {board.takeaway > 0 && board.delivery > 0 ? " · " : null}
            {board.delivery > 0 ? `${board.delivery} delivery` : null}
          </span>
        </div>
        {board.tables.length === 0 ? (
          <p className="rs-home__empty">No tables seated. Dine-in orders show up here.</p>
        ) : (
          <ul>
            {board.tables.map((table) => {
              const minutes = minutesSince(table.oldest, now);
              return (
                <li key={table.key} className={table.ready ? "is-ready" : undefined}>
                  <span className="rs-home__table-name">{table.label}</span>
                  <strong>{formatKsh(table.total)}</strong>
                  <em>
                    {waitLabel(minutes)}
                    {table.orders > 1 ? ` · ${table.orders} orders` : ""}
                    {table.server ? ` · ${table.server}` : ""}
                  </em>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
