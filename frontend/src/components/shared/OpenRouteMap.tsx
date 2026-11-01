"use client";

import { useEffect, useRef, useState } from "react";
import { TRANSCHAP_MAP_COLORS } from "@/lib/google-maps-style";
import {
  FALLBACK_CENTER,
  fetchOsrmRoute,
  loadMapLibre,
  OPEN_MAP_STYLE_URL,
  type LatLng,
  type MapLibreMap,
  type MapLibreMarker,
  type MapViewConfig,
} from "@/lib/open-map";
import type { RouteQuoteState } from "@/components/shared/MotorbikeRouteMap";

type OpenRouteMapProps = {
  config: MapViewConfig;
  from: LatLng | null;
  to: LatLng | null;
  className?: string;
  onRouteChange?: (route: RouteQuoteState) => void;
};

export function OpenRouteMap({
  config,
  from,
  to,
  className,
  onRouteChange,
}: OpenRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const fromMarkerRef = useRef<MapLibreMarker | null>(null);
  const toMarkerRef = useRef<MapLibreMarker | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const center: LatLng = {
    lat: config.default_center_lat ?? FALLBACK_CENTER.lat,
    lng: config.default_center_lng ?? FALLBACK_CENTER.lng,
  };
  const zoom = config.default_zoom ?? 11;

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    void loadMapLibre()
      .then((maplibregl) => {
        if (cancelled || !containerRef.current) return;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: OPEN_MAP_STYLE_URL,
          center: [center.lng, center.lat],
          zoom,
          attributionControl: true,
        });

        mapRef.current = map;
        fromMarkerRef.current = new maplibregl.Marker({ color: TRANSCHAP_MAP_COLORS.primary }).setLngLat([
          center.lng,
          center.lat,
        ]);
        toMarkerRef.current = new maplibregl.Marker({ color: TRANSCHAP_MAP_COLORS.brown700 }).setLngLat([
          center.lng,
          center.lat,
        ]);

        map.on("load", () => {
          if (cancelled) return;
          setReady(true);
          map.resize();
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Open route map failed to load:", error);
          setMapError(error instanceof Error ? error.message : "Route map could not load.");
        }
      });

    return () => {
      cancelled = true;
      fromMarkerRef.current?.remove();
      toMarkerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current) return;

    const map = mapRef.current;
    if (map.getLayer("route-line")) map.removeLayer("route-line");
    if (map.getSource("route")) map.removeSource("route");

    if (from && fromMarkerRef.current) {
      fromMarkerRef.current.setLngLat([from.lng, from.lat]).addTo(map);
    } else {
      fromMarkerRef.current?.remove();
    }

    if (to && toMarkerRef.current) {
      toMarkerRef.current.setLngLat([to.lng, to.lat]).addTo(map);
    } else {
      toMarkerRef.current?.remove();
    }

    if (!from || !to) {
      onRouteChange?.({
        distanceKm: null,
        durationMinutes: null,
        travelMode: null,
        source: null,
        loading: false,
        error: null,
      });
      if (from) map.flyTo({ center: [from.lng, from.lat], zoom: 14 });
      return;
    }

    let cancelled = false;
    onRouteChange?.({
      distanceKm: null,
      durationMinutes: null,
      travelMode: null,
      source: null,
      loading: true,
      error: null,
    });

    void fetchOsrmRoute(from, to)
      .then((result) => {
        if (cancelled || !mapRef.current) return;
        if (!result) {
          onRouteChange?.({
            distanceKm: null,
            durationMinutes: null,
            travelMode: null,
            source: null,
            loading: false,
            error: "Could not find a road route.",
          });
          return;
        }

        const coordinates = result.path.map((point) => [point.lng, point.lat]);
        map.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates },
          },
        });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": TRANSCHAP_MAP_COLORS.primary,
            "line-width": 5,
            "line-opacity": 0.92,
          },
        });

        const lngs = result.path.map((point) => point.lng);
        const lats = result.path.map((point) => point.lat);
        map.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: 48, duration: 0 },
        );

        onRouteChange?.({
          distanceKm: result.distanceKm,
          durationMinutes: result.durationMinutes,
          loading: false,
          error: null,
          travelMode: "DRIVING",
          source: "osrm",
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("OSRM route failed:", error);
        onRouteChange?.({
          distanceKm: null,
          durationMinutes: null,
          travelMode: null,
          source: null,
          loading: false,
          error: "Routing failed.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [from, to, ready, onRouteChange]);

  return (
    <div className={["motorbike-route-map", className].filter(Boolean).join(" ")}>
      <div ref={containerRef} className="motorbike-route-map__canvas" />
      {!ready && !mapError ? (
        <span className="motorbike-route-map__overlay">
          <i className="fas fa-circle-notch fa-spin" aria-hidden="true" /> Loading route map…
        </span>
      ) : null}
      {mapError ? <span className="motorbike-route-map__overlay">{mapError}</span> : null}
    </div>
  );
}
