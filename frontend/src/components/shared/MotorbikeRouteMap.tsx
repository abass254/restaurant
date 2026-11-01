"use client";

import { useEffect, useRef, useState } from "react";
import {
  fetchComputedRoute,
  type RouteTravelPreference,
  type RoadRouteResult,
} from "@/lib/google-routes";
import {
  createMapWithMarker,
  loadGoogleMaps,
  setMarkerPosition,
  triggerMapResize,
  type GoogleMapsMap,
  type GoogleMapsMarker,
  type LatLng,
} from "@/lib/google-maps";
import { TRANSCHAP_MAP_COLORS, TRANSCHAP_MAP_MARKER_ICON } from "@/lib/google-maps-style";
import type { GoogleMapsPublicConfig } from "@/lib/types";

export type RouteQuoteState = {
  distanceKm: number | null;
  durationMinutes: number | null;
  travelMode: string | null;
  source: string | null;
  loading: boolean;
  error: string | null;
};

type MotorbikeRouteMapProps = {
  config: GoogleMapsPublicConfig;
  from: LatLng | null;
  to: LatLng | null;
  routePreference?: RouteTravelPreference;
  className?: string;
  onRouteChange?: (route: RouteQuoteState) => void;
};

const FALLBACK_CENTER: LatLng = { lat: -1.2921, lng: 36.8219 };

type MapPolyline = { setMap: (map: GoogleMapsMap | null) => void };

async function drawPathPolyline(map: GoogleMapsMap, path: LatLng[]): Promise<MapPolyline | null> {
  if (!path.length || !window.google?.maps?.importLibrary) return null;

  const mapsLib = (await window.google.maps.importLibrary("maps")) as {
    Polyline?: new (options: Record<string, unknown>) => { setMap: (map: GoogleMapsMap | null) => void };
  };
  if (!mapsLib.Polyline) return null;

  const polyline = new mapsLib.Polyline({
    path,
    geodesic: true,
    strokeColor: TRANSCHAP_MAP_COLORS.primary,
    strokeOpacity: 0.92,
    strokeWeight: 5,
    map,
  });

  return { setMap: (target) => polyline.setMap(target) };
}

export function MotorbikeRouteMap({
  config,
  from,
  to,
  routePreference = "auto",
  className,
  onRouteChange,
}: MotorbikeRouteMapProps) {
  const apiKey = config.api_key ?? "";
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapsMap | null>(null);
  const fromMarkerRef = useRef<GoogleMapsMarker | null>(null);
  const toMarkerRef = useRef<GoogleMapsMarker | null>(null);
  const polylinesRef = useRef<MapPolyline[]>([]);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const center: LatLng = {
    lat: config.default_center_lat ?? FALLBACK_CENTER.lat,
    lng: config.default_center_lng ?? FALLBACK_CENTER.lng,
  };
  const zoom = config.default_zoom ?? 11;

  useEffect(() => {
    if (!apiKey || !containerRef.current) return;
    let cancelled = false;

    void loadGoogleMaps(apiKey)
      .then((runtime) => {
        if (cancelled || !containerRef.current) return;

        const { map, marker } = createMapWithMarker(
          runtime,
          containerRef.current,
          center,
          zoom,
          false,
        );
        mapRef.current = map;
        fromMarkerRef.current = marker;

        toMarkerRef.current = runtime.createMarker({
          map,
          position: center,
          draggable: false,
          icon: {
            ...TRANSCHAP_MAP_MARKER_ICON,
            fillColor: TRANSCHAP_MAP_COLORS.brown700,
          },
        });
        toMarkerRef.current.setMap(null);

        triggerMapResize(map);
        setReady(true);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Route map failed to load:", error);
          const message =
            error instanceof Error ? error.message : "Route map could not load.";
          setMapError(message);
        }
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((line) => line.setMap(null));
      polylinesRef.current = [];
      fromMarkerRef.current?.setMap(null);
      toMarkerRef.current?.setMap(null);
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;

    const resize = () => {
      if (mapRef.current) triggerMapResize(mapRef.current);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [ready, apiKey]);

  useEffect(() => {
    if (!ready || !apiKey || !mapRef.current) return;

    polylinesRef.current.forEach((line) => line.setMap(null));
    polylinesRef.current = [];

    if (fromMarkerRef.current) {
      if (from) {
        setMarkerPosition(fromMarkerRef.current, from);
        fromMarkerRef.current.setMap(mapRef.current);
      } else {
        fromMarkerRef.current.setMap(null);
      }
    }

    if (toMarkerRef.current) {
      if (to) {
        setMarkerPosition(toMarkerRef.current, to);
        toMarkerRef.current.setMap(mapRef.current);
      } else {
        toMarkerRef.current.setMap(null);
      }
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
      if (from) {
        mapRef.current.setCenter(from);
        mapRef.current.setZoom(14);
      }
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

    void fetchComputedRoute(apiKey, from, to, routePreference)
      .then(async (payload) => {
        if (cancelled || !mapRef.current) return;

        if (!payload) {
          onRouteChange?.({
            distanceKm: null,
            durationMinutes: null,
            travelMode: null,
            source: null,
            loading: false,
            error:
              "Could not find a road route. Enable Routes API and Directions API in Google Cloud Console.",
          });
          return;
        }

        if (payload.route?.createPolylines) {
          polylinesRef.current = payload.route
            .createPolylines({
              polylineOptions: {
                strokeColor: TRANSCHAP_MAP_COLORS.primary,
                strokeOpacity: 0.92,
                strokeWeight: 5,
              },
            })
            .map((polyline) => {
              polyline.setMap(mapRef.current);
              return { setMap: (target) => polyline.setMap(target) };
            });
        } else if (payload.result.path.length > 0) {
          const polyline = await drawPathPolyline(mapRef.current, payload.result.path);
          if (polyline) polylinesRef.current = [polyline];
        }

        const boundsLib = (await window.google!.maps.importLibrary("core")) as {
          LatLngBounds: new () => { extend: (point: LatLng) => void };
        };
        const bounds = new boundsLib.LatLngBounds();
        bounds.extend(from);
        bounds.extend(to);
        payload.result.path.forEach((point) => bounds.extend(point));
        (mapRef.current as GoogleMapsMap & { fitBounds?: (b: unknown) => void }).fitBounds?.(
          bounds,
        );

        onRouteChange?.({
          distanceKm: payload.result.distanceKm,
          durationMinutes: payload.result.durationMinutes,
          travelMode: payload.result.travelMode,
          source: payload.result.source,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Route computation failed:", error);
        onRouteChange?.({
          distanceKm: null,
          durationMinutes: null,
          travelMode: null,
          source: null,
          loading: false,
          error: "Routing failed. Enable Routes API and Directions API in Google Cloud Console.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey, from, ready, routePreference, to, onRouteChange]);

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
