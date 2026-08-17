"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuthUser } from "@/components/app/AuthProvider";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
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
      setConfig(data.config);
      setSuggestedPhone(data.suggested_phone ?? null);
      setForm(formFromConfig(data.config));
      setLookup(null);
      setEditing(false);
      await toastSuccess("M-PESA details saved");
    } catch (err) {
      await showError("Could not save", extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const active = PAYOUT_DESTINATION_META[form.shortcode_type];

  return (
    <section className="trans-chap-mpesa">
      <header className="trans-chap-mpesa__head">
        <h2>M-PESA</h2>
        {loaded ? (
          <span className={`trans-chap-mpesa__pill${config ? " is-ok" : " is-warn"}`}>
            {config ? "Set" : "Not set"}
          </span>
        ) : null}
      </header>
      <p className="trans-chap-mpesa__lead">
        Customer payments go through DukAI to your Till, Paybill, Pochi, or M-PESA
        phone. M-PESA sales stay blocked until this is saved.
      </p>

      {!loaded ? (
        <p className="trans-chap-mpesa__lead">Loading M-PESA details…</p>
      ) : config && !editing ? (
        <div className="trans-chap-mpesa__summary">
          <p>{formatMerchantPayoutDestination(config)}</p>
          {canEdit ? (
            <button type="button" className="trans-chap-mpesa__change" onClick={startEdit}>
              Change
            </button>
          ) : null}
        </div>
      ) : !canEdit ? (
        <p className="trans-chap-mpesa__lead">
          Ask the shop owner to set M-PESA details before taking M-PESA payments.
        </p>
      ) : lookup ? (
        <div className="trans-chap-mpesa__confirm">
          <p>{lookup.prompt}</p>
          {lookup.organization_name ? <strong>{lookup.organization_name}</strong> : null}
          <p>{lookup.destination_label}</p>
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
            className="trans-chap-mpesa__change"
            onClick={() => setLookup(null)}
            disabled={busy}
          >
            No, change
          </button>
        </div>
      ) : (
        <form className="trans-chap-mpesa__form" onSubmit={(e) => void handleLookup(e)}>
          <div className="auth-split__field">
            <span id="mpesa-dest-label">Where should money land?</span>
            <div
              className="trans-chap-pay trans-chap-pay--dest"
              role="radiogroup"
              aria-labelledby="mpesa-dest-label"
            >
              {MERCHANT_PAYOUT_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={form.shortcode_type === type}
                  className={`trans-chap-pay__option${form.shortcode_type === type ? " is-selected" : ""}`}
                  onClick={() => selectType(type)}
                  disabled={busy}
                >
                  {PAYOUT_DESTINATION_META[type].shortLabel}
                </button>
              ))}
            </div>
            <p className="trans-chap-mpesa__hint">{active.hint}</p>
          </div>

          <div className="auth-split__field">
            <label htmlFor="mpesa-shortcode">{active.field}</label>
            <input
              id="mpesa-shortcode"
              type="text"
              required
              className="auth-split__input"
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
            />
          </div>

          {active.needsAccount ? (
            <div className="auth-split__field">
              <label htmlFor="mpesa-account">Account number</label>
              <input
                id="mpesa-account"
                type="text"
                required
                className="auth-split__input"
                value={form.account_number}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, account_number: e.target.value.trim() }))
                }
                placeholder="e.g. 957207"
                maxLength={12}
                autoComplete="off"
                disabled={busy}
              />
            </div>
          ) : null}

          <button type="submit" className="auth-split__btn" disabled={busy}>
            {busy ? "Looking up…" : "Look up"}
          </button>
          {config ? (
            <button
              type="button"
              className="trans-chap-mpesa__change"
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
        </form>
      )}
    </section>
  );
}
