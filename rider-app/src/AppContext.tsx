import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import type { MockStore } from '@/src/data/mockStores';
import {
  ApiError,
  fetchRiderMe,
  getSessionToken,
  logoutRider,
  riderHeartbeat,
  setRiderPresence,
  tripHref,
  type RiderMe,
  type RiderOffer,
} from '@/src/api';

export type RiderProfile = {
  name: string;
  phone: string;
  email: string;
  vehicleType: string;
  plateNumber: string;
  city: string;
  bio: string;
  /** Local URI from image picker, or null. */
  photoUri: string | null;
};

const DEFAULT_PROFILE: RiderProfile = {
  name: '',
  phone: '',
  email: '',
  vehicleType: 'Motorcycle',
  plateNumber: '',
  city: 'Nairobi',
  bio: '',
  photoUri: null,
};

const PROFILE_KEY = 'dukai.rider.profile';
const STORES_PAUSE_KEY = 'dukai.rider.stores_paused';

type AppState = {
  loggedIn: boolean;
  authLoading: boolean;
  me: RiderMe | null;
  offers: RiderOffer[];
  refresh: () => Promise<RiderMe | null>;
  setOnline: (online: boolean) => Promise<void>;
  /** Call after verifyLoginCode succeeded. */
  onAuthenticated: (me: RiderMe) => void;
  logout: () => Promise<void>;
  stores: MockStore[];
  togglePause: (id: string) => void;
  profile: RiderProfile;
  profileLoaded: boolean;
  updateProfile: (patch: Partial<RiderProfile>) => Promise<void>;
};

const Ctx = createContext<AppState | null>(null);

function profileFromMe(me: RiderMe, prev: RiderProfile): RiderProfile {
  return {
    ...prev,
    name: me.rider_name || prev.name,
    phone: me.phone || prev.phone,
  };
}

function storesFromMe(me: RiderMe, pausedIds: Set<string>): MockStore[] {
  if (!me.merchant_name) return [];
  const id = me.rider_id ? `merchant-${me.rider_id}` : 'merchant-1';
  return [
    {
      id,
      name: me.merchant_name,
      location: me.store_location || 'Linked store',
      paused: pausedIds.has(id),
    },
  ];
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [authLoading, setAuthLoading] = useState(true);
  const [me, setMe] = useState<RiderMe | null>(null);
  const [offers, setOffers] = useState<RiderOffer[]>([]);
  const [stores, setStores] = useState<MockStore[]>([]);
  const [pausedIds, setPausedIds] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<RiderProfile>(DEFAULT_PROFILE);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const navigatingTrip = useRef(false);

  const loggedIn = Boolean(me);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rawProfile, rawPaused] = await Promise.all([
          AsyncStorage.getItem(PROFILE_KEY),
          AsyncStorage.getItem(STORES_PAUSE_KEY),
        ]);
        if (cancelled) return;
        if (rawProfile) {
          const parsed = JSON.parse(rawProfile) as Partial<RiderProfile>;
          setProfile({ ...DEFAULT_PROFILE, ...parsed });
        }
        if (rawPaused) {
          const ids = JSON.parse(rawPaused) as string[];
          if (Array.isArray(ids)) setPausedIds(new Set(ids));
        }
      } catch {
        // keep defaults
      } finally {
        if (!cancelled) setProfileLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchRiderMe();
      setMe(next);
      setProfile((prev) => profileFromMe(next, prev));
      setStores(storesFromMe(next, pausedIds));
      return next;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setMe(null);
        setOffers([]);
        return null;
      }
      throw err;
    }
  }, [pausedIds]);

  // Boot: restore session
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getSessionToken();
        if (!token) {
          if (!cancelled) setAuthLoading(false);
          return;
        }
        const next = await fetchRiderMe();
        if (cancelled) return;
        setMe(next);
        setProfile((prev) => profileFromMe(next, prev));
        setStores(storesFromMe(next, pausedIds));
      } catch {
        if (!cancelled) {
          setMe(null);
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once
  }, []);

  // Keep stores in sync when me / pause set changes
  useEffect(() => {
    if (me) {
      setStores(storesFromMe(me, pausedIds));
    }
  }, [me, pausedIds]);

  const onAuthenticated = useCallback(
    (next: RiderMe) => {
      setMe(next);
      setProfile((prev) => profileFromMe(next, prev));
      setStores(storesFromMe(next, pausedIds));
      setAuthLoading(false);
    },
    [pausedIds],
  );

  const applyHeartbeat = useCallback((data: Awaited<ReturnType<typeof riderHeartbeat>>) => {
    setOffers(data.offers || []);
    setMe((prev) =>
      prev
        ? {
            ...prev,
            is_online: data.is_online,
            last_seen_at: data.last_seen_at,
            active_trip_id: data.active_trip_id,
            active_trip_phase: data.active_trip_phase,
            active_trip_route: data.active_trip_route,
          }
        : prev,
    );
  }, []);

  const setOnline = useCallback(async (online: boolean) => {
    const next = await setRiderPresence({ online });
    setMe(next);
    if (online) {
      const data = await riderHeartbeat({});
      applyHeartbeat(data);
    } else {
      setOffers([]);
    }
  }, [applyHeartbeat]);

  const logout = useCallback(async () => {
    await logoutRider();
    setMe(null);
    setOffers([]);
    setStores([]);
  }, []);

  const togglePause = useCallback((id: string) => {
    setPausedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      AsyncStorage.setItem(STORES_PAUSE_KEY, JSON.stringify([...next])).catch(() => undefined);
      return next;
    });
  }, []);

  const updateProfile = useCallback(async (patch: Partial<RiderProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  // Heartbeat while authenticated — poll faster when online so offers aren't missed.
  useEffect(() => {
    if (!me?.rider_id) return;
    let cancelled = false;

    async function beat() {
      try {
        const data = await riderHeartbeat({});
        if (cancelled) return;
        applyHeartbeat(data);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          if (!cancelled) {
            setMe(null);
            setOffers([]);
          }
        }
      }
    }

    void beat();
    const intervalMs = me.is_online ? 4000 : 20000;
    const id = setInterval(() => void beat(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [me?.rider_id, me?.is_online, applyHeartbeat]);

  // Resume / follow active trip phases (not completed)
  useEffect(() => {
    if (authLoading) return;
    if (!me?.active_trip_id || !me.active_trip_phase) return;
    const active = new Set([
      'en_route_to_store',
      'at_store',
      'picking_up',
      'en_route_to_client',
      'at_client',
    ]);
    if (!active.has(me.active_trip_phase)) return;
    if (navigatingTrip.current) return;
    const href = tripHref(me.active_trip_phase, me.active_trip_id);
    navigatingTrip.current = true;
    try {
      router.replace(href as never);
    } finally {
      setTimeout(() => {
        navigatingTrip.current = false;
      }, 1500);
    }
  }, [authLoading, me?.active_trip_id, me?.active_trip_phase]);

  const value = useMemo(
    () => ({
      loggedIn,
      authLoading,
      me,
      offers,
      refresh,
      setOnline,
      onAuthenticated,
      logout,
      stores,
      togglePause,
      profile,
      profileLoaded,
      updateProfile,
    }),
    [
      loggedIn,
      authLoading,
      me,
      offers,
      refresh,
      setOnline,
      onAuthenticated,
      logout,
      stores,
      togglePause,
      profile,
      profileLoaded,
      updateProfile,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function useRider() {
  return useApp();
}
