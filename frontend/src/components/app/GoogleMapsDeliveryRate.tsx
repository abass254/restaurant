"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type { GoogleMapsConfig, GoogleMapsPublicConfig } from "@/lib/types";

type GoogleMapsDeliveryRateProps = {
  config: GoogleMapsConfig | null;
  publicConfig: GoogleMapsPublicConfig | null;
  draftRate?: number | null;
  onSaved: (rate: number | null, config: GoogleMapsConfig | null) => void;
};

function parseRate(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function GoogleMapsDeliveryRate({
  config,
  publicConfig,
  draftRate = null,
  onSaved,
}: GoogleMapsDeliveryRateProps) {
  const savedRate = config?.delivery_fee_per_km ?? publicConfig?.delivery_fee_per_km ?? null;
  const displayRate = draftRate ?? savedRate;
  const [rate, setRate] = useState(displayRate != null ? String(displayRate) : "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draftRate != null) {
      setRate(String(draftRate));
      return;
    }
    setRate(savedRate != null ? String(savedRate) : "");
  }, [draftRate, savedRate]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!config) {
      await showError(
        "Save Google Maps first",
        "Save your API key and map settings before setting a delivery rate.",
      );
      return;
    }

    const parsed = parseRate(rate);
    if (rate.trim() !== "" && parsed == null) {
      await showError("Invalid rate", "Enter a valid amount in KES per km.");
      return;
    }

    setSaving(true);
    try {
      const data = await apiFetch<{ config: GoogleMapsConfig }>(
        apiRoutes.googleMapsDeliveryRate,
        {
          method: "PATCH",
          body: JSON.stringify({ delivery_fee_per_km: parsed }),
        },
      );
      onSaved(parsed, data.config);
      await toastSuccess("Delivery rate saved");
    } catch (err) {
      await showError("Could not save rate", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="google-maps-rate-bar" onSubmit={(e) => void handleSave(e)}>
      <div className="google-maps-rate-bar__copy">
        <h3 className="google-maps-rate-bar__title">
          <i className="fa-solid fa-coins" aria-hidden="true" />
          Delivery pricing
        </h3>
        <p className="settings-muted google-maps-rate-bar__desc">
          Charge per road kilometre for motorbike deliveries. Used in the preview below.
        </p>
      </div>
      <label className="google-maps-rate-bar__field">
        <span>KES per km</span>
        <input
          type="number"
          step="any"
          min={0}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="e.g. 50"
        />
      </label>
      <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !config}>
        {saving ? "Saving…" : "Save rate"}
      </button>
    </form>
  );
}
