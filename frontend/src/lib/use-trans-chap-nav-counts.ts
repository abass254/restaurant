"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { parseIso } from "@/lib/nairobi-time";
import { fetchKitchenIssues } from "@/lib/restaurant-supplies";
import type { OrdersListResponse } from "@/lib/types";

export type TransChapNavCountKey = "orders" | "kitchen" | "kitchenRequests";
export type TransChapNavCounts = Record<TransChapNavCountKey, number>;

export const TRANS_CHAP_NAV_COUNT_PATHS: Record<TransChapNavCountKey, string> = {
  orders: "/trans-chap/sales",
  kitchen: "/trans-chap/kitchen",
  kitchenRequests: "/trans-chap/stocks",
};

const EMPTY: TransChapNavCounts = { orders: 0, kitchen: 0, kitchenRequests: 0 };
const POLL_MS = 10_000;

const TERMINAL_STATUSES = new Set([
  "delivered",
  "picked_up",
  "cancelled",
  "refunded",
  "completed",
]);

const KITCHEN_ACTIVE_STATUSES = new Set([
  "placed",
  "being_prepared",
]);

function openedIdsKey(accountId: string, key: TransChapNavCountKey): string {
  return `trans-chap:opened-ids:${accountId}:${key}`;
}

function lastOpenedKey(accountId: string, key: TransChapNavCountKey): string {
  return `trans-chap:last-opened:${accountId}:${key}`;
}

function getOpenedIds(accountId: string, key: TransChapNavCountKey): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(openedIdsKey(accountId, key));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveOpenedIds(accountId: string, key: TransChapNavCountKey, ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    const slice = Array.from(ids).slice(-300);
    window.localStorage.setItem(openedIdsKey(accountId, key), JSON.stringify(slice));
  } catch {
    /* storage unavailable */
  }
}

function getLastOpened(accountId: string, key: TransChapNavCountKey): Date | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(lastOpenedKey(accountId, key));
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function recordSectionOpened(
  accountId: string,
  key: TransChapNavCountKey,
  currentIds?: string[],
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lastOpenedKey(accountId, key), new Date().toISOString());
    if (currentIds && currentIds.length) {
      const existing = getOpenedIds(accountId, key);
      for (const id of currentIds) existing.add(id);
      saveOpenedIds(accountId, key, existing);
    }
  } catch {
    /* storage unavailable */
  }
}

export function markTransChapOrderOpened(
  accountId: string | null | undefined,
  orderId: string | null | undefined,
) {
  if (!accountId || !orderId || typeof window === "undefined") return;
  try {
    const orders = getOpenedIds(accountId, "orders");
    orders.add(orderId);
    saveOpenedIds(accountId, "orders", orders);

    const kitchen = getOpenedIds(accountId, "kitchen");
    kitchen.add(orderId);
    saveOpenedIds(accountId, "kitchen", kitchen);

    window.dispatchEvent(new CustomEvent("trans-chap:refresh-counts"));
  } catch {
    /* ignore */
  }
}

function onPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

async function countPendingOrders(
  accountId: string,
  onOrdersPage: boolean,
): Promise<number> {
  const res = await apiFetch<OrdersListResponse>(
    `${apiRoutes.orders}?per_page=50`,
  );
  const rows = res.data ?? [];
  const pending = rows.filter((o) => !TERMINAL_STATUSES.has(o.status));

  if (onOrdersPage) {
    recordSectionOpened(accountId, "orders", pending.map((o) => o.id));
    return 0;
  }

  const openedIds = getOpenedIds(accountId, "orders");
  const lastOpened = getLastOpened(accountId, "orders");

  if (!lastOpened) {
    return pending.filter((o) => !openedIds.has(o.id)).length;
  }

  return pending.filter((o) => {
    if (openedIds.has(o.id)) return false;
    const createdAt = parseIso(o.created_at || o.placed_at);
    if (!createdAt) return true;
    return createdAt > lastOpened;
  }).length;
}

