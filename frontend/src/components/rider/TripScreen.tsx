"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { extractErrorMessage, showError } from "@/lib/alerts";
import { formatMoney } from "@/lib/orders";
import { mapsUrl, telHref, TRIP_PHASE_LABELS } from "@/lib/rider-maps";
import type { RiderDelivery, RiderDeliveryMutationResponse } from "@/lib/types";

type Props = {
  orderId: string;
  expectedPhase: string;
  title: string;
  subtitle: string;
  primaryLabel: string;
  nextPhase: string | "confirm";
  showMaps?: "store" | "client";
  showItems?: boolean;
  showCall?: boolean;
};

export function TripScreen({
  orderId,
  expectedPhase,
  title,
  subtitle,
  primaryLabel,
  nextPhase,
  showMaps,
  showItems,
  showCall,
}: Props) {
  const [delivery, setDelivery] = useState<RiderDelivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      void apiFetch<{ data: RiderDelivery }>(apiRoutes.riderDelivery(orderId))
        .then((res) => {
          if (!alive) return;
          setDelivery(res.data);
        })
        .catch(async (err) => {
          await showError("Could not load delivery", extractErrorMessage(err));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [orderId]);

  async function advance() {
    if (!delivery) return;
    setActing(true);
    try {
      if (nextPhase === "confirm") {
        await apiFetch<RiderDeliveryMutationResponse>(
          apiRoutes.riderDeliveryConfirm(orderId),
          { method: "POST", body: "{}" },
        );
        window.location.href = "/r/home?done=1";
        return;
      }
      const res = await apiFetch<RiderDeliveryMutationResponse>(
        apiRoutes.riderDeliveryTrip(orderId),
        { method: "POST", body: JSON.stringify({ phase: nextPhase }) },
      );
      const route = res.data.trip_route || "/r/home";
      window.location.href = `${route}?order=${encodeURIComponent(orderId)}`;
    } catch (err) {
      await showError("Could not update trip", extractErrorMessage(err));
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return <p className="rider-muted">Loading trip…</p>;
  }
  if (!delivery) {
    return <p className="rider-muted">Delivery not found.</p>;
  }

  const phase = delivery.rider_trip_phase || "";
  const phaseMismatch = expectedPhase && phase && phase !== expectedPhase;

  const mapsHref =
    showMaps === "store"
      ? mapsUrl({
          address: delivery.store_location,
          lat: delivery.store_lat,
          lng: delivery.store_lng,
        })
      : showMaps === "client"
        ? mapsUrl({ address: delivery.delivery_address })
        : null;

  const callHref = showCall ? telHref(delivery.customer_phone) : null;

  return (
    <section className="rider-card rider-trip">
      <p className="rider-eyebrow">
        {TRIP_PHASE_LABELS[phase] || phase || "Active trip"} · #{delivery.order_number}
      </p>
      <h1>{title}</h1>
      <p className="rider-muted">{subtitle}</p>

      {phaseMismatch ? (
        <p className="rider-banner">
          This trip is at “{TRIP_PHASE_LABELS[phase] || phase}”.{" "}
          <a href={delivery.trip_route || "/r/home"}>Continue where you left off</a>
        </p>
      ) : null}

      <dl className="rider-facts">
        {delivery.store_name ? (
          <>
            <dt>Store</dt>
            <dd>{delivery.store_name}</dd>
          </>
        ) : null}
        {delivery.store_location ? (
          <>
            <dt>Pickup</dt>
            <dd>{delivery.store_location}</dd>
          </>
        ) : null}
        {delivery.delivery_address ? (
          <>
            <dt>Drop-off</dt>
            <dd>{delivery.delivery_address}</dd>
          </>
        ) : null}
        {delivery.customer_name ? (
          <>
            <dt>Customer</dt>
            <dd>{delivery.customer_name}</dd>
          </>
        ) : null}
        {delivery.delivery_notes ? (
          <>
            <dt>Notes</dt>
            <dd>{delivery.delivery_notes}</dd>
          </>
        ) : null}
        <dt>Order total</dt>
        <dd>{formatMoney(delivery.total, delivery.currency)}</dd>
      </dl>

      {showItems ? (
        <ul className="rider-items">
          {delivery.items.map((item) => (
            <li key={`${item.product_name}-${item.quantity}`}>
              <span>{item.quantity}×</span> {item.product_name}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="rider-actions">
        {mapsHref ? (
          <a className="rider-btn rider-btn--ghost" href={mapsHref} target="_blank" rel="noreferrer">
            Open in Maps
          </a>
        ) : null}
        {callHref ? (
          <a className="rider-btn rider-btn--ghost" href={callHref}>
            Call customer
          </a>
        ) : null}
        <button
          type="button"
          className="rider-btn rider-btn--primary"
          disabled={acting || Boolean(phaseMismatch)}
          onClick={() => void advance()}
        >
          {acting ? "Working…" : primaryLabel}
        </button>
      </div>
    </section>
  );
}
