"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { StorefrontHeader } from "@/components/storefront/StorefrontHeader";
import { formatMoney } from "@/lib/orders";

type PageStatus =
  | "loading"
  | "ready"
  | "cleared"
  | "expired"
  | "error"
  | "submitting"
  | "awaiting_mpesa"
  | "payment_failed";

type PayBillData = {
  merchant: { name: string };
  customer_name: string;
  phone: string;
  currency: string;
  outstanding_balance: number;
  credit_limit: number;
  available_credit: number;
  can_pay: boolean;
  is_cleared: boolean;
  mpesa_payment?: {
    id?: string;
    status: string;
    amount?: number;
    message?: string | null;
    collected?: boolean;
    can_retry?: boolean;
  } | null;
};

const MPESA_POLL_MS = 3_000;

export default function PayBillPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";

  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [bill, setBill] = useState<PayBillData | null>(null);
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [consent, setConsent] = useState(true);
  const [txnId, setTxnId] = useState<string | null>(null);

  const applyLoaded = useCallback((data: PayBillData) => {
    setBill(data);
    setPhone(data.phone || "");
    setAmount(String(data.outstanding_balance || ""));
    setErrorMsg(null);
    if (data.is_cleared || data.outstanding_balance <= 0) {
      setStatus("cleared");
      return;
    }
    if (data.mpesa_payment?.status === "pending") {
      setTxnId(data.mpesa_payment.id ?? null);
      setStatus("awaiting_mpesa");
      return;
    }
    if (
      data.mpesa_payment?.status === "failed" ||
      data.mpesa_payment?.status === "cancelled"
    ) {
      setErrorMsg(
        data.mpesa_payment.message ||
          "Your M-PESA payment did not go through. Please try again.",
      );
      setStatus("payment_failed");
      return;
    }
    setStatus("ready");
  }, []);

  const load = useCallback(async () => {
    if (!token) {
      setStatus("error");
      setErrorMsg("Missing pay-bill link.");
      return;
    }
    try {
      const res = await apiFetch<{ data: PayBillData }>(apiRoutes.payBill(token));
      applyLoaded(res.data);
    } catch (err) {
      const gone = err instanceof ApiError && err.status === 410;
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : "This pay-bill link is invalid or unavailable.",
      );
      setStatus(gone ? "expired" : "error");
    }
  }, [token, applyLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (status !== "awaiting_mpesa" || !token || !txnId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await apiFetch<{ data: PayBillData }>(
          apiRoutes.payBillCollection(token, txnId),
        );
        if (cancelled) return;
        const payment = res.data.mpesa_payment;
        if (payment?.status === "success" || res.data.is_cleared) {
          applyLoaded(res.data);
          return;
        }
        if (payment?.status === "failed" || payment?.status === "cancelled") {
          applyLoaded(res.data);
        }
      } catch {
        /* keep polling */
      }
    };
    const id = window.setInterval(() => void tick(), MPESA_POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [status, token, txnId, applyLoaded]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token || !bill) return;
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ data: PayBillData }>(apiRoutes.payBillSubmit(token), {
        method: "POST",
        body: JSON.stringify({
          phone: phone.trim() || bill.phone,
          amount: Number(amount) || bill.outstanding_balance,
          consent,
        }),
      });
      const payment = res.data.mpesa_payment;
      setTxnId(payment?.id ?? null);
      applyLoaded(res.data);
      if (payment?.status === "pending") {
        setStatus("awaiting_mpesa");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : "Could not start M-PESA payment.",
      );
      setStatus("payment_failed");
    }
  }

  const currency = bill?.currency || "KES";
  const shopName = bill?.merchant.name || "Shop";

  return (
    <main className="sf-page">
      <StorefrontHeader tag={shopName} />
      <div className="sf-body">
        {status === "loading" ? (
          <section className="sf-card sf-card--centered">
            <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
            <p>Loading your bill…</p>
          </section>
        ) : null}

        {status === "error" || status === "expired" ? (
          <section className="sf-card sf-card--centered sf-card--warning">
            <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
            <p>{errorMsg}</p>
          </section>
        ) : null}

        {bill && status !== "error" && status !== "expired" ? (
          <>
            <section className="sf-card">
              <h1 className="sf-title">Pay your bill</h1>
              <p className="sf-subtitle">
                Hi {bill.customer_name}. Your tab at <strong>{shopName}</strong> is{" "}
                <strong>{formatMoney(bill.outstanding_balance, currency)}</strong>.
              </p>
            </section>

            {status === "cleared" ? (
              <section className="sf-card sf-card--centered">
                <i className="fa-solid fa-circle-check" aria-hidden="true" />
                <p>Your tab is cleared. Thank you!</p>
              </section>
            ) : null}

            {status === "awaiting_mpesa" ? (
              <section className="sf-card sf-card--centered">
                <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                <p>
                  {bill.mpesa_payment?.message ||
                    "M-PESA prompt sent to your phone. Enter your PIN to complete payment."}
                </p>
              </section>
            ) : null}

            {status === "payment_failed" ? (
              <section className="sf-card sf-card--centered sf-card--warning">
                <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
                <p>{errorMsg}</p>
              </section>
            ) : null}

            {bill.can_pay && status !== "cleared" && status !== "awaiting_mpesa" ? (
              <form className="sf-card sf-cart" onSubmit={(e) => void onSubmit(e)}>
                <header className="sf-cart__head">
                  <strong>Pay with M-PESA</strong>
                </header>
                <label className="sf-field">
                  <span>WhatsApp / M-PESA number</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    disabled={status === "submitting"}
                  />
                </label>
                <label className="sf-field">
                  <span>Amount (KES)</span>
                  <input
                    type="number"
                    min={1}
                    step="1"
                    max={bill.outstanding_balance}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    disabled={status === "submitting"}
                  />
                </label>
                <label className="sf-check">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    disabled={status === "submitting"}
                  />
                  <span>I agree to pay this amount via M-PESA.</span>
                </label>
                <button
                  type="submit"
                  className="sf-checkout"
                  disabled={!consent || status === "submitting"}
                >
                  {status === "submitting" ? "Sending prompt…" : "Pay with M-PESA"}
                </button>
              </form>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