async function countPendingKitchenOrders(
  accountId: string,
  onKitchenPage: boolean,
): Promise<number> {
  const res = await apiFetch<OrdersListResponse>(
    `${apiRoutes.orders}?per_page=50`,
  );
  const rows = res.data ?? [];
  const kitchenPending = rows.filter(
    (o) => KITCHEN_ACTIVE_STATUSES.has(o.status) && !TERMINAL_STATUSES.has(o.status),
  );

  if (onKitchenPage) {
    recordSectionOpened(accountId, "kitchen", kitchenPending.map((o) => o.id));
    return 0;
  }

  const openedIds = getOpenedIds(accountId, "kitchen");
  const lastOpened = getLastOpened(accountId, "kitchen");

  if (!lastOpened) {
    return kitchenPending.filter((o) => !openedIds.has(o.id)).length;
  }

  return kitchenPending.filter((o) => {
    if (openedIds.has(o.id)) return false;
    const createdAt = parseIso(o.created_at || o.placed_at);
    if (!createdAt) return true;
    return createdAt > lastOpened;
  }).length;
}

async function countPendingKitchenRequests(
  accountId: string,
  onStocksPage: boolean,
): Promise<number> {
  const issues = await fetchKitchenIssues("requested");
  const pending = issues.filter((i) => i.status === "requested");

  if (onStocksPage) {
    recordSectionOpened(accountId, "kitchenRequests", pending.map((i) => i.id));
    return 0;
  }

  const openedIds = getOpenedIds(accountId, "kitchenRequests");
  const lastOpened = getLastOpened(accountId, "kitchenRequests");

  if (!lastOpened) {
    return pending.filter((i) => !openedIds.has(i.id)).length;
  }

  return pending.filter((i) => {
    if (openedIds.has(i.id)) return false;
    const createdAt = parseIso(i.created_at);
    if (!createdAt) return true;
    return createdAt > lastOpened;
  }).length;
}

/**
 * Navbar badges for pending entries that have not been opened.
 * Tracks unopened pending orders, kitchen orders, and kitchen supply requests.
 */
export function useTransChapNavCounts({
  accountId,
  userId,
  pathname,
  enabled,
}: {
  accountId: string | null | undefined;
  userId: string | null | undefined;
  pathname: string;
  enabled: Record<TransChapNavCountKey, boolean>;
}): TransChapNavCounts {
  const [counts, setCounts] = useState<TransChapNavCounts>(EMPTY);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    const jobs: [TransChapNavCountKey, boolean, () => Promise<number>][] = [
      [
        "orders",
        Boolean(enabled.orders),
        () => countPendingOrders(accountId, onPath(pathname, TRANS_CHAP_NAV_COUNT_PATHS.orders)),
      ],
      [
        "kitchen",
        Boolean(enabled.kitchen),
        () => countPendingKitchenOrders(accountId, onPath(pathname, TRANS_CHAP_NAV_COUNT_PATHS.kitchen)),
      ],
      [
        "kitchenRequests",
        Boolean(enabled.kitchenRequests),
        () => countPendingKitchenRequests(accountId, onPath(pathname, TRANS_CHAP_NAV_COUNT_PATHS.kitchenRequests)),
      ],
    ];
    const next: Partial<TransChapNavCounts> = {};
    await Promise.all(
      jobs.map(async ([key, on, countFn]) => {
        if (!on) {
          next[key] = 0;
          return;
        }
        try {
          next[key] = await countFn();
        } catch {
          /* keep last known count */
        }
      }),
    );
    setCounts((prev) => ({ ...prev, ...next }));
  }, [accountId, pathname, enabled.orders, enabled.kitchen, enabled.kitchenRequests]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener("trans-chap:refresh-counts", refresh);
    window.addEventListener("dukai:notification", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("trans-chap:refresh-counts", refresh);
      window.removeEventListener("dukai:notification", refresh);
    };
  }, [refresh]);

  return counts;
}
