"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { parseIso } from "@/lib/nairobi-time";
import { fetchKitchenIssues } from "@/lib/restaurant-supplies";
import type { OrdersListResponse } from "@/lib/types";

export type TransChapNavCountKey = "orders" | "kitchenRequests";
export type TransChapNavCounts = Record<TransChapNavCountKey, number>;

export const TRANS_CHAP_NAV_COUNT_PATHS: Record<TransChapNavCountKey, string> = {
  orders: "/trans-chap/sales",
  kitchenRequests: "/trans-chap/stocks",
};

const EMPTY: TransChapNavCounts = { orders: 0, kitchenRequests: 0 };
const POLL_MS = 30_000;

function seenKey(accountId: string, key: TransChapNavCountKey): string {
  return `trans-chap-nav-seen:${accountId}:${key}`;
}

/** First visit starts the clock now so existing history doesn't show as "new". */
function readSeen(accountId: string, key: TransChapNavCountKey): Date {
  try {
    const raw = window.localStorage.getItem(seenKey(accountId, key));
    const parsed = raw ? new Date(raw) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  } catch {
    /* storage unavailable */
  }
  return markSeen(accountId, key);
}

function markSeen(accountId: string, key: TransChapNavCountKey): Date {
  const now = new Date();
  try {
    window.localStorage.setItem(seenKey(accountId, key), now.toISOString());
  } catch {
    /* storage unavailable */
  }
  return now;
}

function onPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

async function countNewOrders(since: Date, userId: string): Promise<number> {
  const res = await apiFetch<OrdersListResponse>(
    `${apiRoutes.orders}?source=walkin&per_page=100&since=${encodeURIComponent(since.toISOString())}`,
  );
  const others = res.data.filter((order) => order.placed_by_user_id !== userId).length;
  return res.meta.total > res.data.length ? res.meta.total : others;
}

async function countNewKitchenRequests(since: Date, userId: string): Promise<number> {
  const issues = await fetchKitchenIssues("requested");
  return issues.filter((issue) => {
    if (issue.requested_by === userId) return false;
    const created = parseIso(issue.created_at);
    return created !== null && created > since;
  }).length;
}

/**
 * Bottom-bar badges for entries that arrived since the user last opened the tab.
 * "Last opened" is kept per shop on this device.
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
  const ordersOn = enabled.orders;
  const kitchenOn = enabled.kitchenRequests;

  const refresh = useCallback(async () => {
    if (!accountId || !userId) return;
    const jobs: [TransChapNavCountKey, boolean, (since: Date, userId: string) => Promise<number>][] = [
      ["orders", ordersOn, countNewOrders],
      ["kitchenRequests", kitchenOn, countNewKitchenRequests],
    ];
    const next: Partial<TransChapNavCounts> = {};
    await Promise.all(
      jobs.map(async ([key, on, count]) => {
        if (!on) {
          next[key] = 0;
          return;
        }
        if (onPath(pathname, TRANS_CHAP_NAV_COUNT_PATHS[key])) {
          markSeen(accountId, key);
          next[key] = 0;
          return;
        }
        try {
          next[key] = await count(readSeen(accountId, key), userId);
        } catch {
          /* keep last known count */
        }
      }),
    );
    setCounts((prev) => ({ ...prev, ...next }));
  }, [accountId, userId, pathname, ordersOn, kitchenOn]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  return counts;
}
