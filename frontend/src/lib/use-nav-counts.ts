"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type { NavCounts, NavCountsResponse } from "@/lib/types";

const EMPTY_COUNTS: NavCounts = { messages: 0, tickets: 0, orders: 0 };
const POLL_MS = 30_000;

export function useNavCounts(): NavCounts {
  const pathname = usePathname();
  const [counts, setCounts] = useState<NavCounts>(EMPTY_COUNTS);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<NavCountsResponse>(apiRoutes.navCounts);
      setCounts(data.data);
    } catch {
      /* keep last known counts */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    function onFocus() {
      void refresh();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return counts;
}
