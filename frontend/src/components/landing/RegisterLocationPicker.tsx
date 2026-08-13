"use client";

import { LocationPicker } from "@/components/shared/LocationPicker";
import type { GoogleMapsPublicConfig } from "@/lib/types";

type Coords = { lat: number; lng: number };

type RegisterLocationPickerProps = {
  config: GoogleMapsPublicConfig;
  value: string;
  onChange: (text: string) => void;
  onCoordsChange: (coords: Coords | null) => void;
};

export function RegisterLocationPicker({
  config,
  value,
  onChange,
  onCoordsChange,
}: RegisterLocationPickerProps) {
  return (
    <LocationPicker
      config={config}
      value={value}
      onChange={onChange}
      onCoordsChange={onCoordsChange}
      label="Business location"
      placeholder="Search for your shop location"
      required
      variant="waitlist"
      allowMapPin
    />
  );
}
