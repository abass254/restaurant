"use client";

import { FormEvent, useEffect, useState } from "react";
import { AddressLocationField } from "@/components/shared/AddressLocationField";
import { useAuthRefresh, useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { accountHasLocationCoordinates } from "@/lib/account-location";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type { LatLng } from "@/lib/google-maps";
import { useGoogleMapsPublicConfig } from "@/lib/useGoogleMapsPublicConfig";
import type { BusinessAccount } from "@/lib/types";

type BusinessLocationSectionProps = {
  account: BusinessAccount | null;
  onSaved?: () => void;
  hideSignedInAs?: boolean;
};

export function BusinessLocationSection({
  account,
  onSaved,
  hideSignedInAs = false,
}: BusinessLocationSectionProps) {
  const user = useAuthUser();
  const refreshUser = useAuthRefresh();
  const { mapEnabled, loading: mapsLoading } = useGoogleMapsPublicConfig();
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

    if (mapEnabled && !coords) {
      await showError(
        "Pin your shop on the map",
        "Search for your address or drop the pin so we can save accurate coordinates.",
      );
      return;
    }

    if (!coords) {
      await showError(
        "Google Maps required",
        "A platform Google Maps API key is needed before you can save shop coordinates.",
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
      await toastSuccess("Business location saved");
      onSaved?.();
    } catch (err) {
      await showError("Could not save location", extractErrorMessage(err));
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
            <strong>Set your shop location on the map</strong>
            <p className="settings-muted">
              Delivery fees and route previews need your exact coordinates. Pick your
              business address below.
            </p>
          </div>
        </div>
      ) : null}

      {mapsLoading ? (
        <p className="settings-muted">Loading Google Maps…</p>
      ) : mapEnabled ? (
        <AddressLocationField
          value={location}
          onChange={setLocation}
          onCoordsChange={setCoords}
          label="Business location"
          placeholder="Search for your shop location"
          required
          variant="inline"
          allowMapPin
        />
      ) : (
        <div className="settings-location-form__blocked">
          <p className="settings-muted">
            Google Maps is not configured yet. Ask your platform admin to add an API key
            under Settings → Google Maps so you can pin your shop location.
          </p>
          <dl className="settings-grid settings-grid--compact">
            <div className="settings-grid__cell">
              <dt>Current address</dt>
              <dd>{account?.business_location ?? "—"}</dd>
            </div>
          </dl>
        </div>
      )}

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
