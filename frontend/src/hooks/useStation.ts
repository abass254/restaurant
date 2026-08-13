"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type { Order, OrdersListResponse, StoreStatus, StoreStatusResponse } from "@/lib/types";

const ORDERS_POLL_MS = 4_000;
const HEARTBEAT_MS = 60_000;

export function useStoreStatus() {
  const [store, setStore] = useState<StoreStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch<StoreStatusResponse>(apiRoutes.storeStatus);
      setStore(res.data);
      setError(null);
      return res.data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load store status.");
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pause = useCallback(
    async (durationMinutes?: number | null) => {
      const res = await apiFetch<StoreStatusResponse>(apiRoutes.storeStatusPause, {
        method: "POST",
        body: JSON.stringify(
          durationMinutes ? { duration_minutes: durationMinutes } : {},
        ),
      });
      setStore(res.data);
      return res.data;
    },
    [],
  );

  const resume = useCallback(async () => {
    const res = await apiFetch<StoreStatusResponse>(apiRoutes.storeStatusResume, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setStore(res.data);
    return res.data;
  }, []);

  const setBusy = useCallback(async (extraPrepMinutes: number) => {
    const res = await apiFetch<StoreStatusResponse>(apiRoutes.storeStatusBusy, {
      method: "POST",
      body: JSON.stringify({ extra_prep_minutes: extraPrepMinutes }),
    });
    setStore(res.data);
    return res.data;
  }, []);

  const heartbeat = useCallback(async () => {
    const res = await apiFetch<StoreStatusResponse>(apiRoutes.storeStatusHeartbeat, {
      method: "POST",
      body: JSON.stringify({ device_label: "station" }),
    });
    setStore(res.data);
    return res.data;
  }, []);

  return { store, error, refresh, pause, resume, setBusy, heartbeat, setStore };
}

export function useStationHeartbeat(
  enabled: boolean,
  heartbeat: () => Promise<StoreStatus | null>,
) {
  const onlineRef = useRef(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    function onOnline() {
      onlineRef.current = true;
      setOnline(true);
    }
    function onOffline() {
      onlineRef.current = false;
      setOnline(false);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function beat() {
      if (cancelled || !onlineRef.current) return;
      try {
        await heartbeat();
      } catch {
        // Keep trying; auto-pause happens server-side when beats stop.
      }
    }

    void beat();
    const id = window.setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, heartbeat]);

  return { online };
}

export function useStationOrders(poll = true) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const bootstrappedRef = useRef(false);
  const [newOrderIds, setNewOrderIds] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("per_page", "100");
      const data = await apiFetch<OrdersListResponse>(
        `${apiRoutes.orders}?${params.toString()}`,
      );
      const list = data.data;
      setOrders(list);
      setError(null);

      const ids = new Set(list.map((o) => o.id));
      if (!bootstrappedRef.current) {
        bootstrappedRef.current = true;
        knownIdsRef.current = ids;
      } else {
        const fresh = list
          .filter((o) => !knownIdsRef.current.has(o.id))
          .map((o) => o.id);
        if (fresh.length) {
          setNewOrderIds((prev) => [...fresh, ...prev].slice(0, 20));
        }
        knownIdsRef.current = ids;
      }
      setLoading(false);
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load orders.");
      setLoading(false);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!poll) return;
    const id = window.setInterval(() => void refresh(), ORDERS_POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [poll, refresh]);

  const dismissAlert = useCallback((orderId: string) => {
    setNewOrderIds((prev) => prev.filter((id) => id !== orderId));
  }, []);

  const clearAlerts = useCallback(() => setNewOrderIds([]), []);

  return {
    orders,
    setOrders,
    loading,
    error,
    refresh,
    newOrderIds,
    dismissAlert,
    clearAlerts,
  };
}
