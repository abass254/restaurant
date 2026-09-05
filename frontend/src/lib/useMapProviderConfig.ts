"use client";

import { useEffect, useMemo, useState } from "react";
import { configureGoogleMapsRuntime } from "@/lib/google-maps";
import {
  isMapUiEnabled,
  mapViewConfigFromGoogle,
  resolveMapProvider,
  type MapProvider,
} from "@/lib/map-provider";
import type { MapViewConfig } from "@/lib/open-map";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type { GoogleMapsPublicConfig } from "@/lib/types";

export function useMapProviderConfig(): {
  provider: MapProvider;
  mapEnabled: boolean;
  mapConfig: MapViewConfig;
  googleConfig: GoogleMapsPublicConfig | null;
  loading: boolean;
} {
  const [googleConfig, setGoogleConfig] = useState<GoogleMapsPublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiFetch<GoogleMapsPublicConfig>(apiRoutes.googleMapsPublicConfig)
      .then((data) => {
        configureGoogleMapsRuntime({ mapId: data.map_id });
        setGoogleConfig(data);
      })
      .catch(() => setGoogleConfig(null))
      .finally(() => setLoading(false));
  }, []);

  const provider = useMemo(() => resolveMapProvider(googleConfig), [googleConfig]);
  const mapConfig = useMemo(() => mapViewConfigFromGoogle(googleConfig), [googleConfig]);
  const mapEnabled = useMemo(
    () => isMapUiEnabled(provider, googleConfig),
    [provider, googleConfig],
  );

  return { provider, mapEnabled, mapConfig, googleConfig, loading };
}
