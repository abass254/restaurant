"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type {
  RiderHeartbeatResponse,
  RiderMe,
  RiderMeResponse,
  RiderOffer,
} from "@/lib/types";

type RiderContextValue = {
  me: RiderMe | null;
  loading: boolean;
  offers: RiderOffer[];
  refresh: () => Promise<RiderMe | null>;
  setOnline: (online: boolean) => Promise<void>;
  logout: () => Promise<void>;
};

const RiderContext = createContext<RiderContextValue | null>(null);

const PUBLIC_PATHS = new Set(["/r/login"]);

export function RiderProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<RiderMe | null>(null);
  const [offers, setOffers] = useState<RiderOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const riderId = me?.rider_id ?? null;

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch<RiderMeResponse>(apiRoutes.riderMe);
      setMe(res.data);
      setLoading(false);
      return res.data;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setMe(null);
        setLoading(false);
        if (!PUBLIC_PATHS.has(pathname || "")) {
          router.replace("/r/login");
        }
        return null;
      }
      setLoading(false);
      throw err;
    }
  }, [pathname, router]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await apiFetch<RiderMeResponse>(apiRoutes.riderMe);
          if (cancelled) return;
          setMe(res.data);
        } catch (err) {
          if (cancelled) return;
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            setMe(null);
            if (!PUBLIC_PATHS.has(pathname || "")) {
              router.replace("/r/login");
            }
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pathname, router]);

  // Heartbeat while authenticated — polls offers and keeps presence fresh.
  useEffect(() => {
    if (!riderId) return;
    if ((pathname || "").startsWith("/r/login")) return;
    let cancelled = false;

    async function beat() {
      try {
        const res = await apiFetch<RiderHeartbeatResponse>(apiRoutes.riderHeartbeat, {
          method: "POST",
          body: JSON.stringify({}),
        });
        if (cancelled) return;
        const nextOffers = res.data.offers || [];
        setOffers(nextOffers);
        setMe((prev) =>
          prev
            ? {
                ...prev,
                is_online: res.data.is_online,
                last_seen_at: res.data.last_seen_at,
                active_trip_id: res.data.active_trip_id,
                active_trip_phase: res.data.active_trip_phase,
                active_trip_route: res.data.active_trip_route,
              }
            : prev,
        );

        const path = pathname || "";
        const onOfferScreen = path.startsWith("/r/offer");
        if (
          nextOffers.length &&
          res.data.is_online &&
          !onOfferScreen &&
          (path === "/r/online" || path === "/r/home")
        ) {
          router.push(`/r/offer/${nextOffers[0].id}`);
        }
      } catch {
        /* ignore transient heartbeat errors */
      }
    }

    const start = window.setTimeout(() => void beat(), 0);
    const id = window.setInterval(() => void beat(), 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      window.clearInterval(id);
    };
  }, [riderId, pathname, router]);

  const setOnline = useCallback(async (online: boolean) => {
    const res = await apiFetch<RiderMeResponse>(apiRoutes.riderPresence, {
      method: "POST",
      body: JSON.stringify({ online }),
    });
    setMe(res.data);
    if (online) {
      router.push("/r/online");
    } else {
      router.push("/r/home");
    }
  }, [router]);

  const logout = useCallback(async () => {
    try {
      await apiFetch(apiRoutes.riderAuthLogout, { method: "POST", body: "{}" });
    } catch {
      /* still clear local */
    }
    setMe(null);
    setOffers([]);
    router.replace("/r/login");
  }, [router]);

  const value = useMemo(
    () => ({ me, loading, offers, refresh, setOnline, logout }),
    [me, loading, offers, refresh, setOnline, logout],
  );

  return <RiderContext.Provider value={value}>{children}</RiderContext.Provider>;
}

export function useRider() {
  const ctx = useContext(RiderContext);
  if (!ctx) throw new Error("useRider must be used within RiderProvider");
  return ctx;
}
