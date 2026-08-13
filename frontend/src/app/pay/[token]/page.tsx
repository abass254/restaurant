"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { StorefrontHeader } from "@/components/storefront/StorefrontHeader";
import { AddressLocationField } from "@/components/shared/AddressLocationField";
import {
  ALL_FULFILLMENT_TYPES,
  formatMoney,
  FULFILLMENT_ICONS,
  FULFILLMENT_LABELS,
} from "@/lib/orders";
import type {
  OrderFulfillmentType,
  PublicOrderPayment,
  PublicOrderPaymentResponse,
  PublicOrderPaymentSubmitResponse,
} from "@/lib/types";

type PageStatus =
  | "loading"
  | "ready"
  | "paid"
  | "expired"
  | "error"
  | "submitting"
  | "awaiting_mpesa"
  | "payment_failed";

const MPESA_POLL_MS = 3_000;

function mpesaFailed(payment: PublicOrderPayment["mpesa_payment"]): boolean {
  return payment?.status === "failed" || payment?.status === "cancelled";
}

export default function OrderPaymentPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";

  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [order, setOrder] = useState<PublicOrderPayment | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<OrderFulfillmentType>("delivery");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [consent, setConsent] = useState(true);

  const applyLoadedOrder = useCallback((data: PublicOrderPayment) => {
    setOrder(data);
    setName(data.suggested_name || data.delivery_details.full_name || "");
    setPhone(data.saved_phone || data.delivery_details.phone_number || "");
    setFulfillmentType(data.fulfillment_type || "delivery");
    setDeliveryLocation(data.delivery_details.delivery_location || "");
    setDeliveryInstructions(data.delivery_details.delivery_instructions || "");
    setErrorMsg(null);

    if (data.is_paid) {
      setStatus("paid");
      return;
    }
    if (data.mpesa_payment?.status === "pending") {
      setStatus("awaiting_mpesa");
      return;
    }
    if (mpesaFailed(data.mpesa_payment)) {
      setErrorMsg(
        data.mpesa_payment?.message ||
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
      setErrorMsg("Missing payment link.");
      return;
    }
    try {
      const res = await apiFetch<PublicOrderPaymentResponse>(apiRoutes.orderPay(token));
      applyLoadedOrder(res.data);
    } catch (err) {
      const gone = err instanceof ApiError && err.status === 410;
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : "This payment link is invalid or unavailable.",
      );
      setStatus(gone ? "expired" : "error");
    }
  }, [token, applyLoadedOrder]);

  const pollPayment = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch<PublicOrderPaymentResponse>(apiRoutes.orderPay(token));
      applyLoadedOrder(res.data);
    } catch {
      // Poll failures are best-effort while waiting for the M-PESA callback.
    }
  }, [token, applyLoadedOrder]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (status !== "awaiting_mpesa" || !token) return;
    const id = window.setInterval(() => {
      void pollPayment();
    }, MPESA_POLL_MS);
    return () => window.clearInterval(id);
  }, [status, token, pollPayment]);

  const deliveryReady =
    fulfillmentType === "pickup" ||
    (deliveryLocation.trim().length >= 5 && deliveryInstructions.trim().length >= 3);

  async function submitPayment() {
    if (!order || !token) return;
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const res = await apiFetch<PublicOrderPaymentSubmitResponse>(
        apiRoutes.orderPaySubmit(token),
        {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
            consent,
            fulfillment_type: fulfillmentType,
            delivery_location:
              fulfillmentType === "delivery" ? deliveryLocation.trim() : null,
            delivery_instructions:
              fulfillmentType === "delivery" ? deliveryInstructions.trim() : null,
          }),
        },
      );
      setOrder((prev) =>
        prev
          ? {
              ...prev,
              mpesa_payment: res.data.mpesa_payment ?? {
                status: "pending",
                message: res.data.message,
                can_retry: false,
              },
            }
          : prev,
      );
      setErrorMsg(null);
      setStatus("awaiting_mpesa");
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : "Payment could not be started. Please try again.",
      );
      setStatus("ready");
    }
  }

  const currency = order?.currency ?? "KES";
  const payAmount =
    order?.dev_mpesa_charge != null ? order.dev_mpesa_charge : order?.total ?? 0;

  return (
    <main className="sf-shell ot-shell">
      <StorefrontHeader tag="Secure payment" />

      {status === "loading" ? (
        <section className="sf-card sf-card--centered">
          <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
          <p>Loading your order…</p>
        </section>
      ) : null}

      {status === "expired" || status === "error" ? (
        <section className="sf-card sf-card--centered">
          <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
          <p>{errorMsg}</p>
        </section>
      ) : null}

      {order &&
      (status === "ready" ||
        status === "submitting" ||
        status === "awaiting_mpesa" ||
        status === "payment_failed" ||
        status === "paid") ? (
        <>
          <section className="sf-card">
            <h1 className="sf-title">Pay for {order.order_number}</h1>
            <p className="sf-subtitle">
              Total due: <strong>{formatMoney(order.total, currency)}</strong>
            </p>
            <ul className="sf-cart__lines">
              {order.items.map((line, index) => (
                <li key={`${line.product_name}-${index}`} className="sf-line">
                  <div className="sf-line__info">
                    <span className="sf-line__name">{line.product_name}</span>
                    <span className="sf-line__unit">Qty {line.quantity}</span>
                  </div>
                  <span className="sf-line__total">
                    {formatMoney(line.line_total, currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {status === "paid" ? (
            <section className="sf-card sf-card--centered">
              <i className="fa-solid fa-circle-check" aria-hidden="true" />
              <p>This order is already paid. Thank you!</p>
              {order.tracking_url ? (
                <Link href={order.tracking_url} className="sf-checkout">
                  Track your order
                </Link>
              ) : null}
            </section>
          ) : null}

          {status === "awaiting_mpesa" ? (
            <section className="sf-card sf-card--centered">
              <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
              <p>
                {order.mpesa_payment?.message ||
                  "M-PESA prompt sent to your phone. Enter your PIN to complete payment."}
              </p>
              <p className="sf-hint">
                This page updates automatically once your payment is confirmed.
              </p>
            </section>
          ) : null}

          {status === "payment_failed" ? (
            <section className="sf-card sf-card--centered sf-card--warning">
              <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
              <p>{errorMsg}</p>
            </section>
          ) : null}

          {order.can_pay &&
          status !== "paid" &&
          status !== "awaiting_mpesa" ? (
            <section className="sf-card sf-cart">
              <header className="sf-cart__head">
                <strong>Your details</strong>
              </header>

              <div className="sf-field">
                <span>How would you like to receive your order?</span>
                <div className="sf-pickers" role="radiogroup" aria-label="Fulfillment type">
                  {ALL_FULFILLMENT_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={fulfillmentType === type}
                      className={`sf-picker${fulfillmentType === type ? " is-active" : ""}`}
                      onClick={() => setFulfillmentType(type)}
                      disabled={status === "submitting"}
                    >
                      <i className={FULFILLMENT_ICONS[type]} aria-hidden="true" />
                      <span>{FULFILLMENT_LABELS[type]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <label className="sf-field">
                <span>Full name</span>
                <input
                  type="text"
                  autoComplete="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={status === "submitting"}
                />
              </label>

              <label className="sf-field">
                <span>M-PESA phone number</span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="07XX XXX XXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={status === "submitting"}
                />
              </label>

              {fulfillmentType === "delivery" ? (
                <div className="sf-delivery-fields">
                  <AddressLocationField
                    value={deliveryLocation}
                    onChange={setDeliveryLocation}
                    label="Delivery location"
                    placeholder="Search for a delivery address"
                    disabled={status === "submitting"}
                    allowMapPin
                  />

                  <label className="sf-field">
                    <span>Delivery instructions</span>
                    <textarea
                      rows={3}
                      placeholder="Gate code, landmark, call on arrival…"
                      value={deliveryInstructions}
                      onChange={(e) => setDeliveryInstructions(e.target.value)}
                      disabled={status === "submitting"}
                    />
                  </label>
                </div>
              ) : null}

              <label className="sf-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  disabled={status === "submitting"}
                />
                <span>
                  Save my name and phone for faster checkout next time. I agree to
                  this shop storing my details linked to my {order.platform} account.
                </span>
              </label>

              {errorMsg && status !== "payment_failed" ? (
                <p className="sf-error">{errorMsg}</p>
              ) : null}

              <button
                type="button"
                className="sf-checkout"
                onClick={() => void submitPayment()}
                disabled={
                  status === "submitting" ||
                  !name.trim() ||
                  !phone.trim() ||
                  !deliveryReady
                }
              >
                {status === "submitting" ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                    Sending M-PESA prompt…
                  </>
                ) : status === "payment_failed" ? (
                  <>
                    <i className="fa-solid fa-rotate-right" aria-hidden="true" />
                    Try again — Pay {formatMoney(payAmount, currency)}
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-lock" aria-hidden="true" />
                    Pay {formatMoney(payAmount, currency)}
                  </>
                )}
              </button>
              <p className="sf-hint">
                {order.dev_mpesa_charge != null ? (
                  <>
                    Dev mode — the M-PESA prompt will be{" "}
                    <strong>{formatMoney(order.dev_mpesa_charge, currency)}</strong>, not
                    the order total above.
                  </>
                ) : null}
                {order.dev_mpesa_charge != null ? " " : null}
                You will receive an M-PESA prompt on your phone. Enter your PIN to
                complete payment.
              </p>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
