"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { MPESA_MAX_KES, MPESA_MIN_PAYOUT_KES } from "@/lib/mpesa-limits";
import { usePlatformRuntime } from "@/lib/platform-runtime";
import type { AdminMerchantsResponse, AdminMerchantSummary } from "@/lib/types";
import { MpesaMoneyFlow } from "./MpesaMoneyFlow";

type SimulateMode = "live" | "instant";

type SimulatePaymentResponse = {
  message: string;
  mode: SimulateMode;
  transaction_id: string;
  status: string;
  phone_number: string;
  amount: number;
  merchant_name: string;
  payout_status: string | null;
  payout_shortcode: string | null;
  payout_result_desc: string | null;
  mpesa_receipt_number: string | null;
};

const SANDBOX_TEST_MSISDN = "254708374149";

export function PaymentSimulationSection() {
  const { mode: runtimeMode } = usePlatformRuntime();
  const isDev = runtimeMode === "dev";
  const minKes = isDev ? 1 : MPESA_MIN_PAYOUT_KES;

  const [merchants, setMerchants] = useState<AdminMerchantSummary[]>([]);
  const [merchantsLoading, setMerchantsLoading] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [phone, setPhone] = useState(SANDBOX_TEST_MSISDN);
  const [amount, setAmount] = useState(String(minKes));
  const [mode, setMode] = useState<SimulateMode>("live");
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<SimulatePaymentResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<AdminMerchantsResponse>(apiRoutes.adminMerchants)
      .then((data) => {
        if (cancelled) return;
        setMerchants(data.data);
        if (data.data.length === 1) {
          setAccountId(data.data[0].id);
        }
      })
      .catch(() => {
        if (!cancelled) setMerchants([]);
      })
      .finally(() => {
        if (!cancelled) setMerchantsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isDev && mode === "instant") {
      setMode("live");
    }
  }, [isDev, mode]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!accountId) {
      await showError("Choose a merchant", "Select the store that should receive the payout.");
      return;
    }
    const parsedAmount = Number.parseInt(amount, 10);
    if (!Number.isFinite(parsedAmount) || parsedAmount < minKes) {
      await showError(
        "Invalid amount",
        `Amount must be at least KES ${minKes}. Safaricom declines smaller amounts.`,
      );
      return;
    }

    setSending(true);
    setLastResult(null);
    try {
      const data = await apiFetch<SimulatePaymentResponse>(apiRoutes.adminSimulatePayment, {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId,
          phone_number: phone.trim(),
          amount: parsedAmount,
          mode,
        }),
      });
      setLastResult(data);
      await toastSuccess(data.message);
    } catch (err) {
      await showError(
        "Payment simulation failed",
        err instanceof ApiError ? err.message : extractErrorMessage(err),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <article className="settings-card">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <i className="fa-solid fa-arrows-rotate settings-card__icon" aria-hidden="true" />
          <h2>Payment simulation</h2>
        </div>
        <span className="settings-pill settings-pill--neutral">Client → DukAI → Merchant</span>
      </header>
      <div className="settings-card__body">
        <p className="settings-muted settings-card__lead">
          Test Client → DukAI → Merchant end to end: collect from a client phone into the hub
          Paybill, then pay out to the merchant store. Live STK waits for the client to pay;
          Instant (Dev only) skips the phone prompt.
        </p>

        <MpesaMoneyFlow audience="admin" />

        <form
          className="settings-form settings-form--compact"
          onSubmit={(e) => void handleSubmit(e)}
        >
          <label className="settings-field">
            <span>Merchant store</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={merchantsLoading || sending}
              required
            >
              <option value="">
                {merchantsLoading ? "Loading merchants…" : "Select a merchant"}
              </option>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.business_name}
                  {m.business_location ? ` — ${m.business_location}` : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="settings-form__row">
            <label className="settings-field">
              <span>Client phone</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="2547XXXXXXXX"
                autoComplete="off"
                required
                disabled={sending}
              />
            </label>
            <label className="settings-field">
              <span>Amount (KES)</span>
              <input
                type="number"
                min={minKes}
                max={MPESA_MAX_KES}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                disabled={sending}
              />
            </label>
          </div>

          <fieldset className="settings-field" disabled={sending}>
            <span>Mode</span>
            <label className="settings-field settings-field--checkbox">
              <input
                type="radio"
                name="simulate-mode"
                checked={mode === "live"}
                onChange={() => setMode("live")}
              />
              <span>Live STK — prompt the client phone, payout after they pay</span>
            </label>
            <label className="settings-field settings-field--checkbox">
              <input
                type="radio"
                name="simulate-mode"
                checked={mode === "instant"}
                onChange={() => setMode("instant")}
                disabled={!isDev}
              />
              <span>
                Instant — simulate receive + payout now
                {!isDev ? " (switch platform to Dev mode)" : ""}
              </span>
            </label>
          </fieldset>

          {isDev ? (
            <p className="settings-card__hint">
              <i className="fa-solid fa-circle-info" aria-hidden="true" />
              Dev mode uses Daraja sandbox. STK amounts other than 1 KES are sent as 1 KES.
              Sandbox test MSISDN: <code>{SANDBOX_TEST_MSISDN}</code>.
            </p>
          ) : null}

          <div className="settings-actions">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={sending || merchantsLoading || !accountId}
            >
              <i className="fa-solid fa-bolt" aria-hidden="true" />
              {sending
                ? mode === "instant"
                  ? "Running…"
                  : "Sending STK…"
                : mode === "instant"
                  ? "Simulate receive & payout"
                  : "Send STK & queue payout"}
            </button>
          </div>
        </form>

        {lastResult ? (
          <p className="settings-card__hint" role="status">
            <i className="fa-solid fa-circle-check" aria-hidden="true" />
            Txn <code>{lastResult.transaction_id.slice(0, 8)}</code> · status{" "}
            <strong>{lastResult.status}</strong>
            {lastResult.payout_status
              ? ` · payout ${lastResult.payout_status}`
              : ""}
            {lastResult.payout_shortcode ? ` → ${lastResult.payout_shortcode}` : ""}
            {lastResult.payout_result_desc ? ` — ${lastResult.payout_result_desc}` : ""}
          </p>
        ) : null}
      </div>
    </article>
  );
}
