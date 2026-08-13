"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { configureGoogleMapsRuntime } from "@/lib/google-maps";
import type {
  GoogleMapsConfig,
  GoogleMapsConfigResponse,
  GoogleMapsPublicConfig,
  GoogleMapsTestResponse,
} from "@/lib/types";
import { GoogleMapsPlayground } from "./GoogleMapsPlayground";
import { GoogleMapsDeliveryRate } from "./GoogleMapsDeliveryRate";
import { Skeleton } from "./Skeleton";

type FormState = {
  api_key: string;
  default_center_lat: string;
  default_center_lng: string;
  default_zoom: string;
  default_country: string;
  delivery_fee_per_km: string;
};

const EMPTY_FORM: FormState = {
  api_key: "",
  default_center_lat: "-1.2921",
  default_center_lng: "36.8219",
  default_zoom: "11",
  default_country: "ke",
  delivery_fee_per_km: "",
};

function num(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function previewConfigFromState(
  editing: boolean,
  form: FormState,
  config: GoogleMapsConfig | null,
  publicConfig: GoogleMapsPublicConfig | null,
): { config: GoogleMapsPublicConfig | null; draft: boolean } {
  const draftApiKey = editing && form.api_key.trim() ? form.api_key.trim() : null;
  const apiKey = draftApiKey ?? publicConfig?.api_key ?? null;
  if (!apiKey) {
    return { config: null, draft: false };
  }

  const useFormDefaults = editing;
  const centerLat = useFormDefaults
    ? num(form.default_center_lat)
    : (config?.default_center_lat ?? publicConfig?.default_center_lat ?? null);
  const centerLng = useFormDefaults
    ? num(form.default_center_lng)
    : (config?.default_center_lng ?? publicConfig?.default_center_lng ?? null);
  const zoom = useFormDefaults
    ? num(form.default_zoom)
    : (config?.default_zoom ?? publicConfig?.default_zoom ?? null);
  const country = useFormDefaults
    ? form.default_country.trim().toLowerCase() || null
    : (config?.default_country ?? publicConfig?.default_country ?? null);

  const draft =
    Boolean(draftApiKey) ||
    (editing &&
      (form.default_center_lat !==
        (config?.default_center_lat != null ? String(config.default_center_lat) : "") ||
        form.default_center_lng !==
          (config?.default_center_lng != null ? String(config.default_center_lng) : "") ||
        form.default_zoom !==
          (config?.default_zoom != null ? String(config.default_zoom) : "") ||
        form.default_country !== (config?.default_country ?? "") ||
        form.delivery_fee_per_km !==
          (config?.delivery_fee_per_km != null ? String(config.delivery_fee_per_km) : "")));

  return {
    config: {
      api_key: apiKey,
      map_id: publicConfig?.map_id ?? null,
      default_center_lat: centerLat,
      default_center_lng: centerLng,
      default_zoom: zoom,
      default_country: country,
      delivery_fee_per_km: null,
    },
    draft,
  };
}

function resolveDeliveryFeePerKm(
  editing: boolean,
  form: FormState,
  config: GoogleMapsConfig | null,
  publicConfig: GoogleMapsPublicConfig | null,
): number | null {
  if (editing) {
    return num(form.delivery_fee_per_km);
  }
  return config?.delivery_fee_per_km ?? publicConfig?.delivery_fee_per_km ?? null;
}

export function GoogleMapsSettingsSection() {
  const [config, setConfig] = useState<GoogleMapsConfig | null>(null);
  const [publicConfig, setPublicConfig] = useState<GoogleMapsPublicConfig | null>(null);
  const publicActive = Boolean(publicConfig?.api_key);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<GoogleMapsTestResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pending = 2;

    const finish = () => {
      pending -= 1;
      if (!cancelled && pending <= 0) {
        setLoaded(true);
      }
    };

    void apiFetch<GoogleMapsPublicConfig>(apiRoutes.googleMapsPublicConfig)
      .then((publicData) => {
        if (cancelled) return;
        configureGoogleMapsRuntime({ mapId: publicData.map_id });
        setPublicConfig(publicData);
      })
      .catch(() => {
        if (!cancelled) setPublicConfig(null);
      })
      .finally(finish);

    void apiFetch<GoogleMapsConfigResponse>(apiRoutes.googleMapsConfig)
      .then((adminData) => {
        if (cancelled) return;
        setConfig(adminData.config);
        if (!adminData.config) {
          setEditing(true);
        }
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      })
      .finally(finish);

    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function startEdit() {
    if (config) {
      setForm({
        api_key: "",
        default_center_lat:
          config.default_center_lat != null ? String(config.default_center_lat) : "",
        default_center_lng:
          config.default_center_lng != null ? String(config.default_center_lng) : "",
        default_zoom: config.default_zoom != null ? String(config.default_zoom) : "",
        default_country: config.default_country ?? "",
        delivery_fee_per_km:
          config.delivery_fee_per_km != null ? String(config.delivery_fee_per_km) : "",
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
      const data = await apiFetch<GoogleMapsConfigResponse>(apiRoutes.googleMapsConfig, {
        method: "PUT",
        body: JSON.stringify({
          api_key: form.api_key.trim(),
          default_center_lat: num(form.default_center_lat),
          default_center_lng: num(form.default_center_lng),
          default_zoom: num(form.default_zoom),
          default_country: form.default_country.trim() || null,
          delivery_fee_per_km: num(form.delivery_fee_per_km),
        }),
      });
      setConfig(data.config);
      setEditing(false);
      const publicData = await apiFetch<GoogleMapsPublicConfig>(apiRoutes.googleMapsPublicConfig);
      configureGoogleMapsRuntime({ mapId: publicData.map_id });
      setPublicConfig(publicData);
      await toastSuccess("Google Maps settings saved");
    } catch (err) {
      await showError("Could not save", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const body =
        editing && form.api_key.trim()
          ? { api_key: form.api_key.trim() }
          : {};
      const data = await apiFetch<GoogleMapsTestResponse>(apiRoutes.googleMapsTest, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setTestResult(data);
      if (data.ok) {
        await toastSuccess("Google Maps API key verified");
      } else {
        await showError("API key check failed", data.message);
      }
    } catch (err) {
      await showError("Could not test API key", extractErrorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  const preview = useMemo(
    () => previewConfigFromState(editing, form, config, publicConfig),
    [editing, form, config, publicConfig],
  );
  const deliveryFeePerKm = useMemo(
    () => resolveDeliveryFeePerKm(editing, form, config, publicConfig),
    [editing, form, config, publicConfig],
  );

  async function handleDelete() {
    const ok = await confirmAction(
      "Remove Google Maps config?",
      "Location pickers will fall back to plain text fields unless a GOOGLE_MAPS_API_KEY env var is set.",
      "Yes, remove",
    );
    if (!ok) return;
    setSaving(true);
    try {
      await apiFetch(apiRoutes.googleMapsConfig, { method: "DELETE" });
      setConfig(null);
      const publicData = await apiFetch<GoogleMapsPublicConfig>(apiRoutes.googleMapsPublicConfig);
      configureGoogleMapsRuntime({ mapId: publicData.map_id });
      setPublicConfig(publicData);
      setForm(EMPTY_FORM);
      setEditing(true);
      await toastSuccess("Google Maps config removed");
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
            <h2>Google Maps</h2>
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
          <h2>Google Maps</h2>
        </div>
        {config ? (
          <span className="settings-pill settings-pill--ok">Configured</span>
        ) : publicActive ? (
          <span className="settings-pill settings-pill--ok">Active (env)</span>
        ) : (
          <span className="settings-pill settings-pill--warn">Not configured</span>
        )}
      </header>
      <div className="settings-card__body">
        <p className="settings-muted settings-card__lead">
          Add a browser-restricted Google Maps API key so merchants can pin locations on
          interactive maps during registration, POS delivery, and order tracking. The key is
          platform-wide and only editable by super admins.
          {!config && publicActive ? (
            <>
              {" "}
              Location pickers are currently using a key from the server environment (
              <code>GOOGLE_MAPS_API_KEY</code>). Save below to store it in the database
              so UAT/production stay in sync without redeploying.
            </>
          ) : null}
          {!config && !publicActive ? (
            <>
              {" "}
              Until a key is saved here (or set as <code>GOOGLE_MAPS_API_KEY</code> on the
              server), location pickers and autocomplete will not work.
            </>
          ) : null}
        </p>

        {config && !editing ? (
          <>
            <div className="mpesa-summary">
              <div className="mpesa-summary__row">
                <div className="mpesa-summary__cell">
                  <span className="mpesa-summary__label">API key</span>
                  <span className="mpesa-summary__value">
                    <code>{config.api_key_masked ?? "—"}</code>
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
                <div className="mpesa-summary__cell">
                  <span className="mpesa-summary__label">Delivery rate</span>
                  <span className="mpesa-summary__value">
                    {config.delivery_fee_per_km != null ? (
                      <code>KES {config.delivery_fee_per_km} / km</code>
                    ) : (
                      <span className="settings-muted">Not set</span>
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleTest()}
                disabled={testing || saving || (!config && !publicActive && !form.api_key.trim())}
              >
                <i className="fa-solid fa-bolt" aria-hidden="true" />
                {testing ? "Testing…" : "Test API key"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={startEdit}>
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
            {testResult ? (
              <ul className="settings-checklist settings-card__hint">
                {testResult.checks.map((check) => (
                  <li key={check.id}>
                    <span
                      className={`settings-pill settings-pill--${
                        check.ok ? "ok" : "warn"
                      }`}
                    >
                      {check.ok ? "OK" : "Failed"}
                    </span>
                    <strong>{check.label}</strong>
                    <span className="settings-muted"> — {check.detail}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {editing ? (
          <form
            className="settings-form settings-form--compact"
            onSubmit={(e) => void handleSubmit(e)}
          >
            <label className="settings-field">
              <span>Browser API key</span>
              <input
                type="text"
                required
                value={form.api_key}
                onChange={(e) => update("api_key", e.target.value)}
                placeholder={config ? "Enter to replace stored key" : "AIza…"}
                autoComplete="off"
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
            <label className="settings-field">
              <span>Delivery fee per km (KES)</span>
              <input
                type="number"
                step="any"
                min={0}
                value={form.delivery_fee_per_km}
                onChange={(e) => update("delivery_fee_per_km", e.target.value)}
                placeholder="e.g. 50"
              />
            </label>
            <div className="settings-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? "Saving…" : "Save Google Maps settings"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void handleTest()}
                disabled={testing || saving || !form.api_key.trim()}
              >
                <i className="fa-solid fa-bolt" aria-hidden="true" />
                {testing ? "Testing…" : "Test API key"}
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
            {testResult ? (
              <ul className="settings-checklist settings-card__hint">
                {testResult.checks.map((check) => (
                  <li key={check.id}>
                    <span
                      className={`settings-pill settings-pill--${
                        check.ok ? "ok" : "warn"
                      }`}
                    >
                      {check.ok ? "OK" : "Failed"}
                    </span>
                    <strong>{check.label}</strong>
                    <span className="settings-muted"> — {check.detail}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="settings-muted settings-card__hint">
              <i className="fa-solid fa-circle-info" aria-hidden="true" /> Enable{" "}
              <strong>Maps JavaScript API</strong>, <strong>Places API (New)</strong>,{" "}
              <strong>Geocoding API</strong>, <strong>Routes API</strong>, and{" "}
              <strong>Directions API</strong> in{" "}
              <a
                href="https://console.cloud.google.com/google/maps-apis"
                target="_blank"
                rel="noreferrer"
              >
                Google Cloud Console
              </a>
              . Billing must be enabled on the project.
            </p>
          </form>
        ) : null}

        {config || publicActive ? (
          <GoogleMapsDeliveryRate
            config={config}
            publicConfig={publicConfig}
            draftRate={editing ? num(form.delivery_fee_per_km) : null}
            onSaved={(rate, nextConfig) => {
              if (nextConfig) setConfig(nextConfig);
              setPublicConfig((prev) =>
                prev ? { ...prev, delivery_fee_per_km: rate } : prev,
              );
            }}
          />
        ) : null}

        <GoogleMapsPlayground
          config={preview.config}
          deliveryFeePerKm={deliveryFeePerKm}
          draft={preview.draft}
        />
      </div>
    </article>
  );
}
