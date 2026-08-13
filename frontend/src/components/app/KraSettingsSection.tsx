"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type { MerchantKraConfig, MerchantKraConfigResponse } from "@/lib/types";
import { Skeleton } from "./Skeleton";

type FormState = {
  enabled: boolean;
  kra_pin: string;
  control_unit_serial: string;
  branch_id: string;
  vat_registered: boolean;
};

const EMPTY_FORM: FormState = {
  enabled: false,
  kra_pin: "",
  control_unit_serial: "",
  branch_id: "",
  vat_registered: true,
};

export function KraSettingsSection() {
  const [config, setConfig] = useState<MerchantKraConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    void apiFetch<MerchantKraConfigResponse>(apiRoutes.kraBusinessConfig)
      .then((data) => {
        setConfig(data.config);
        if (data.config) {
          setForm({
            enabled: data.config.enabled,
            kra_pin: data.config.kra_pin ?? "",
            control_unit_serial: data.config.control_unit_serial ?? "",
            branch_id: data.config.branch_id ?? "",
            vat_registered: data.config.vat_registered,
          });
        }
      })
      .catch(() => setConfig(null))
      .finally(() => setLoaded(true));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const data = await apiFetch<MerchantKraConfigResponse>(apiRoutes.kraBusinessConfig, {
        method: "PUT",
        body: JSON.stringify({
          enabled: form.enabled,
          kra_pin: form.kra_pin || null,
          integration_type: config?.integration_type ?? "vscu",
          control_unit_serial: form.control_unit_serial || null,
          branch_id: form.branch_id || null,
          vat_registered: form.vat_registered,
          middleware_provider: config?.middleware_provider ?? null,
        }),
      });
      setConfig(data.config);
      await toastSuccess("KRA fiscal settings saved");
    } catch (err) {
      await showError("Could not save", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <article className="settings-card" aria-busy="true" aria-live="polite">
        <header className="settings-card__head">
          <div className="settings-card__title">
            <i className="fa-solid fa-file-invoice settings-card__icon" aria-hidden="true" />
            <h2>KRA ETR / TIMS</h2>
          </div>
        </header>
        <div className="settings-card__body">
          <Skeleton variant="text" height={12} width="90%" />
          <Skeleton variant="text" height={12} width="70%" short />
        </div>
      </article>
    );
  }

  const statusLabel = config?.is_configured
    ? "Ready"
    : config?.enabled
      ? "Incomplete"
      : "Disabled";
  const statusTone = config?.is_configured ? "ok" : config?.enabled ? "warn" : "off";

  return (
    <article className="settings-card">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <i className="fa-solid fa-file-invoice settings-card__icon" aria-hidden="true" />
          <h2>KRA ETR / TIMS</h2>
        </div>
        <span className={`settings-pill settings-pill--${statusTone}`}>{statusLabel}</span>
      </header>
      <div className="settings-card__body">
        <p className="settings-muted settings-card__lead">
          Add your shop&apos;s KRA PIN and TIMS control unit details for fiscal invoicing.
          Technical integration settings are configured by platform administrators.
        </p>

        <form className="settings-form settings-form--compact" onSubmit={(e) => void handleSubmit(e)}>
          <div className="settings-toggle settings-toggle--compact">
            <div className="settings-toggle__copy">
              <strong>Fiscal invoicing</strong>
              <span>
                {form.enabled
                  ? "Completed sales can be submitted to KRA using your TIMS details."
                  : "Turn on when you are registered for VAT and have a TIMS control unit."}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              className={`settings-toggle__switch${form.enabled ? " is-on" : ""}`}
              onClick={() => setForm((prev) => ({ ...prev, enabled: !prev.enabled }))}
            >
              <span className="settings-toggle__thumb" aria-hidden="true" />
              <span className="sr-only">
                {form.enabled ? "Disable fiscal invoicing" : "Enable fiscal invoicing"}
              </span>
            </button>
          </div>

          <div className="settings-form__row">
            <label className="settings-field">
              <span>KRA PIN</span>
              <input
                type="text"
                value={form.kra_pin}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    kra_pin: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="e.g. P051234567X"
                maxLength={20}
                required={form.enabled}
              />
            </label>
            <label className="settings-field">
              <span>Control unit serial</span>
              <input
                type="text"
                value={form.control_unit_serial}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    control_unit_serial: e.target.value.trim(),
                  }))
                }
                placeholder="From your TIMS device"
                required={form.enabled}
              />
            </label>
          </div>

          <label className="settings-field">
            <span>Branch ID (optional)</span>
            <input
              type="text"
              value={form.branch_id}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  branch_id: e.target.value.trim(),
                }))
              }
              placeholder="If you operate multiple branches"
            />
          </label>

          <label className="settings-field settings-field--checkbox">
            <input
              type="checkbox"
              checked={form.vat_registered}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  vat_registered: e.target.checked,
                }))
              }
            />
            <span>Business is VAT-registered with KRA</span>
          </label>

          <div className="settings-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? "Saving…" : "Save KRA settings"}
            </button>
          </div>

          <p className="settings-muted settings-card__hint">
            <i className="fa-solid fa-circle-info" aria-hidden="true" /> Register for TIMS at{" "}
            <a href="https://www.kra.go.ke/" target="_blank" rel="noreferrer">
              kra.go.ke
            </a>
            . You will receive a control unit serial from KRA or your certified middleware provider.
          </p>
        </form>
      </div>
    </article>
  );
}
