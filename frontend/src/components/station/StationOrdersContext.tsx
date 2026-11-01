"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type { Order, OrdersListResponse } from "@/lib/types";
import { isStationNeedsAction } from "@/lib/station";

const ORDERS_POLL_MS = 4_000;
const SOUND_KEY = "TransChap.station.sound";

type StationOrdersContextValue = {
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<Order[] | null>;
  newOrderIds: string[];
  dismissAlert: (orderId: string) => void;
  clearAlerts: () => void;
  soundOn: boolean;
  setSoundOn: (value: boolean) => void;
};

const StationOrdersContext = createContext<StationOrdersContextValue | null>(
  null,
);

export function StationOrdersProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const knownNeedsActionRef = useRef<Set<string>>(new Set());
  const bootstrappedRef = useRef(false);
  const [newOrderIds, setNewOrderIds] = useState<string[]>([]);
  const [soundOn, setSoundOnState] = useState(true);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SOUND_KEY);
      if (raw === "0") setSoundOnState(false);
    } catch {
      // ignore
    }
  }, []);

  const setSoundOn = useCallback((value: boolean) => {
    setSoundOnState(value);
    try {
      window.localStorage.setItem(SOUND_KEY, value ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

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
      const needsActionIds = new Set(
        list.filter(isStationNeedsAction).map((o) => o.id),
      );

      if (!bootstrappedRef.current) {
        bootstrappedRef.current = true;
        knownIdsRef.current = ids;
        knownNeedsActionRef.current = needsActionIds;
      } else {
        // Alert on brand-new orders, or existing orders that newly need action
        // (e.g. payment just cleared).
        const fresh = list
          .filter((o) => {
            if (!isStationNeedsAction(o)) return false;
            const isNewId = !knownIdsRef.current.has(o.id);
            const newlyNeedsAction = !knownNeedsActionRef.current.has(o.id);
            return isNewId || newlyNeedsAction;
          })
          .map((o) => o.id);
        if (fresh.length) {
          setNewOrderIds((prev) => {
            const merged = [...fresh, ...prev.filter((id) => !fresh.includes(id))];
            return merged.slice(0, 20);
          });
        }
        knownIdsRef.current = ids;
        knownNeedsActionRef.current = needsActionIds;
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
    const id = window.setInterval(() => void refresh(), ORDERS_POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const dismissAlert = useCallback((orderId: string) => {
    setNewOrderIds((prev) => prev.filter((id) => id !== orderId));
  }, []);

  const clearAlerts = useCallback(() => setNewOrderIds([]), []);

  const value = useMemo(
    () => ({
      orders,
      setOrders,
      loading,
      error,
      refresh,
      newOrderIds,
      dismissAlert,
      clearAlerts,
      soundOn,
      setSoundOn,
    }),
    [
      orders,
      loading,
      error,
      refresh,
      newOrderIds,
      dismissAlert,
      clearAlerts,
      soundOn,
      setSoundOn,
    ],
  );

  return (
    <StationOrdersContext.Provider value={value}>
      {children}
    </StationOrdersContext.Provider>
  );
}

export function useStationOrdersContext(): StationOrdersContextValue {
  const ctx = useContext(StationOrdersContext);
  if (!ctx) {
    throw new Error("useStationOrdersContext must be used within StationOrdersProvider");
  }
  return ctx;
}
