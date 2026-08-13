"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type {
  MerchantMpesaConfig,
  MerchantMpesaConfigResponse,
  MpesaConfig,
  MpesaConfigResponse,
} from "@/lib/types";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import { MpesaMoneyFlow } from "./MpesaMoneyFlow";
import { Skeleton } from "./Skeleton";

type MerchantFormState = {
  shortcode: string;
  shortcode_type: MerchantPayoutType;
  account_number: string;
};

type MerchantPayoutType = "paybill" | "till" | "pochi";

const EMPTY_MERCHANT_FORM: MerchantFormState = {
  shortcode: "",
  shortcode_type: "paybill",
  account_number: "",
};

type MpesaSettingsSectionProps = {
  mode?: "merchant" | "admin";
};

export function MpesaSettingsSection({ mode = "merchant" }: MpesaSettingsSectionProps) {
  if (mode === "admin") {
    return <AdminMpesaSettingsSection />;
  }
  return <MerchantMpesaSettingsSection />;
}

function MerchantMpesaSettingsSection() {
  const [config, setConfig] = useState<MerchantMpesaConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<MerchantFormState>(EMPTY_MERCHANT_FORM);

  useEffect(() => {
    void apiFetch<MerchantMpesaConfigResponse>(apiRoutes.mpesaBusinessConfig)
      .then((data) => {
        setConfig(data.config);
        if (data.config) {
          setForm({
            shortcode: data.config.shortcode,
            shortcode_type: (
              ["paybill", "till", "pochi"] as const
            ).includes(data.config.shortcode_type as MerchantPayoutType)
              ? (data.config.shortcode_type as MerchantPayoutType)
              : "paybill",
            account_number: data.config.account_number ?? "",
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
      const data = await apiFetch<MerchantMpesaConfigResponse>(apiRoutes.mpesaBusinessConfig, {
        method: "PUT",
        body: JSON.stringify({
          shortcode: form.shortcode,
          shortcode_type: form.shortcode_type,
          account_number: form.account_number,
        }),
      });
      setConfig(data.config);
      await toastSuccess("M-PESA settlement details saved");
    } catch (err) {
      await showError("Could not save", extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const destinationMeta: Record<
    MerchantPayoutType,
    { label: string; hint: string; field: string; placeholder: string }
  > = {
    pochi: {
      label: "Pochi la Biashara",
      hint: "Funds go to the phone number linked to your Pochi wallet.",
      field: "Pochi phone number",
      placeholder: "07XXXXXXXX or 2547XXXXXXXX",
    },
    till: {
      label: "Till / Buy Goods",
      hint: "Funds go to your Lipa Na M-PESA Till number.",
      field: "Till number",
      placeholder: "e.g. 5575731",
    },
    paybill: {
      label: "Paybill",
      hint: "Funds go to your business Paybill shortcode.",
      field: "Paybill number",
      placeholder: "e.g. 123456",
    },
  };

  const activeDestination = destinationMeta[form.shortcode_type];

  if (!loaded) {
    return (
      <article className="settings-card" aria-busy="true" aria-live="polite">
        <header className="settings-card__head">
          <div className="settings-card__title">
            <i className="fa-solid fa-mobile-screen settings-card__icon" aria-hidden="true" />
            <h2>M-PESA settlement</h2>
          </div>
        </header>
        <div className="settings-card__body">
          <Skeleton variant="text" height={12} width="90%" />
          <Skeleton variant="text" height={12} width="70%" short />
        </div>
      </article>
    );
  }

  return (
    <article className="settings-card">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <i className="fa-solid fa-mobile-screen settings-card__icon" aria-hidden="true" />
          <h2>M-PESA settlement</h2>
        </div>
        <div className="settings-card__head-meta">
          <span className="settings-pill settings-pill--neutral">Client → DukAI → Your store</span>
          {config ? (
            <span className="settings-pill settings-pill--ok">Configured</span>
          ) : (
            <span className="settings-pill settings-pill--warn">Not configured</span>
          )}
        </div>
      </header>
      <div className="settings-card__body">
        <p className="settings-muted settings-card__lead">
          Money always moves Client → DukAI → your store. Customers pay the DukAI hub first; once
          confirmed, DukAI pays the same amount out to the destination below.
        </p>

        <MpesaMoneyFlow audience="merchant" />

        <form className="settings-form settings-form--compact" onSubmit={(e) => void handleSubmit(e)}>
          <fieldset className="settings-field" disabled={saving}>
            <span>Where should DukAI send your payout?</span>
            {(Object.keys(destinationMeta) as MerchantPayoutType[]).map((type) => (
              <label key={type} className="settings-field settings-field--checkbox">
                <input
                  type="radio"
                  name="merchant-payout-type"
                  checked={form.shortcode_type === type}
                  onChange={() =>
                    setForm((prev) => ({
                      ...prev,
                      shortcode_type: type,
                    }))
                  }
                />
                <span>
                  <strong>{destinationMeta[type].label}</strong>
                  <em className="settings-muted"> — {destinationMeta[type].hint}</em>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="settings-field">
            <span>{activeDestination.field}</span>
            <input
              type="text"
              required
              value={form.shortcode}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  shortcode: e.target.value.trim(),
                }))
              }
              placeholder={activeDestination.placeholder}
              inputMode={form.shortcode_type === "pochi" ? "tel" : "numeric"}
              autoComplete="off"
            />
          </label>

          <label className="settings-field">
            <span>Transaction account</span>
            <input
              type="text"
              required
              value={form.account_number}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  account_number: e.target.value.trim(),
                }))
              }
              placeholder="e.g. SHOP001"
              maxLength={12}
              autoComplete="off"
            />
          </label>
          <p className="settings-card__hint">
            <i className="fa-solid fa-circle-info" aria-hidden="true" />
            Used as the M-PESA account reference when customers pay, so you can match deposits to
            this shop.
          </p>

          <div className="settings-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? "Saving…" : "Save settlement details"}
            </button>
          </div>
        </form>
      </div>
    </article>
  );
}

function AdminMpesaSettingsSection() {
  const [config, setConfig] = useState<MpesaConfig | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void apiFetch<MpesaConfigResponse>(apiRoutes.adminMpesaConfig)
      .then((data) => {
        setConfig(data.config);
        setHint(data.message ?? null);
      })
      .catch(() => setConfig(null))
      .finally(() => setLoaded(true));
  }, []);

  async function handleTest() {
    setTesting(true);
    try {
      const data = await apiFetch<MpesaConfigResponse>(apiRoutes.adminMpesaTest, {
        method: "POST",
      });
      setConfig(data.config);
      setHint(data.message ?? null);
      await toastSuccess("Daraja credentials verified");
    } catch (err) {
      await showError("Test failed", extractErrorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  if (!loaded) {
    return (
      <article className="settings-card" aria-busy="true" aria-live="polite">
        <header className="settings-card__head">
          <div className="settings-card__title">
            <i className="fa-solid fa-mobile-screen settings-card__icon" aria-hidden="true" />
            <h2>M-PESA Express</h2>
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

  const configured = Boolean(config?.is_configured);
  const envLabel = config?.environment === "production" ? "Production" : "Sandbox";
  const envTone = configured
    ? config?.environment === "production"
      ? "ok"
      : "neutral"
    : "warn";
  const testTone =
    config?.last_test_result === "OK"
      ? "ok"
      : config?.last_test_result
        ? "warn"
        : "neutral";

  return (
    <article className="settings-card">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <i className="fa-solid fa-mobile-screen settings-card__icon" aria-hidden="true" />
          <h2>M-PESA Express (Daraja)</h2>
        </div>
        <div className="settings-card__head-meta">
          <span className="settings-pill settings-pill--neutral">Client → DukAI → Merchant</span>
          <span className={`settings-pill settings-pill--${envTone}`}>
            {configured ? envLabel : "Not configured"}
          </span>
        </div>
      </header>
      <div className="settings-card__body">
        <p className="settings-muted settings-card__lead">
          Money moves Client → DukAI → Merchant. These hub Daraja credentials power the middle step
          (DukAI). Credentials are read from <code>.env</code> (
          <code>MPESA_*</code> / <code>MPESA_MODE</code>). This screen only verifies the connection.
        </p>

        <MpesaMoneyFlow audience="admin" />

        {config ? (
          <div className="mpesa-summary">
            <div className="mpesa-summary__row">
              <div className="mpesa-summary__cell">
                <span className="mpesa-summary__label">Collection paybill</span>
                <span className="mpesa-summary__value">
                  <code>{config.shortcode || "—"}</code>
                </span>
              </div>
              <div className="mpesa-summary__cell">
                <span className="mpesa-summary__label">Consumer key</span>
                <span className="mpesa-summary__value">
                  <code>{config.consumer_key_masked ?? "—"}</code>
                </span>
              </div>
              <div className="mpesa-summary__cell">
                <span className="mpesa-summary__label">Secret</span>
                <span className="mpesa-summary__value">
                  <code>{config.consumer_secret_masked ?? "—"}</code>
                </span>
              </div>
              <div className="mpesa-summary__cell">
                <span className="mpesa-summary__label">Passkey</span>
                <span className="mpesa-summary__value">
                  <code>{config.passkey_masked ?? "—"}</code>
                </span>
              </div>
              <div className="mpesa-summary__cell mpesa-summary__cell--wide">
                <span className="mpesa-summary__label">B2B payout</span>
                <span className="mpesa-summary__value">
                  {config.b2b_auto_payout ? (
                    <>
                      Auto payout on · initiator{" "}
                      <code>{config.b2b_initiator_name ?? "—"}</code>
                    </>
                  ) : (
                    <span className="settings-muted">Manual / disabled</span>
                  )}
                </span>
              </div>
              <div className="mpesa-summary__cell mpesa-summary__cell--wide">
                <span className="mpesa-summary__label">Callback URL</span>
                <span className="mpesa-summary__value">
                  {config.callback_url ? (
                    <code>{config.callback_url}</code>
                  ) : (
                    <span className="settings-muted">Not set</span>
                  )}
                </span>
              </div>
              <div className="mpesa-summary__cell mpesa-summary__cell--wide">
                <span className="mpesa-summary__label">B2B result URL</span>
                <span className="mpesa-summary__value">
                  {config.b2b_result_url ? (
                    <code>{config.b2b_result_url}</code>
                  ) : (
                    <span className="settings-muted">Not set</span>
                  )}
                </span>
              </div>
              <div className="mpesa-summary__cell">
                <span className="mpesa-summary__label">Last test</span>
                <span className="mpesa-summary__value">
                  {config.last_tested_at ? (
                    <>
                      <span className={`settings-pill settings-pill--${testTone}`}>
                        {config.last_test_result}
                      </span>
                      <span className="settings-grid__sub">
                        {formatNairobiDateTime(config.last_tested_at)}
                      </span>
                    </>
                  ) : (
                    <span className="settings-muted">Never tested</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {hint && !configured ? (
          <p className="settings-card__hint">
            <i className="fa-solid fa-circle-info" aria-hidden="true" /> {hint}
          </p>
        ) : null}

        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void handleTest()}
            disabled={testing || !configured}
          >
            <i className="fa-solid fa-bolt" aria-hidden="true" />
            {testing ? "Testing…" : "Test connection"}
          </button>
          <Link href="/tools/payments" className="btn btn-ghost btn-sm">
            <i className="fa-solid fa-paper-plane" aria-hidden="true" />
            Send payment request
          </Link>
        </div>
      </div>
    </article>
  );
}
