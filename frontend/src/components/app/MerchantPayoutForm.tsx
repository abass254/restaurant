"use client";

import { FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  EMPTY_MERCHANT_PAYOUT_FORM,
  MERCHANT_PAYOUT_TYPES,
  PAYOUT_DESTINATION_META,
  isMerchantPayoutType,
  nextPayoutShortcode,
  type MerchantPayoutFormState,
  type MerchantPayoutType,
} from "@/lib/mpesa-payout";
import type {
  MerchantMpesaConfig,
  MerchantMpesaConfigResponse,
  MerchantMpesaVerifyResponse,
} from "@/lib/types";

type MerchantPayoutFormProps = {
  initial?: MerchantMpesaConfig | null;
  suggestedPhone?: string | null;
  onSaved?: (config: MerchantMpesaConfig | null, suggestedPhone: string | null) => void;
  onCancel?: () => void;
  submitLabel?: string;
  successMessage?: string;
  layout?: "tiles" | "radios";
  compactActions?: boolean;
};

export function formStateFromConfig(
  config: MerchantMpesaConfig | null | undefined,
): MerchantPayoutFormState {
  if (!config) return EMPTY_MERCHANT_PAYOUT_FORM;
  return {
    shortcode: config.shortcode,
    shortcode_type: isMerchantPayoutType(config.shortcode_type)
      ? config.shortcode_type
      : "paybill",
    account_number: config.account_number ?? "",
  };
}

function bodyFromForm(form: MerchantPayoutFormState) {
  return {
    shortcode: form.shortcode,
    shortcode_type: form.shortcode_type,
    account_number: form.shortcode_type === "paybill" ? form.account_number : "",
  };
}

