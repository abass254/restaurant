"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultMapOptions,
  loadGoogleMaps,
  triggerMapResize,
  type GoogleMapsMap,
  type GoogleMapsMarker,
  type LatLng,
} from "@/lib/google-maps";
import { STORE_MARKER } from "@/lib/google-maps-style";
import { useGoogleMapsPublicConfig } from "@/lib/useGoogleMapsPublicConfig";
import type { RiderSummary } from "@/lib/types";
import { riderIsLiveOnline } from "@/lib/rider-presence";

type FleetPresenceMapProps = {
  riders: RiderSummary[];
  shop?: LatLng | null;
};

const FALLBACK_CENTER: LatLng = { lat: -1.2921, lng: 36.8219 };

export function FleetPresenceMap({ riders, shop }: FleetPresenceMapProps) {
  const { config, mapEnabled, loading: mapsLoading } = useGoogleMapsPublicConfig();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapsMap | null>(null);
  const markersRef = useRef<GoogleMapsMarker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const plotted = useMemo(
    () =>
      riders.filter(
        (rider) =>
          riderIsLiveOnline(rider) &&
          typeof rider.last_lat === "number" &&
          typeof rider.last_lng === "number",
      ),
    [riders],
  );

  const center = useMemo<LatLng>(() => {
    if (shop) return shop;
    if (plotted[0]?.last_lat != null && plotted[0]?.last_lng != null) {
      return { lat: plotted[0].last_lat, lng: plotted[0].last_lng };
    }
    return {
      lat: config?.default_center_lat ?? FALLBACK_CENTER.lat,
      lng: config?.default_center_lng ?? FALLBACK_CENTER.lng,
    };
  }, [config?.default_center_lat, config?.default_center_lng, plotted, shop]);

  const apiKey = config?.api_key ?? "";
  const zoom = config?.default_zoom ?? 13;

  useEffect(() => {
    if (!apiKey || !containerRef.current || mapsLoading || !mapEnabled) return;
    let cancelled = false;

    void loadGoogleMaps(apiKey)
      .then((runtime) => {
        if (cancelled || !containerRef.current) return;
        const map = new runtime.maps.Map(
          containerRef.current,
          defaultMapOptions(center, zoom, { requiresMapId: runtime.requiresMapId }),
        );
        mapRef.current = map;
        triggerMapResize(map);
        setMapReady(true);
        setMapError(null);
      })
      .catch(() => {
        if (!cancelled) setMapError("Map could not load.");
      });

    return () => {
      cancelled = true;
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      mapRef.current = null;
      setMapReady(false);
    };
  }, [apiKey, center, mapEnabled, mapsLoading, zoom]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !apiKey) return;
    let cancelled = false;

    void loadGoogleMaps(apiKey).then((runtime) => {
      if (cancelled || !mapRef.current) return;

      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];

      const points: LatLng[] = [];
      if (shop) {
        points.push(shop);
        markersRef.current.push(
          runtime.createMarker({
            map: mapRef.current!,
            position: shop,
            icon: STORE_MARKER,
          }),
        );
      }

      for (const rider of plotted) {
        const position = { lat: rider.last_lat!, lng: rider.last_lng! };
        points.push(position);
        markersRef.current.push(
          runtime.createMarker({
            map: mapRef.current!,
            position,
          }),
        );
      }

      if (points.length === 0) {
        mapRef.current.setCenter(center);
        mapRef.current.setZoom(zoom);
        return;
      }

      if (points.length === 1) {
        mapRef.current.setCenter(points[0]);
        mapRef.current.setZoom(Math.max(zoom, 14));
        return;
      }

      const mapWithBounds = mapRef.current as GoogleMapsMap & {
        fitBounds?: (bounds: unknown, padding?: number) => void;
      };
      const LatLngBounds = (
        window.google?.maps as {
          LatLngBounds?: new () => {
            extend: (point: LatLng) => void;
          };
        }
      )?.LatLngBounds;
      if (!LatLngBounds || !mapWithBounds.fitBounds) {
        mapRef.current.setCenter(points[0]);
        return;
      }
      const bounds = new LatLngBounds();
      for (const point of points) bounds.extend(point);
      mapWithBounds.fitBounds(bounds, 48);
    });

    return () => {
      cancelled = true;
    };
  }, [apiKey, center, mapReady, plotted, shop, zoom]);

  if (mapsLoading) {
    return <p className="settings-muted">Loading fleet map…</p>;
  }

  if (!mapEnabled) {
    return (
      <p className="settings-muted">
        Google Maps is not configured yet, so live rider positions cannot be shown on a map.
      </p>
    );
  }

  return (
    <div className="fleet-map">
      <div className="fleet-map__head">
        <strong>Live fleet map</strong>
        <span className="app-muted">
          {plotted.length > 0
            ? `${plotted.length} online rider${plotted.length === 1 ? "" : "s"} with location`
            : "Waiting for online riders with GPS"}
        </span>
      </div>
      {mapError ? <p className="settings-muted">{mapError}</p> : null}
      <div ref={containerRef} className="fleet-map__canvas" role="presentation" />
    </div>
  );
}
