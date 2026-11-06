"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/app/Skeleton";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import {
  defaultMapOptions,
  forwardGeocode,
  loadGoogleMaps,
  triggerMapResize,
  type GoogleMapsMap,
  type GoogleMapsMarker,
  type GoogleMapsRuntime,
  type LatLng,
} from "@/lib/google-maps";
import { STORE_MARKER } from "@/lib/google-maps-style";
import { attachStoreMarkerClusterer } from "@/lib/google-maps-cluster";
import { useGoogleMapsPublicConfig } from "@/lib/useGoogleMapsPublicConfig";
import type { MarkerClusterer } from "@googlemaps/markerclusterer";
import type { AdminMerchantSummary } from "@/lib/types";

type PlottedMerchant = {
  id: string;
  name: string;
  location: string;
  position: LatLng;
};

type AdminMerchantLocationsMapProps = {
  merchants: AdminMerchantSummary[];
  loading: boolean;
};

const FALLBACK_CENTER: LatLng = { lat: -1.2921, lng: 36.8219 };
const MERCHANT_MAP_ZOOM = 15;

/** Avoid re-geocoding the same merchant address within a browser session. */
const sessionResolvedCoords = new Map<string, LatLng>();

function applyDefaultMapView(map: GoogleMapsMap, center: LatLng, zoom: number): void {
  map.setCenter(center);
  map.setZoom(zoom);
}

function persistMerchantCoords(
  merchantId: string,
  position: LatLng,
  businessLocation?: string,
): void {
  sessionResolvedCoords.set(merchantId, position);
  void apiFetch(apiRoutes.adminMerchantCoords(merchantId), {
    method: "PATCH",
    body: JSON.stringify({
      latitude: position.lat,
      longitude: position.lng,
      ...(businessLocation ? { business_location: businessLocation } : {}),
    }),
  }).catch((error) => {
    console.warn("Could not persist merchant coordinates:", error);
  });
}

async function resolveMerchantPositions(
  merchants: AdminMerchantSummary[],
  runtime: GoogleMapsRuntime,
  country: string | null,
  proximity: LatLng,
): Promise<PlottedMerchant[]> {
  const plotted = await Promise.all(
    merchants.map(async (merchant): Promise<PlottedMerchant | null> => {
      if (merchant.latitude != null && merchant.longitude != null) {
        const position = { lat: merchant.latitude, lng: merchant.longitude };
        sessionResolvedCoords.set(merchant.id, position);
        return {
          id: merchant.id,
          name: merchant.business_name,
          location: merchant.business_location,
          position,
        };
      }

      const cached = sessionResolvedCoords.get(merchant.id);
      if (cached) {
        return {
          id: merchant.id,
          name: merchant.business_name,
          location: merchant.business_location,
          position: cached,
        };
      }

      if (!merchant.business_location.trim()) return null;

      const hit = await forwardGeocode(merchant.business_location, runtime, {
        country,
        proximity,
      });
      if (!hit) return null;

      const position = { lat: hit.lat, lng: hit.lng };
      persistMerchantCoords(
        merchant.id,
        position,
        hit.placeName || merchant.business_location,
      );

      return {
        id: merchant.id,
        name: merchant.business_name,
        location: hit.placeName || merchant.business_location,
        position,
      };
    }),
  );

  return plotted.filter((merchant): merchant is PlottedMerchant => merchant !== null);
}

