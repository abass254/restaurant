"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type { MapboxConfig, MapboxConfigResponse } from "@/lib/types";
import { Skeleton } from "./Skeleton";

type FormState = {
  access_token: string;
  map_style: string;
  default_center_lat: string;
  default_center_lng: string;
  default_zoom: string;
  default_country: string;
};

// Nairobi, Kenya — a sensible regional default for the merchant base.
const EMPTY_FORM: FormState = {
  access_token: "",
  map_style: "mapbox://styles/mapbox/streets-v12",
  default_center_lat: "-1.2921",
  default_center_lng: "36.8219",
  default_zoom: "11",
  default_country: "ke",
};

function num(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function MapboxSettingsSection() {
  const [config, setConfig] = useState<MapboxConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void apiFetch<MapboxConfigResponse>(apiRoutes.mapboxConfig)
      .then((data) => {
        setConfig(data.config);
        if (!data.config) {
          setEditing(true);
        }
      })
      .catch(() => setConfig(null))
      .finally(() => setLoaded(true));
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function startEdit() {
    if (config) {
      setForm({
        access_token: "",
        map_style: config.map_style ?? EMPTY_FORM.map_style,
        default_center_lat:
          config.default_center_lat != null ? String(config.default_center_lat) : "",
        default_center_lng:
          config.default_center_lng != null ? String(config.default_center_lng) : "",
        default_zoom: config.default_zoom != null ? String(config.default_zoom) : "",
        default_country: config.default_country ?? "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setEditing(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const data = await apiFetch<MapboxConfigResponse>(apiRoutes.mapboxConfig, {
        method: "PUT",
        body: JSON.stringify({
          access_token: form.access_token.trim(),
          map_style: form.map_style.trim() || EMPTY_FORM.map_style,
          default_center_lat: num(form.default_center_lat),
          default_center_lng: num(form.default_center_lng),
          default_zoom: num(form.default_zoom),
          default_country: form.default_country.trim() || null,
        }),
      });
      setConfig(data.config);
      setEditing(false);
      await toastSuccess("Mapbox settings saved");
    } catch (err) {
      await showError("Could not save", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const ok = await confirmAction(
      "Remove Mapbox config?",
      "The location map on the merchant registration form will fall back to a plain text field.",
      "Yes, remove",
    );
    if (!ok) return;
    setSaving(true);
    try {
      await apiFetch(apiRoutes.mapboxConfig, { method: "DELETE" });
      setConfig(null);
      setForm(EMPTY_FORM);
      setEditing(true);
      await toastSuccess("Mapbox config removed");
    } catch (err) {
      await showError("Could not remove", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <article className="settings-card" aria-busy="true" aria-live="polite">
        <header className="settings-card__head">
          <div className="settings-card__title">
            <i className="fa-solid fa-map-location-dot settings-card__icon" aria-hidden="true" />
            <h2>Mapbox</h2>
          </div>
          <Skeleton variant="text" height={22} width={88} />
        </header>
        <div className="settings-card__body">
          <Skeleton variant="text" height={12} width="90%" />
          <Skeleton variant="text" height={12} width="80%" short />
        </div>
      </article>
    );
  }

  return (
    <article className="settings-card">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <i className="fa-solid fa-map-location-dot settings-card__icon" aria-hidden="true" />
          <h2>Mapbox</h2>
        </div>
        {config ? (
          <span className="settings-pill settings-pill--ok">Configured</span>
        ) : (
          <span className="settings-pill settings-pill--warn">Not configured</span>
        )}
      </header>
      <div className="settings-card__body">
        <p className="settings-muted settings-card__lead">
          Add a public Mapbox token so merchants can pin their exact shop location on an
          interactive map while registering. The token is platform-wide and only editable by
          super admins.
        </p>

        {config && !editing ? (
          <>
            <div className="mpesa-summary">
              <div className="mpesa-summary__row">
                <div className="mpesa-summary__cell">
                  <span className="mpesa-summary__label">Access token</span>
                  <span className="mpesa-summary__value">
                    <code>{config.access_token_masked ?? "—"}</code>
                  </span>
                </div>
                <div className="mpesa-summary__cell mpesa-summary__cell--wide">
                  <span className="mpesa-summary__label">Map style</span>
                  <span className="mpesa-summary__value">
                    <code>{config.map_style}</code>
                  </span>
                </div>
                <div className="mpesa-summary__cell">
                  <span className="mpesa-summary__label">Default centre</span>
                  <span className="mpesa-summary__value">
                    {config.default_center_lat != null && config.default_center_lng != null ? (
                      <code>
                        {config.default_center_lat}, {config.default_center_lng}
                      </code>
                    ) : (
                      <span className="settings-muted">Not set</span>
                    )}
                  </span>
                </div>
                <div className="mpesa-summary__cell">
                  <span className="mpesa-summary__label">Default zoom</span>
                  <span className="mpesa-summary__value">
                    {config.default_zoom != null ? (
                      <code>{config.default_zoom}</code>
                    ) : (
                      <span className="settings-muted">Not set</span>
                    )}
                  </span>
                </div>
                <div className="mpesa-summary__cell">
                  <span className="mpesa-summary__label">Country bias</span>
                  <span className="mpesa-summary__value">
                    {config.default_country ? (
                      <code>{config.default_country.toUpperCase()}</code>
                    ) : (
                      <span className="settings-muted">None</span>
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div className="settings-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={startEdit}>
                <i className="fa-solid fa-pen" aria-hidden="true" />
                Edit
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger"
                onClick={() => void handleDelete()}
                disabled={saving}
              >
                <i className="fa-solid fa-trash" aria-hidden="true" />
                Remove
              </button>
            </div>
          </>
        ) : null}

        {editing ? (
          <form
            className="settings-form settings-form--compact"
            onSubmit={(e) => void handleSubmit(e)}
          >
            <label className="settings-field">
              <span>Public access token (pk.*)</span>
              <input
                type="text"
                required
                value={form.access_token}
                onChange={(e) => update("access_token", e.target.value)}
                placeholder={config ? "Enter to replace stored token" : "pk.eyJ1Ijoi…"}
                autoComplete="off"
              />
            </label>
            <label className="settings-field">
              <span>Map style URL</span>
              <input
                type="text"
                value={form.map_style}
                onChange={(e) => update("map_style", e.target.value)}
                placeholder="mapbox://styles/mapbox/streets-v12"
              />
            </label>
            <div className="settings-form__row">
              <label className="settings-field">
                <span>Default centre latitude</span>
                <input
                  type="number"
                  step="any"
                  value={form.default_center_lat}
                  onChange={(e) => update("default_center_lat", e.target.value)}
                  placeholder="-1.2921"
                />
              </label>
              <label className="settings-field">
                <span>Default centre longitude</span>
                <input
                  type="number"
                  step="any"
                  value={form.default_center_lng}
                  onChange={(e) => update("default_center_lng", e.target.value)}
                  placeholder="36.8219"
                />
              </label>
            </div>
            <div className="settings-form__row">
              <label className="settings-field">
                <span>Default zoom (0–22)</span>
                <input
                  type="number"
                  step="any"
                  min={0}
                  max={22}
                  value={form.default_zoom}
                  onChange={(e) => update("default_zoom", e.target.value)}
                  placeholder="11"
                />
              </label>
              <label className="settings-field">
                <span>Country bias (ISO code)</span>
                <input
                  type="text"
                  value={form.default_country}
                  onChange={(e) => update("default_country", e.target.value)}
                  placeholder="ke"
                  maxLength={10}
                />
              </label>
            </div>
            <div className="settings-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? "Saving…" : "Save Mapbox settings"}
              </button>
              {config ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
              ) : null}
            </div>
            <p className="settings-muted settings-card__hint">
              <i className="fa-solid fa-circle-info" aria-hidden="true" /> Need a token? Create a
              free account at{" "}
              <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noreferrer">
                account.mapbox.com
              </a>{" "}
              and copy the <strong>default public token</strong> (starts with{" "}
              <code>pk.</code>).
            </p>
          </form>
        ) : null}
      </div>
    </article>
  );
}
