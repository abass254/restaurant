"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";

export type PlatformRuntimeMode = "dev" | "production";

type PlatformRuntimeContextValue = {
  mode: PlatformRuntimeMode;
  priceEditEnabled: boolean;
  mpesaUsesDarajaSandbox: boolean;
  loading: boolean;
  setMode: (mode: PlatformRuntimeMode) => Promise<void>;
};

const PlatformRuntimeContext = createContext<PlatformRuntimeContextValue>({
  mode: "dev",
  priceEditEnabled: true,
  mpesaUsesDarajaSandbox: true,
  loading: true,
  setMode: async () => {},
});

type RuntimeModeResponse = {
  data: {
    mode: PlatformRuntimeMode;
    price_edit_enabled: boolean;
    mpesa_uses_daraja_sandbox: boolean;
  };
};

export function PlatformRuntimeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<PlatformRuntimeMode>("dev");
  const [priceEditEnabled, setPriceEditEnabled] = useState(true);
  const [mpesaUsesDarajaSandbox, setMpesaUsesDarajaSandbox] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<RuntimeModeResponse>(apiRoutes.platformRuntimeMode);
      setModeState(res.data.mode);
      setPriceEditEnabled(res.data.price_edit_enabled);
      setMpesaUsesDarajaSandbox(res.data.mpesa_uses_daraja_sandbox);
    } catch {
      setModeState("dev");
      setPriceEditEnabled(true);
      setMpesaUsesDarajaSandbox(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setMode = useCallback(async (next: PlatformRuntimeMode) => {
    const res = await apiFetch<RuntimeModeResponse>(apiRoutes.platformRuntimeMode, {
      method: "PATCH",
      body: JSON.stringify({ mode: next }),
    });
    setModeState(res.data.mode);
    setPriceEditEnabled(res.data.price_edit_enabled);
    setMpesaUsesDarajaSandbox(res.data.mpesa_uses_daraja_sandbox);
  }, []);

  return (
    <PlatformRuntimeContext.Provider
      value={{ mode, priceEditEnabled, mpesaUsesDarajaSandbox, loading, setMode }}
    >
      {children}
    </PlatformRuntimeContext.Provider>
  );
}

export function usePlatformRuntime() {
  return useContext(PlatformRuntimeContext);
}