export function MerchantPayoutForm({
  initial,
  suggestedPhone = null,
  onSaved,
  onCancel,
  submitLabel = "Yes, save",
  successMessage = "Payment terms saved",
  layout = "tiles",
  compactActions = false,
}: MerchantPayoutFormProps) {
  const [form, setForm] = useState<MerchantPayoutFormState>(() =>
    formStateFromConfig(initial),
  );
  const [lookup, setLookup] = useState<MerchantMpesaVerifyResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const active = PAYOUT_DESTINATION_META[form.shortcode_type];
  const confirming = Boolean(lookup);

  function selectType(nextType: MerchantPayoutType) {
    setLookup(null);
    setForm((prev) => ({
      ...prev,
      shortcode_type: nextType,
      shortcode: nextPayoutShortcode(nextType, prev.shortcode, suggestedPhone),
      account_number: nextType === "paybill" ? prev.account_number : "",
    }));
  }

  async function handleLookup(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await apiFetch<MerchantMpesaVerifyResponse>(
        apiRoutes.mpesaBusinessConfigVerify,
        {
          method: "POST",
          body: JSON.stringify(bodyFromForm(form)),
        },
      );
      setLookup(data);
    } catch (err) {
      setLookup(null);
      await showError("Could not look up destination", extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!lookup) return;
    setBusy(true);
    try {
      const data = await apiFetch<MerchantMpesaConfigResponse>(
        apiRoutes.mpesaBusinessConfig,
        {
          method: "PUT",
          body: JSON.stringify({
            ...bodyFromForm(form),
            verification_token: lookup.verification_token,
          }),
        },
      );
      onSaved?.(data.config, data.suggested_phone ?? null);
      await toastSuccess(successMessage);
    } catch (err) {
      await showError("Could not save", extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (confirming && lookup) {
    const methodLabel = PAYOUT_DESTINATION_META[lookup.shortcode_type].label;
    return (
      <div className="payment-terms-confirm">
        <p className="settings-muted payment-terms-confirm__lead">
          {lookup.lookup_source === "mpesa"
            ? "M-PESA returned this registered name. Confirm it is yours before saving."
            : "Confirm these details are yours before saving."}
        </p>
        <p className="payment-terms-confirm__prompt">{lookup.prompt}</p>
        {lookup.organization_name ? (
          <p className="payment-terms-confirm__name">{lookup.organization_name}</p>
        ) : null}
        <dl className="payment-terms-confirm__meta">
          <div>
            <dt>Method</dt>
            <dd>{methodLabel}</dd>
          </div>
          <div>
            <dt>Destination</dt>
            <dd>{lookup.destination_label}</dd>
          </div>
          {lookup.shortcode_type === "paybill" && lookup.account_number ? (
            <div>
              <dt>Account number</dt>
              <dd>{lookup.account_number}</dd>
            </div>
          ) : null}
        </dl>
        <div className={onCancel ? "settings-form__actions" : "settings-actions"}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setLookup(null)}
            disabled={busy}
          >
            No, change
          </button>
          <button
            type="button"
            className={`btn btn-primary${compactActions || onCancel ? "" : " btn-sm"}`}
            onClick={() => void handleSave()}
            disabled={busy}
          >
            {busy ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className={`settings-form${compactActions ? "" : " settings-form--compact"}`}
      onSubmit={(e) => void handleLookup(e)}
    >
      {layout === "tiles" ? (
        <fieldset className="payment-terms-fieldset" disabled={busy}>
          <legend>Where should TransChap send payouts?</legend>
          <div className="payment-terms-choices">
            {MERCHANT_PAYOUT_TYPES.map((type) => {
              const meta = PAYOUT_DESTINATION_META[type];
              const selected = form.shortcode_type === type;
              return (
                <label
                  key={type}
                  className={`payment-terms-choice${selected ? " is-active" : ""}`}
                >
                  <input
                    type="radio"
                    name="merchant-payout-type"
                    className="sr-only"
                    checked={selected}
                    onChange={() => selectType(type)}
                  />
                  <i className={`fa-solid ${meta.icon}`} aria-hidden="true" />
                  <strong>{meta.label}</strong>
                </label>
              );
            })}
          </div>
          <p className="settings-muted payment-terms-hint">{active.hint}</p>
        </fieldset>
      ) : (
        <fieldset className="settings-field" disabled={busy}>
          <span>Where should TransChap send your payout?</span>
          {MERCHANT_PAYOUT_TYPES.map((type) => (
            <label key={type} className="settings-field settings-field--checkbox">
              <input
                type="radio"
                name="merchant-payout-type"
                checked={form.shortcode_type === type}
                onChange={() => selectType(type)}
              />
              <span>
                <strong>{PAYOUT_DESTINATION_META[type].label}</strong>
                <em className="settings-muted">
                  {" "}
                  — {PAYOUT_DESTINATION_META[type].hint}
                </em>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <label className="settings-field">
        <span>{active.field}</span>
        <input
          type="text"
          required
          value={form.shortcode}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, shortcode: e.target.value.trim() }))
          }
          placeholder={active.placeholder}
          inputMode={
            form.shortcode_type === "pochi" || form.shortcode_type === "phone"
              ? "tel"
              : "numeric"
          }
          autoComplete="off"
        />
      </label>
      {form.shortcode_type === "phone" ? (
        <p className="settings-card__hint">
          <i className="fa-solid fa-circle-info" aria-hidden="true" />
          {suggestedPhone
            ? "Prefills from your account phone when possible. This is a personal M-PESA number, not Pochi."
            : "This is a personal M-PESA number (Send Money), not a Pochi la Biashara wallet."}
        </p>
      ) : null}

      {active.needsAccount ? (
        <label className="settings-field">
          <span>Account number</span>
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
            placeholder="e.g. 957207"
            maxLength={12}
            autoComplete="off"
          />
        </label>
      ) : null}

      <div className={onCancel ? "settings-form__actions" : "settings-actions"}>
        {onCancel ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          className={`btn btn-primary${compactActions || onCancel ? "" : " btn-sm"}`}
          disabled={busy}
        >
          {busy ? "Looking up…" : "Look up"}
        </button>
      </div>
    </form>
  );
}
