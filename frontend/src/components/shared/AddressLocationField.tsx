"use client";

import { LocationPicker } from "@/components/shared/LocationPicker";
import { OpenLocationPicker } from "@/components/shared/OpenLocationPicker";
import type { LatLng } from "@/lib/google-maps";
import { useMapProviderConfig } from "@/lib/useMapProviderConfig";

type AddressLocationFieldProps = {
  value: string | null | undefined;
  onChange: (text: string) => void;
  onCoordsChange?: (coords: LatLng | null) => void;
  coords?: LatLng | null;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  variant?: "waitlist" | "inline" | "ride";
  /** Force the map always open (costs a Dynamic Maps session). Prefer the Pin on map toggle. */
  showMap?: boolean;
  /** Offer Pin on map when the map is not forced open. */
  allowMapPin?: boolean;
  hideHint?: boolean;
  showCurrentLocation?: boolean;
  showStoreLocation?: boolean;
  storeLabel?: string;
  storeCoords?: LatLng | null;
  /** Plain-text control when Google Maps is unavailable. */
  fallback?: "input" | "textarea";
  fallbackRows?: number;
  inputAutoComplete?: string;
};

export function AddressLocationField({
  value,
  onChange,
  onCoordsChange,
  coords = null,
  label = "Location",
  placeholder = "Search for a location",
  required = false,
  disabled = false,
  variant = "inline",
  showMap = false,
  allowMapPin = true,
  hideHint = false,
  showCurrentLocation = false,
  showStoreLocation = false,
  storeLabel = "",
  storeCoords = null,
  fallback = "input",
  fallbackRows = 2,
  inputAutoComplete = "street-address",
}: AddressLocationFieldProps) {
  const { provider, mapEnabled, mapConfig, googleConfig, loading } =
    useMapProviderConfig();
  const safeValue = value ?? "";

  if (loading) {
    if (fallback === "textarea") {
      return (
        <textarea
          rows={fallbackRows}
          value={safeValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Loading map…"
          aria-label={label}
          disabled
        />
      );
    }

    return (
      <label className="sf-field">
        <span>{label}</span>
        <input type="text" value={safeValue} placeholder="Loading map…" disabled />
      </label>
    );
  }

  if (provider === "google" && mapEnabled && googleConfig) {
    return (
      <LocationPicker
        config={googleConfig}
        value={safeValue}
        onChange={onChange}
        onCoordsChange={onCoordsChange}
        label={label}
        placeholder={placeholder}
        required={required}
        variant={variant}
        disabled={disabled}
        showMap={showMap}
        allowMapPin={allowMapPin}
        hideHint={hideHint}
        showCurrentLocation={showCurrentLocation}
        showStoreLocation={showStoreLocation}
        storeLabel={storeLabel}
        storeCoords={storeCoords}
      />
    );
  }

  if (mapEnabled) {
    return (
      <OpenLocationPicker
        config={mapConfig}
        value={safeValue}
        onChange={onChange}
        onCoordsChange={onCoordsChange}
        coords={coords}
        label={label}
        placeholder={placeholder}
        required={required}
        variant={variant === "waitlist" ? "inline" : variant}
        disabled={disabled}
        showMap={showMap}
        allowMapPin={allowMapPin}
        hideHint={hideHint}
        showCurrentLocation={showCurrentLocation}
        showStoreLocation={showStoreLocation}
        storeLabel={storeLabel}
        storeCoords={storeCoords}
      />
    );
  }

  if (fallback === "textarea") {
    return (
      <textarea
        rows={fallbackRows}
        value={safeValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
      />
    );
  }

  return (
    <label className="sf-field">
      <span>{label}</span>
      <input
        type="text"
        autoComplete={inputAutoComplete}
        placeholder={placeholder}
        value={safeValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
      />
    </label>
  );
}
