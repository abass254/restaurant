"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { confirmAction, extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import { MPESA_MAX_KES, MPESA_MIN_PAYOUT_KES } from "@/lib/mpesa-limits";
import type { AdminMerchantsResponse, AdminMerchantSummary } from "@/lib/types";

type MerchantPayoutResponse = {
  message: string;
  transaction_id: string;
  amount: number;
  merchant_name: string;
  payout_status: string | null;
  payout_shortcode: string | null;
  payout_shortcode_type: string | null;
  payout_result_desc: string | null;
};

function formatDestinationType(type: string | null | undefined): string {
  switch ((type || "").toLowerCase()) {
    case "pochi":
    case "pochi_la_biashara":
      return "Pochi";
    case "phone":
    case "b2c":
    case "msisdn":
      return "Phone";
    case "till":
    case "buygoods":
    case "buy_goods":
      return "Till";
    case "paybill":
      return "Paybill";
    default:
      return type || "destination";
  }
}

export function MerchantPayoutSection() {
  const [merchants, setMerchants] = useState<AdminMerchantSummary[]>([]);
  const [merchantsLoading, setMerchantsLoading] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState(String(MPESA_MIN_PAYOUT_KES));
  const [remarks, setRemarks] = useState("");
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<MerchantPayoutResponse | null>(null);

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!accountId) {
      await showError("Choose a merchant", "Select the store that should receive the money.");
      return;
    }
    const parsedAmount = Number.parseInt(amount, 10);
    if (!Number.isFinite(parsedAmount) || parsedAmount < MPESA_MIN_PAYOUT_KES) {
      await showError(
        "Invalid amount",
        `Amount must be at least KES ${MPESA_MIN_PAYOUT_KES}. Safaricom declines smaller payouts.`,
      );
      return;
    }

    const merchant = merchants.find((m) => m.id === accountId);
    const ok = await confirmAction(
      "Send money to merchant?",
      `This sends KES ${parsedAmount.toLocaleString()} from the DukAI hub Paybill to ${
        merchant?.business_name ?? "the selected store"
      } via M-PESA B2B. This uses real funds when MPESA_MODE is production.`,
      "Yes, send payout",
    );
    if (!ok) return;

    setSending(true);
    setLastResult(null);
    try {
      const data = await apiFetch<MerchantPayoutResponse>(apiRoutes.adminMerchantPayout, {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId,
          amount: parsedAmount,
          remarks: remarks.trim() || undefined,
        }),
      });
      setLastResult(data);
      await toastSuccess(data.message);
    } catch (err) {
      await showError(
        "Could not send payout",
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
          <i className="fa-solid fa-paper-plane settings-card__icon" aria-hidden="true" />
          <h2>Send to merchant</h2>
        </div>
        <span className="settings-pill settings-pill--neutral">DukAI → Merchant</span>
      </header>
      <div className="settings-card__body">
        <p className="settings-muted settings-card__lead">
          Last leg of Client → DukAI → Merchant. Pay a merchant from the DukAI hub Paybill (B2B)
          when the hub already holds funds and you want to settle a store without a new client STK.
        </p>

        <ol className="mpesa-money-flow__track mpesa-payout-only" aria-label="Payout path">
          <li className="mpesa-money-flow__step mpesa-money-flow__step--hub">
            <span className="mpesa-money-flow__badge" aria-hidden="true">
              <i className="fa-solid fa-building-columns" />
            </span>
            <div className="mpesa-money-flow__copy">
              <strong>DukAI hub</strong>
              <span>Funds leave the platform Paybill</span>
            </div>
          </li>
          <li className="mpesa-money-flow__step mpesa-money-flow__step--merchant">
            <span className="mpesa-money-flow__badge" aria-hidden="true">
              <i className="fa-solid fa-store" />
            </span>
            <div className="mpesa-money-flow__copy">
              <strong>Merchant</strong>
              <span>Till, Paybill, Pochi, or M-PESA phone from their settlement settings</span>
            </div>
          </li>
        </ol>

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
              <span>Amount (KES)</span>
              <input
                type="number"
                min={MPESA_MIN_PAYOUT_KES}
                max={MPESA_MAX_KES}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                disabled={sending}
              />
            </label>
            <label className="settings-field">
              <span>Remarks (optional)</span>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. Weekly settlement"
                maxLength={200}
                disabled={sending}
              />
            </label>
          </div>

          <p className="settings-card__hint">
            <i className="fa-solid fa-circle-info" aria-hidden="true" />
            Requires <code>MPESA_B2B_INITIATOR</code> and{" "}
            <code>MPESA_B2B_SECURITY_CREDENTIAL</code> in <code>.env</code>, and the merchant must
            have settlement details saved.
          </p>

          <div className="settings-actions">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={sending || merchantsLoading || !accountId}
            >
              <i className="fa-solid fa-paper-plane" aria-hidden="true" />
              {sending ? "Sending…" : "Send payout"}
            </button>
          </div>
        </form>

        {lastResult ? (
          <p className="settings-card__hint" role="status">
            <i className="fa-solid fa-circle-check" aria-hidden="true" />
            Txn <code>{lastResult.transaction_id.slice(0, 8)}</code> · payout{" "}
            <strong>{lastResult.payout_status ?? "—"}</strong>
            {lastResult.payout_shortcode
              ? ` → ${formatDestinationType(lastResult.payout_shortcode_type)} ${lastResult.payout_shortcode}`
              : ""}
            {lastResult.payout_result_desc ? ` — ${lastResult.payout_result_desc}` : ""}
          </p>
        ) : null}
      </div>
    </article>
  );
}
