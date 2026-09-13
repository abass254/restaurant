"use client";

import { FormEvent, useEffect, useState } from "react";
import { AddressLocationField } from "@/components/shared/AddressLocationField";
import { useAuthRefresh, useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { accountHasLocationCoordinates } from "@/lib/account-location";
import { showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type { LatLng } from "@/lib/google-maps";
import { useMapProviderConfig } from "@/lib/useMapProviderConfig";
import type { BusinessAccount } from "@/lib/types";

type BusinessLocationSectionProps = {
  account: BusinessAccount | null;
  onSaved?: () => void;
  hideSignedInAs?: boolean;
  /** Rider connection needs a pin; Basics keeps it optional. */
  requiredForRiders?: boolean;
};

export function BusinessLocationSection({
  account,
  onSaved,
  hideSignedInAs = false,
  requiredForRiders = false,
}: BusinessLocationSectionProps) {
  const user = useAuthUser();
  const refreshUser = useAuthRefresh();
  const { mapEnabled, loading: mapsLoading } = useMapProviderConfig();
  const [location, setLocation] = useState(account?.business_location ?? "");
  const [coords, setCoords] = useState<LatLng | null>(() =>
    account?.latitude != null && account?.longitude != null
      ? { lat: account.latitude, lng: account.longitude }
      : null,
  );
  const [saving, setSaving] = useState(false);

  const hasCoordinates = accountHasLocationCoordinates(account);

  useEffect(() => {
    setLocation(account?.business_location ?? "");
    setCoords(
      account?.latitude != null && account?.longitude != null
        ? { lat: account.latitude, lng: account.longitude }
        : null,
    );
  }, [account?.business_location, account?.latitude, account?.longitude]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();

    const trimmed = location.trim();
    if (!trimmed) {
      await showError("Location required", "Enter your shop location.");
      return;
    }

    if (!coords) {
      await showError(
        "Pin your shop on the map",
        "Search for your address or drop the pin so riders can find your store.",
      );
      return;
    }

    setSaving(true);
    try {
      await apiFetch(apiRoutes.settingsBusinessLocation, {
        method: "PATCH",
        body: JSON.stringify({
          business_location: trimmed,
          latitude: coords.lat,
          longitude: coords.lng,
        }),
      });
      await refreshUser();
      await toastSuccess("Store location saved");
      onSaved?.();
    } catch {
      await showError("Internal error", "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="settings-location-form" onSubmit={(e) => void handleSave(e)}>
      {!hasCoordinates ? (
        <div className="settings-location-form__alert" role="status">
          <i className="fa-solid fa-location-crosshairs" aria-hidden="true" />
          <div>
            <strong>
              {requiredForRiders
                ? "Store location is required for the rider app"
                : "Set your store location"}
            </strong>
            <p className="settings-muted">
              {requiredForRiders
                ? "Riders use this pin to navigate to your shop for pickup. Search or drop a pin, then save."
                : "Optional for most shops. You will need a map pin before inviting riders or dispatching deliveries."}
            </p>
          </div>
        </div>
      ) : null}

      {mapsLoading ? (
        <p className="settings-muted">Loading map…</p>
      ) : mapEnabled ? (
        <AddressLocationField
          value={location}
          onChange={setLocation}
          onCoordsChange={setCoords}
          coords={coords}
          label="Store location"
          placeholder="Search for your shop location"
          required
          variant="inline"
          allowMapPin
          showCurrentLocation
        />
      ) : (
        <p className="settings-muted">
          Maps are unavailable right now. Try again in a moment.
        </p>
      )}

      {coords ? (
        <p className="settings-muted settings-location-form__coords">
          Pin: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
        </p>
      ) : null}

      {mapEnabled ? (
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
            {saving ? "Saving…" : hasCoordinates ? "Update location" : "Save location"}
          </button>
        </div>
      ) : null}

      {!hideSignedInAs ? (
        <dl className="settings-grid settings-grid--compact">
          <div className="settings-grid__cell">
            <dt>Signed in as</dt>
            <dd>
              {user.name}
              <span className="settings-grid__sub">{user.email}</span>
            </dd>
          </div>
        </dl>
      ) : null}
    </form>
  );
}
