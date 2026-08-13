"use client";

import { useEffect, useState } from "react";
import { configureGoogleMapsRuntime } from "@/lib/google-maps";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type { GoogleMapsPublicConfig } from "@/lib/types";

export function useGoogleMapsPublicConfig(): {
  config: GoogleMapsPublicConfig | null;
  mapEnabled: boolean;
  loading: boolean;
} {
  const [config, setConfig] = useState<GoogleMapsPublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiFetch<GoogleMapsPublicConfig>(apiRoutes.googleMapsPublicConfig)
      .then((data) => {
        configureGoogleMapsRuntime({ mapId: data.map_id });
        setConfig(data);
      })
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  return {
    config,
    mapEnabled: Boolean(config?.api_key),
    loading,
  };
}
