"use client";

import { useCallback, useMemo, useState } from "react";
import { MotorbikeRouteMap, type RouteQuoteState } from "@/components/shared/MotorbikeRouteMap";
import { LocationPicker } from "@/components/shared/LocationPicker";
import { deliveryFeeFromDistanceKm } from "@/lib/geo";
import type { RouteTravelPreference } from "@/lib/google-routes";
import type { LatLng } from "@/lib/google-maps";
import { formatMoney } from "@/lib/orders";
import type { GoogleMapsPublicConfig } from "@/lib/types";

type GoogleMapsPlaygroundProps = {
  config: GoogleMapsPublicConfig | null;
  deliveryFeePerKm: number | null;
  draft?: boolean;
};

const INITIAL_ROUTE_STATE: RouteQuoteState = {
  distanceKm: null,
  durationMinutes: null,
  travelMode: null,
  source: null,
  loading: false,
  error: null,
};

function routeModeLabel(mode: RouteQuoteState["travelMode"]): string {
  if (mode === "TWO_WHEELER") return "Motorbike route";
  if (mode === "DRIVING") return "Road route";
  if (mode === "DIRECTIONS") return "Road route";
  return "Route";
}

export function GoogleMapsPlayground({
  config,
  deliveryFeePerKm,
  draft = false,
}: GoogleMapsPlaygroundProps) {
  const [fromLabel, setFromLabel] = useState("");
  const [fromCoords, setFromCoords] = useState<LatLng | null>(null);
  const [toLabel, setToLabel] = useState("");
  const [toCoords, setToCoords] = useState<LatLng | null>(null);
  const [routeState, setRouteState] = useState<RouteQuoteState>(INITIAL_ROUTE_STATE);
  const [routePreference, setRoutePreference] = useState<RouteTravelPreference>("auto");

  const handleRouteChange = useCallback((next: RouteQuoteState) => {
    setRouteState(next);
  }, []);

  const pickerKey = useMemo(() => {
    if (!config?.api_key) return "no-key";
    return [
      config.api_key,
      config.default_center_lat,
      config.default_center_lng,
      config.default_zoom,
      config.default_country,
    ].join("|");
  }, [config]);

  const deliveryFee =
    routeState.distanceKm != null && deliveryFeePerKm != null
      ? deliveryFeeFromDistanceKm(routeState.distanceKm, deliveryFeePerKm)
      : null;

  function swapStops() {
    setFromLabel(toLabel);
    setToLabel(fromLabel);
    setFromCoords(toCoords);
    setToCoords(fromCoords);
  }

  if (!config?.api_key) {
    return (
      <div className="google-maps-playground google-maps-playground--empty">
        <p className="settings-muted google-maps-playground__empty">
          Enter a browser API key above to preview motorbike delivery routes and pricing.
        </p>
      </div>
    );
  }

  const hasQuote = routeState.distanceKm != null && !routeState.loading && !routeState.error;

  return (
    <div className="google-maps-playground google-maps-playground--ride">
      <div className="ride-preview">
        <div className="ride-preview__map-stage">
          <MotorbikeRouteMap
            className="ride-preview__map"
            config={config}
            from={fromCoords}
            to={toCoords}
            routePreference={routePreference}
            onRouteChange={handleRouteChange}
          />
          <div className="ride-preview__map-badge">
            <i className="fa-solid fa-motorcycle" aria-hidden="true" />
            {routeModeLabel(routeState.travelMode)}
          </div>
        </div>

        <div className="ride-preview__sheet">
          <div className="ride-preview__handle" aria-hidden="true" />

          <div className="ride-preview__mode-toggle" role="tablist" aria-label="Route type">
            <button
              type="button"
              role="tab"
              aria-selected={routePreference === "auto"}
              className={`ride-preview__mode-btn${
                routePreference === "auto" ? " is-active" : ""
              }`}
              onClick={() => setRoutePreference("auto")}
            >
              Auto
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={routePreference === "motorbike"}
              className={`ride-preview__mode-btn${
                routePreference === "motorbike" ? " is-active" : ""
              }`}
              onClick={() => setRoutePreference("motorbike")}
            >
              Motorbike
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={routePreference === "road"}
              className={`ride-preview__mode-btn${
                routePreference === "road" ? " is-active" : ""
              }`}
              onClick={() => setRoutePreference("road")}
            >
              Road
            </button>
          </div>

          <div className="ride-preview__stops-card">
            <div className="ride-preview__rail" aria-hidden="true">
              <span className="ride-preview__dot ride-preview__dot--pickup" />
              <span className="ride-preview__line" />
              <span className="ride-preview__dot ride-preview__dot--dropoff" />
            </div>

            <div className="ride-preview__fields">
              <LocationPicker
                key={`${pickerKey}-from`}
                config={config}
                value={fromLabel}
                onChange={setFromLabel}
                onCoordsChange={setFromCoords}
                label="Pickup location"
                placeholder="Pickup location"
                variant="ride"
                showMap={false}
                hideHint
                showCurrentLocation
              />
              <div className="ride-preview__divider" />
              <LocationPicker
                key={`${pickerKey}-to`}
                config={config}
                value={toLabel}
                onChange={setToLabel}
                onCoordsChange={setToCoords}
                label="Drop-off location"
                placeholder="Where to?"
                variant="ride"
                showMap={false}
                hideHint
              />
            </div>

            <button
              type="button"
              className="ride-preview__swap"
              onClick={swapStops}
              aria-label="Swap pickup and drop-off"
              title="Swap locations"
            >
              <i className="fa-solid fa-arrow-up-arrow-down" aria-hidden="true" />
            </button>
          </div>

          <div className="ride-preview__quote">
            <div className="ride-preview__meta">
              {routeState.loading ? (
                <span className="ride-preview__status">
                  <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" /> Calculating
                  road route…
                </span>
              ) : routeState.error ? (
                <span className="ride-preview__status ride-preview__status--error">
                  {routeState.error}
                </span>
              ) : hasQuote ? (
                <>
                  <span className="ride-preview__chip ride-preview__chip--distance">
                    <i className="fa-solid fa-road" aria-hidden="true" />
                    <span>
                      <strong>{routeState.distanceKm!.toFixed(2)} km</strong>
                      <small>by road</small>
                    </span>
                  </span>
                  {routeState.durationMinutes != null ? (
                    <span className="ride-preview__chip">
                      <i className="fa-regular fa-clock" aria-hidden="true" />
                      {Math.max(1, Math.round(routeState.durationMinutes))} min
                    </span>
                  ) : null}
                  <span className="ride-preview__chip ride-preview__chip--muted">
                    {routeModeLabel(routeState.travelMode)}
                  </span>
                </>
              ) : (
                <span className="ride-preview__status">
                  Enter pickup and drop-off to see road distance and fee
                </span>
              )}
            </div>

            <div className="ride-preview__fare-block">
              <span className="ride-preview__fare-label">Delivery fee</span>
              <strong className="ride-preview__fare">
                {deliveryFee != null
                  ? formatMoney(deliveryFee)
                  : deliveryFeePerKm == null
                    ? "Set rate"
                    : "—"}
              </strong>
              {deliveryFeePerKm != null ? (
                <span className="ride-preview__fare-rate">
                  {formatMoney(deliveryFeePerKm)} × {routeState.distanceKm?.toFixed(2) ?? "0"} km
                  {draft ? " · unsaved rate" : ""}
                </span>
              ) : (
                <span className="ride-preview__fare-rate">Set KES per km in delivery pricing</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
