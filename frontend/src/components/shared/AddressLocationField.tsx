"use client";

import { LocationPicker } from "@/components/shared/LocationPicker";
import type { LatLng } from "@/lib/google-maps";
import { useGoogleMapsPublicConfig } from "@/lib/useGoogleMapsPublicConfig";

type AddressLocationFieldProps = {
  value: string | null | undefined;
  onChange: (text: string) => void;
  onCoordsChange?: (coords: LatLng | null) => void;
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
  /** Plain-text control when Google Maps is unavailable. */
  fallback?: "input" | "textarea";
  fallbackRows?: number;
  inputAutoComplete?: string;
};

export function AddressLocationField({
  value,
  onChange,
  onCoordsChange,
  label = "Location",
  placeholder = "Search for a location",
  required = false,
  disabled = false,
  variant = "inline",
  showMap = false,
  allowMapPin = true,
  hideHint = false,
  showCurrentLocation = false,
  fallback = "input",
  fallbackRows = 2,
  inputAutoComplete = "street-address",
}: AddressLocationFieldProps) {
  const { config, mapEnabled, loading } = useGoogleMapsPublicConfig();
  const safeValue = value ?? "";

  if (loading) {
    if (fallback === "textarea") {
      return (
        <textarea
          rows={fallbackRows}
          value={safeValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Loading Google Maps…"
          aria-label={label}
          disabled
        />
      );
    }

    return (
      <label className="sf-field">
        <span>{label}</span>
        <input type="text" value={safeValue} placeholder="Loading Google Maps…" disabled />
      </label>
    );
  }

  if (mapEnabled && config) {
    return (
      <LocationPicker
        config={config}
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
