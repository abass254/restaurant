"use client";

import { FormEvent, useState } from "react";
import { AddressLocationField } from "@/components/shared/AddressLocationField";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import type { LatLng } from "@/lib/google-maps";
import type { TestDeliveryDispatchResponse } from "@/lib/types";

type FormState = {
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  delivery_notes: string;
  delivery_fee: string;
};

const EMPTY_FORM: FormState = {
  customer_name: "",
  customer_phone: "",
  delivery_address: "",
  delivery_notes: "",
  delivery_fee: "150",
};

export function TestDeliveryDispatchSection() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [lastResult, setLastResult] = useState<TestDeliveryDispatchResponse | null>(
    null,
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setDispatching(true);
    try {
      const feeRaw = form.delivery_fee.trim();
      const deliveryFee = feeRaw === "" ? undefined : Number(feeRaw);
      if (deliveryFee !== undefined && (Number.isNaN(deliveryFee) || deliveryFee < 0)) {
        await showError("Invalid fee", "Delivery fee must be a non-negative number.");
        return;
      }

      const payload: Record<string, string | number> = {};
      if (form.customer_name.trim()) payload.customer_name = form.customer_name.trim();
      if (form.customer_phone.trim()) payload.customer_phone = form.customer_phone.trim();
      if (form.delivery_address.trim()) {
        payload.delivery_address = form.delivery_address.trim();
      }
      if (form.delivery_notes.trim()) payload.delivery_notes = form.delivery_notes.trim();
      if (deliveryFee !== undefined) payload.delivery_fee = deliveryFee;

      const data = await apiFetch<TestDeliveryDispatchResponse>(
        apiRoutes.orderTestDelivery,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      setLastResult(data);
      await toastSuccess(data.message);
    } catch (err) {
      await showError("Could not dispatch test order", extractErrorMessage(err));
    } finally {
      setDispatching(false);
    }
  }

  return (
    <article id="section-test-dispatch" className="settings-card">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <i className="fa-solid fa-paper-plane settings-card__icon" aria-hidden="true" />
          <h2>Test dispatch</h2>
        </div>
        <span className="settings-pill settings-pill--neutral">Rider app</span>
      </header>
      <div className="settings-card__body">
        <p className="settings-muted settings-card__lead">
          Create a ready dummy delivery and offer it to every online rider. Pin a drop-off
          on the map so the address looks real in the rider app.
        </p>
        <form
          className="settings-form settings-form--compact test-dispatch-form"
          onSubmit={(e) => void handleSubmit(e)}
        >
          <div className="test-dispatch-form__grid">
            <label className="settings-field">
              <span>Customer name (optional)</span>
              <input
                type="text"
                value={form.customer_name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, customer_name: e.target.value }))
                }
                placeholder="Test Customer"
                autoComplete="off"
              />
            </label>
            <label className="settings-field">
              <span>Customer phone (optional)</span>
              <input
                type="tel"
                value={form.customer_phone}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, customer_phone: e.target.value }))
                }
                placeholder="+254700000001"
                autoComplete="off"
              />
            </label>
          </div>

          <div className="test-dispatch-form__map">
            <AddressLocationField
              value={form.delivery_address}
              onChange={(value) =>
                setForm((prev) => ({ ...prev, delivery_address: value }))
              }
              onCoordsChange={setCoords}
              label="Drop-off location"
              placeholder="Search for a delivery address"
              variant="inline"
              allowMapPin
              showMap
              showCurrentLocation
            />
            {coords ? (
              <p className="settings-muted test-dispatch-form__coords">
                Pin: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              </p>
            ) : null}
          </div>

          <label className="settings-field">
            <span>Delivery notes (optional)</span>
            <input
              type="text"
              value={form.delivery_notes}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, delivery_notes: e.target.value }))
              }
              placeholder="TEST ORDER — ring the gate…"
              autoComplete="off"
            />
          </label>
          <label className="settings-field">
            <span>Delivery fee (KES)</span>
            <input
              type="number"
              min={0}
              step={1}
              value={form.delivery_fee}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, delivery_fee: e.target.value }))
              }
              autoComplete="off"
            />
          </label>
          <div className="settings-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={dispatching}>
              <i className="fa-solid fa-motorcycle" aria-hidden="true" />
              {dispatching ? "Dispatching…" : "Dispatch test order"}
            </button>
          </div>
        </form>

        {lastResult ? (
          <p className="settings-muted settings-card__footer">
            Last: <strong>{lastResult.data.order.order_number}</strong>
            {" · "}
            {lastResult.data.offers_created} offer
            {lastResult.data.offers_created === 1 ? "" : "s"}
            {" · "}
            {lastResult.data.eligible_riders} eligible rider
            {lastResult.data.eligible_riders === 1 ? "" : "s"} online
          </p>
        ) : null}
      </div>
    </article>
  );
}
