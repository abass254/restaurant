"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { StorefrontHeader } from "@/components/storefront/StorefrontHeader";
import { AddressLocationField } from "@/components/shared/AddressLocationField";
import { formatMoney } from "@/lib/orders";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import type {
  PublicOrderDeliveryDetailsResponse,
  PublicOrderTracking,
  PublicOrderTrackingResponse,
} from "@/lib/types";

type PageStatus = "loading" | "ready" | "expired" | "error";

const POLL_MS = 30_000;

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return formatNairobiDateTime(iso) || "—";
}

export default function OrderTrackingPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";

  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [order, setOrder] = useState<PublicOrderTracking | null>(null);
  const [acting, setActing] = useState<"confirm" | "dispute" | "delivery" | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setStatus("error");
      setErrorMsg("Missing tracking link.");
      return;
    }
    try {
      const res = await apiFetch<PublicOrderTrackingResponse>(
        apiRoutes.orderTrack(token),
      );
      setOrder(res.data);
      setErrorMsg(null);
      setStatus("ready");
      const details = res.data.delivery_details;
      if (details) {
        setFullName(details.full_name ?? "");
        setPhoneNumber(details.phone_number ?? "");
        setDeliveryLocation(details.delivery_location ?? "");
        setDeliveryInstructions(details.delivery_instructions ?? "");
      }
    } catch (err) {
      const gone = err instanceof ApiError && err.status === 410;
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : "This tracking link is invalid or unavailable.",
      );
      setStatus(gone ? "expired" : "error");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (status !== "ready" || !order || order.is_terminal) return;
    const id = window.setInterval(() => {
      void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [status, order, load]);

  async function confirmReceipt() {
    setActing("confirm");
    setActionMsg(null);
    try {
      const res = await apiFetch<{ message: string; data: PublicOrderTracking }>(
        apiRoutes.orderTrackConfirm(token),
        { method: "POST", body: "{}" },
      );
      setOrder(res.data);
      setActionMsg(res.message);
    } catch (err) {
      setActionMsg(
        err instanceof ApiError ? err.message : "Could not confirm receipt.",
      );
    } finally {
      setActing(null);
    }
  }

  async function disputeReceipt() {
    setActing("dispute");
    setActionMsg(null);
    try {
      const res = await apiFetch<{ message: string; data: PublicOrderTracking }>(
        apiRoutes.orderTrackDispute(token),
        { method: "POST", body: "{}" },
      );
      setOrder(res.data);
      setActionMsg(res.message);
    } catch (err) {
      setActionMsg(
        err instanceof ApiError ? err.message : "Could not report the issue.",
      );
    } finally {
      setActing(null);
    }
  }

  async function submitDeliveryDetails() {
    setActing("delivery");
    setDeliveryError(null);
    setActionMsg(null);
    try {
      const res = await apiFetch<PublicOrderDeliveryDetailsResponse>(
        apiRoutes.orderTrackDeliveryDetails(token),
        {
          method: "POST",
          body: JSON.stringify({
            full_name: fullName.trim(),
            phone_number: phoneNumber.trim(),
            delivery_location: deliveryLocation.trim(),
            delivery_instructions: deliveryInstructions.trim(),
          }),
        },
      );
      setOrder(res.data);
      setActionMsg(res.message);
    } catch (err) {
      setDeliveryError(
        err instanceof ApiError ? err.message : "Could not save delivery details.",
      );
    } finally {
      setActing(null);
    }
  }

  const steps = order?.workflow_steps ?? [];
  const showConfirm =
    order &&
    (order.can_confirm_receipt || order.can_dispute_receipt) &&
    !order.is_terminal;

  return (
    <main className="sf-shell ot-shell">
      <StorefrontHeader tag="Order tracking" />

      {status === "loading" ? (
        <section className="sf-card sf-card--centered">
          <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
          <p>Loading your order…</p>
        </section>
      ) : null}

      {status === "expired" ? (
        <section className="sf-card sf-card--centered">
          <i
            className="fa-solid fa-clock-rotate-left sf-card__icon"
            aria-hidden="true"
          />
          <h1>Link expired</h1>
          <p>{errorMsg ?? "This tracking link is no longer valid."}</p>
        </section>
      ) : null}

      {status === "error" ? (
        <section className="sf-card sf-card--centered">
          <i
            className="fa-solid fa-circle-exclamation sf-card__icon"
            aria-hidden="true"
          />
          <h1>Order unavailable</h1>
          <p>{errorMsg}</p>
        </section>
      ) : null}

      {status === "ready" && order ? (
        <>
          <section className="sf-card ot-summary">
            <div className="ot-summary__head">
              <div>
                <p className="ot-summary__ref">Order {order.order_number}</p>
                <h1 className="ot-summary__status">{order.status_label}</h1>
              </div>
              <span
                className={`ot-status-pill ot-status-pill--${order.status}`}
              >
                {order.fulfillment_type === "pickup" ? "Pickup" : "Delivery"}
              </span>
            </div>
            <p className="ot-summary__placed">
              Placed {formatWhen(order.placed_at)}
            </p>
            {!order.is_terminal ? (
              <p className="ot-summary__hint">
                <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />{" "}
                Updates automatically every 30 seconds
              </p>
            ) : null}
          </section>

          {order.can_submit_delivery_details ? (
            <section className="sf-card ot-delivery">
              <h2 className="ot-delivery__title">Delivery details</h2>
              <p className="ot-delivery__hint">
                Your order is ready. Share where we should deliver it so the shop can
                dispatch your order. Delivery instructions are required.
              </p>

              <label className="sf-field">
                <span>Full name</span>
                <input
                  type="text"
                  autoComplete="name"
                  placeholder="Your full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={acting !== null}
                />
              </label>

              <label className="sf-field">
                <span>Phone number</span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="07XX XXX XXX"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  disabled={acting !== null}
                />
              </label>

              <AddressLocationField
                value={deliveryLocation}
                onChange={setDeliveryLocation}
                label="Delivery location"
                placeholder="Search for a delivery address"
                disabled={acting !== null}
                allowMapPin
              />

              <label className="sf-field">
                <span>Delivery instructions</span>
                <textarea
                  rows={3}
                  placeholder="Gate code, landmark, call on arrival…"
                  value={deliveryInstructions}
                  onChange={(e) => setDeliveryInstructions(e.target.value)}
                  disabled={acting !== null}
                />
              </label>

              {deliveryError ? <p className="sf-error">{deliveryError}</p> : null}
              {actionMsg && !deliveryError ? (
                <p className="ot-delivery__note">{actionMsg}</p>
              ) : null}

              <button
                type="button"
                className="sf-btn sf-btn--primary"
                disabled={
                  acting !== null ||
                  !fullName.trim() ||
                  !phoneNumber.trim() ||
                  !deliveryLocation.trim() ||
                  !deliveryInstructions.trim()
                }
                onClick={() => void submitDeliveryDetails()}
              >
                {acting === "delivery" ? "Saving…" : "Save delivery details"}
              </button>
            </section>
          ) : null}

          {showConfirm ? (
            <section className="sf-card ot-confirm">
              <h2 className="ot-confirm__title">
                {order.fulfillment_type === "pickup"
                  ? "Did you pick up your order?"
                  : "Did you receive your order?"}
              </h2>
              {order.awaiting_confirmation ? (
                <ul className="ot-confirm__checks">
                  <li className={order.merchant_confirmed ? "is-done" : ""}>
                    Shop {order.merchant_confirmed ? "confirmed" : "pending"}
                  </li>
                  <li className={order.customer_confirmed ? "is-done" : ""}>
                    You {order.customer_confirmed ? "confirmed" : "pending"}
                  </li>
                </ul>
              ) : null}
              {order.delivery_disputed ? (
                <p className="ot-confirm__note">
                  You reported an issue. The shop will follow up with you.
                </p>
              ) : (
                <div className="ot-confirm__actions">
                  {order.can_confirm_receipt ? (
                    <button
                      type="button"
                      className="sf-btn sf-btn--primary"
                      disabled={acting !== null}
                      onClick={() => void confirmReceipt()}
                    >
                      {acting === "confirm" ? "Confirming…" : "Yes, received"}
                    </button>
                  ) : null}
                  {order.can_dispute_receipt && !order.delivery_disputed ? (
                    <button
                      type="button"
                      className="sf-btn sf-btn--ghost"
                      disabled={acting !== null}
                      onClick={() => void disputeReceipt()}
                    >
                      {acting === "dispute" ? "Sending…" : "Something is wrong"}
                    </button>
                  ) : null}
                </div>
              )}
              {actionMsg ? <p className="ot-confirm__note">{actionMsg}</p> : null}
            </section>
          ) : null}

          {steps.length > 0 ? (
            <section className="sf-card ot-progress">
              <h2 className="ot-progress__title">Progress</h2>
              <ol className="ot-steps" aria-label="Order progress">
                {steps.map((step) => (
                  <li
                    key={step.key}
                    className={`ot-steps__step ot-steps__step--${step.state}`}
                  >
                    <span className="ot-steps__dot" aria-hidden="true">
                      {step.state === "done" ? (
                        <i className="fa-solid fa-check" />
                      ) : null}
                    </span>
                    <span className="ot-steps__label">{step.label}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="sf-card ot-items">
            <h2 className="ot-items__title">Your items</h2>
            <ul className="ot-items__list">
              {order.items.map((line, index) => (
                <li key={`${line.product_name}-${index}`}>
                  <span>
                    {line.quantity}× {line.product_name}
                  </span>
                  <strong>{formatMoney(line.line_total, order.currency)}</strong>
                </li>
              ))}
            </ul>
            <div className="ot-items__totals">
              {order.delivery_fee > 0 ? (
                <div className="ot-items__row">
                  <span>Delivery</span>
                  <span>{formatMoney(order.delivery_fee, order.currency)}</span>
                </div>
              ) : null}
              {order.discount > 0 ? (
                <div className="ot-items__row">
                  <span>Discount</span>
                  <span>−{formatMoney(order.discount, order.currency)}</span>
                </div>
              ) : null}
              <div className="ot-items__row ot-items__row--grand">
                <strong>Total</strong>
                <strong>{formatMoney(order.total, order.currency)}</strong>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
