"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { riderIsLiveOnline } from "@/lib/rider-presence";
import type { RidersListResponse } from "@/lib/types";

const POLL_MS = 8_000;

export function OnlineRidersBadge() {
  const [onlineCount, setOnlineCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<RidersListResponse>(apiRoutes.riders);
      setOnlineCount(res.data.filter((rider) => riderIsLiveOnline(rider)).length);
    } catch {
      /* Presence badge is non-blocking. */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const live = onlineCount > 0;
  const label = onlineCount === 1 ? "rider online" : "riders online";

  return (
    <Link
      href="/delivery#section-riders"
      className={`online-riders-badge${live ? " online-riders-badge--live" : ""}`}
      title="Store pin and riders"
      aria-live="polite"
    >
      <span className="online-riders-badge__dot" aria-hidden="true" />
      <span className="online-riders-badge__count">{loaded ? onlineCount : "—"}</span>
      <span className="online-riders-badge__label">{label}</span>
    </Link>
  );
}
