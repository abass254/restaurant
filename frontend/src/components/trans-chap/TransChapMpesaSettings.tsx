"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { showInternalError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { isShopOwner } from "@/lib/merchant-permissions";
import {
  EMPTY_MERCHANT_PAYOUT_FORM,
  MERCHANT_PAYOUT_TYPES,
  PAYOUT_DESTINATION_META,
  formatMerchantPayoutDestination,
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

function formFromConfig(config: MerchantMpesaConfig | null): MerchantPayoutFormState {
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

export function TransChapMpesaSettings() {
  const user = useAuthUser();
  const canEdit = isShopOwner(user);
  const [config, setConfig] = useState<MerchantMpesaConfig | null>(null);
  const [suggestedPhone, setSuggestedPhone] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<MerchantPayoutFormState>(EMPTY_MERCHANT_PAYOUT_FORM);
  const [lookup, setLookup] = useState<MerchantMpesaVerifyResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiFetch<MerchantMpesaConfigResponse>(apiRoutes.mpesaBusinessConfig)
      .then((data) => {
        setConfig(data.config);
        setSuggestedPhone(data.suggested_phone ?? null);
        setForm(formFromConfig(data.config));
        setEditing(!data.config);
      })
      .catch(() => {
        setConfig(null);
        setEditing(canEdit);
      })
      .finally(() => setLoaded(true));
  }, [canEdit]);

  function selectType(nextType: MerchantPayoutType) {
    setLookup(null);
    setForm((prev) => ({
      ...prev,
      shortcode_type: nextType,
      shortcode: nextPayoutShortcode(nextType, prev.shortcode, suggestedPhone),
      account_number: nextType === "paybill" ? prev.account_number : "",
    }));
  }

  function startEdit() {
    setForm(formFromConfig(config));
    setLookup(null);
    setEditing(true);
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
      await showInternalError();
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
      setConfig(data.config);
      setSuggestedPhone(data.suggested_phone ?? null);
      setForm(formFromConfig(data.config));
      setLookup(null);
      setEditing(false);
      await toastSuccess("M-PESA details saved");
    } catch {
      await showInternalError();
    } finally {
      setBusy(false);
    }
  }

  const active = PAYOUT_DESTINATION_META[form.shortcode_type];

  return (
    <section className="trans-chap-mpesa ios-settings-detail">
      <p className="ios-settings__footer ios-settings__footer--top">
        Customer payments go through DukAI to your Till, Paybill, Pochi, or M-PESA
        phone. M-PESA sales stay blocked until this is saved.
      </p>

      {!loaded ? (
        <div className="ios-settings__card">
          <div className="ios-settings__row ios-settings__row--static">
            <span className="ios-settings__label">Loading…</span>
          </div>
        </div>
      ) : config && !editing ? (
        <div className="ios-settings__group">
          <h3 className="ios-settings__caption">Destination</h3>
          <div className="ios-settings__card">
            <div className="ios-settings__row ios-settings__row--static">
              <span className="ios-settings__label">{formatMerchantPayoutDestination(config)}</span>
            </div>
            {canEdit ? (
              <button type="button" className="ios-settings__row" onClick={startEdit}>
                <span className="ios-settings__label ios-settings__label--action">Change</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : !canEdit ? (
        <p className="ios-settings__footer">
          Ask the shop owner to set M-PESA details before taking M-PESA payments.
        </p>
      ) : lookup ? (
        <div className="ios-settings__group">
          <h3 className="ios-settings__caption">Confirm</h3>
          <div className="ios-settings__card ios-settings__card--pad">
            <p className="trans-chap-mpesa__confirm-copy">{lookup.prompt}</p>
            {lookup.organization_name ? (
              <strong className="trans-chap-mpesa__confirm-name">{lookup.organization_name}</strong>
            ) : null}
            <p className="trans-chap-mpesa__confirm-copy">{lookup.destination_label}</p>
            <button
              type="button"
              className="auth-split__btn"
              onClick={() => void handleSave()}
              disabled={busy}
            >
              {busy ? "Saving…" : "Yes, save"}
            </button>
            <button
              type="button"
              className="ios-settings__text-btn"
              onClick={() => setLookup(null)}
              disabled={busy}
            >
              No, change
            </button>
          </div>
        </div>
      ) : (
        <form className="ios-settings__group" onSubmit={(e) => void handleLookup(e)}>
          <h3 className="ios-settings__caption">Where should money land?</h3>
          <div className="ios-settings__card">
            {MERCHANT_PAYOUT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={form.shortcode_type === type}
                className={`ios-settings__row${form.shortcode_type === type ? " is-selected" : ""}`}
                onClick={() => selectType(type)}
                disabled={busy}
              >
                <span className="ios-settings__label">{PAYOUT_DESTINATION_META[type].shortLabel}</span>
                {form.shortcode_type === type ? (
                  <i className="fa-solid fa-check ios-settings__check" aria-hidden />
                ) : null}
              </button>
            ))}
          </div>
          <p className="ios-settings__footer">{active.hint}</p>

          <h3 className="ios-settings__caption">{active.field}</h3>
          <div className="ios-settings__card">
            <div className="ios-settings__row ios-settings__row--field">
              <input
                id="mpesa-shortcode"
                type="text"
                required
                className="ios-settings__input"
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
                disabled={busy}
                aria-label={active.field}
              />
            </div>
            {active.needsAccount ? (
              <div className="ios-settings__row ios-settings__row--field">
                <input
                  id="mpesa-account"
                  type="text"
                  required
                  className="ios-settings__input"
                  value={form.account_number}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, account_number: e.target.value.trim() }))
                  }
                  placeholder="Account number"
                  maxLength={12}
                  autoComplete="off"
                  disabled={busy}
                  aria-label="Account number"
                />
              </div>
            ) : null}
          </div>

          <div className="ios-settings__actions">
            <button type="submit" className="auth-split__btn" disabled={busy}>
              {busy ? "Looking up…" : "Look up"}
            </button>
            {config ? (
              <button
                type="button"
                className="ios-settings__text-btn"
                onClick={() => {
                  setForm(formFromConfig(config));
                  setLookup(null);
                  setEditing(false);
                }}
                disabled={busy}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