export function AdminMerchantLocationsMap({
  merchants,
  loading,
}: AdminMerchantLocationsMapProps) {
  const { config, mapEnabled, loading: mapsLoading } = useGoogleMapsPublicConfig();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapsMap | null>(null);
  const markersRef = useRef<GoogleMapsMarker[]>([]);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const infoWindowRef = useRef<{ close: () => void; setContent: (html: string) => void; open: (opts: { map: GoogleMapsMap; anchor?: GoogleMapsMarker }) => void } | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [plottedCount, setPlottedCount] = useState(0);
  const [resolving, setResolving] = useState(false);

  const center = useMemo<LatLng>(
    () => ({
      lat: config?.default_center_lat ?? FALLBACK_CENTER.lat,
      lng: config?.default_center_lng ?? FALLBACK_CENTER.lng,
    }),
    [config?.default_center_lat, config?.default_center_lng],
  );
  const mapZoom = config?.default_zoom ?? MERCHANT_MAP_ZOOM;
  const apiKey = config?.api_key ?? "";
  const canRecenter = mapReady && !resolving;

  const recenterToMerchants = useCallback(() => {
    if (!mapRef.current) return;
    infoWindowRef.current?.close();
    applyDefaultMapView(mapRef.current, center, mapZoom);
  }, [center, mapZoom]);

  useEffect(() => {
    if (!apiKey || !containerRef.current || mapsLoading || loading) return;
    let cancelled = false;

    void loadGoogleMaps(apiKey)
      .then((runtime) => {
        if (cancelled || !containerRef.current) return;

        const map = new runtime.maps.Map(
          containerRef.current,
          defaultMapOptions(center, mapZoom, {
            requiresMapId: runtime.requiresMapId,
          }),
        );
        mapRef.current = map;

        const InfoWindow = (
          window.google?.maps as {
            InfoWindow?: new () => {
              close: () => void;
              setContent: (html: string) => void;
              open: (opts: { map: GoogleMapsMap; anchor?: GoogleMapsMarker }) => void;
            };
          }
        )?.InfoWindow;
        if (InfoWindow) {
          infoWindowRef.current = new InfoWindow();
        }

        triggerMapResize(map);
        setMapReady(true);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Merchant map failed to load:", error);
          setMapError("Map could not load.");
        }
      });

    return () => {
      cancelled = true;
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      infoWindowRef.current?.close();
      infoWindowRef.current = null;
      mapRef.current = null;
      setMapReady(false);
    };
  }, [apiKey, center, loading, mapZoom, mapsLoading]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !apiKey || loading) {
      if (!loading) setPlottedCount(0);
      return;
    }

    let cancelled = false;
    setResolving(merchants.length > 0);

    void loadGoogleMaps(apiKey)
      .then(async (runtime) => {
        if (cancelled || !mapRef.current) return;

        clustererRef.current?.clearMarkers();
        clustererRef.current = null;
        markersRef.current.forEach((marker) => marker.setMap(null));
        markersRef.current = [];
        infoWindowRef.current?.close();

        const map = mapRef.current;
        const plotted =
          merchants.length > 0
            ? await resolveMerchantPositions(
                merchants,
                runtime,
                config?.default_country ?? null,
                center,
              )
            : [];
        if (cancelled || !mapRef.current) return;
        for (const merchant of plotted) {
          const marker = runtime.createMarker({
            map: null,
            position: merchant.position,
            draggable: false,
            icon: STORE_MARKER,
          });

          marker.addListener("click", () => {
            const info = infoWindowRef.current;
            if (!info) return;
            info.setContent(
              `<div style="font-family:system-ui,sans-serif;line-height:1.4;max-width:240px;padding:2px 0">` +
                `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">` +
                `<span style="width:28px;height:28px;border-radius:9px;background:linear-gradient(145deg,#1f4a7f,#0b2545);` +
                `color:#fff;display:grid;place-items:center;font-size:13px;flex-shrink:0">` +
                `<i class="fas fa-store" aria-hidden="true"></i></span>` +
                `<strong style="display:block;font-size:14px;color:#061a33">${merchant.name}</strong>` +
                `</div>` +
                `<span style="color:#5b6478;font-size:13px;display:block;padding-left:36px">` +
                `${merchant.location}</span>` +
                `</div>`,
            );
            info.open({ map, anchor: marker });
          });

          markersRef.current.push(marker);
        }

        clustererRef.current = await attachStoreMarkerClusterer(map, markersRef.current);
        applyDefaultMapView(map, center, mapZoom);

        setPlottedCount(plotted.length);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Merchant markers failed to load:", error);
          clustererRef.current?.clearMarkers();
          clustererRef.current = null;
          if (mapRef.current) {
            applyDefaultMapView(mapRef.current, center, mapZoom);
          }
          setPlottedCount(0);
        }
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });

    return () => {
      cancelled = true;
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
    };
  }, [
    apiKey,
    center,
    config?.default_country,
    loading,
    mapReady,
    mapZoom,
    merchants,
  ]);

  useEffect(() => {
    if (!mapReady || !containerRef.current || !mapRef.current) return;

    const map = mapRef.current;
    const container = containerRef.current;
    const resize = () => triggerMapResize(map);

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => observer.disconnect();
  }, [mapReady]);

  const showSkeleton = loading || mapsLoading;
  const total = merchants.length;

  return (
    <article className="admin-map-card">
      <header className="admin-map-card__head">
        <div className="admin-map-card__title-wrap">
          <span className="admin-map-card__icon" aria-hidden="true">
            <i className="fas fa-store" />
          </span>
          <div>
            <h2 className="admin-map-card__title">Merchant locations</h2>
            <p className="admin-map-card__lead">
              {showSkeleton
                ? "Loading map…"
                : resolving
                  ? "Plotting stores on the map…"
                  : plottedCount > 0
                    ? `${plottedCount} of ${total} merchant${total === 1 ? "" : "s"} on map`
                    : "Default map view"}
            </p>
          </div>
        </div>
        <Link href="/admin/merchants" className="admin-section__link">
          View all <i className="fas fa-arrow-right" aria-hidden="true" />
        </Link>
      </header>

      <div className="admin-map-card__body">
        {showSkeleton ? (
          <Skeleton variant="rect" className="admin-map-card__map admin-map-card__map--skeleton" />
        ) : !mapEnabled ? (
          <div className="admin-map-card__empty">
            <i className="fas fa-map-location-dot" aria-hidden="true" />
            <p>
              Configure Google Maps in{" "}
              <Link href="/admin/settings">settings</Link> to show merchant locations.
            </p>
          </div>
        ) : mapError ? (
          <div className="admin-map-card__empty">
            <i className="fas fa-triangle-exclamation" aria-hidden="true" />
            <p>{mapError}</p>
          </div>
        ) : (
          <div className="admin-map-card__map-wrap">
            <button
              type="button"
              className="admin-map-card__recenter-btn"
              onClick={recenterToMerchants}
              disabled={!canRecenter}
              aria-label="Re-center map to merchant locations"
              title="Re-center map"
            >
              <i className="fas fa-location-crosshairs" aria-hidden="true" />
              Re-center
            </button>
            <div
              ref={containerRef}
              className="admin-map-card__map"
              role="img"
              aria-label="Map of merchant store locations"
            />
          </div>
        )}
      </div>
    </article>
  );
}
