"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { extractErrorMessage, showError } from "@/lib/alerts";
import { formatMoney } from "@/lib/orders";
import { parseIso } from "@/lib/nairobi-time";
import type { RiderDeliveryMutationResponse, RiderOffer, RiderOffersResponse } from "@/lib/types";
import { useRider } from "@/components/rider/RiderProvider";

export default function RiderOfferPage() {
  const params = useParams<{ offerId: string }>();
  const offerId = params?.offerId || "";
  const router = useRouter();
  const { refresh } = useRider();
  const [offer, setOffer] = useState<RiderOffer | null>(null);
  const [acting, setActing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      void apiFetch<RiderOffersResponse>(apiRoutes.riderOffers)
        .then((res) => {
          if (!alive) return;
          const found = res.data.find((o) => o.id === offerId) || res.data[0] || null;
          setOffer(found);
          if (!found) {
            router.replace("/r/online");
          }
        })
        .catch(async (err) => {
          await showError("Could not load offer", extractErrorMessage(err));
          router.replace("/r/online");
        });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [offerId, router]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const expiresAt = offer?.expires_at;
  const secondsLeft = expiresAt
    ? Math.max(0, Math.ceil(((parseIso(expiresAt)?.getTime() ?? 0) - now) / 1000))
    : 0;

  useEffect(() => {
    if (offer && secondsLeft <= 0) {
      router.replace("/r/online");
    }
  }, [offer, secondsLeft, router]);

  async function accept() {
    if (!offer) return;
    setActing(true);
    try {
      const res = await apiFetch<RiderDeliveryMutationResponse>(
        apiRoutes.riderOfferAccept(offer.id),
        { method: "POST", body: "{}" },
      );
      await refresh();
      const route = res.data.trip_route || "/r/trip/go-to-store";
      router.replace(`${route}?order=${encodeURIComponent(res.data.id)}`);
    } catch (err) {
      await showError("Could not accept offer", extractErrorMessage(err));
      router.replace("/r/online");
    } finally {
      setActing(false);
    }
  }

  async function decline() {
    if (!offer) return;
    setActing(true);
    try {
      await apiFetch(apiRoutes.riderOfferDecline(offer.id), {
        method: "POST",
        body: "{}",
      });
      router.replace("/r/online");
    } catch (err) {
      await showError("Could not decline offer", extractErrorMessage(err));
    } finally {
      setActing(false);
    }
  }

  if (!offer) {
    return <p className="rider-muted">Loading offer…</p>;
  }

  return (
    <section className="rider-card">
      <p className="rider-eyebrow">Incoming order</p>
      <h1>New delivery</h1>
      <p className="rider-offer-timer">{secondsLeft}s</p>
      <p className="rider-muted">Accept before the timer runs out.</p>

      <dl className="rider-facts">
        <dt>Store</dt>
        <dd>{offer.store_name}</dd>
        <dt>Pickup</dt>
        <dd>{offer.store_location || "Store location"}</dd>
        <dt>Drop-off</dt>
        <dd>{offer.delivery_address || "Customer address"}</dd>
        <dt>Items</dt>
        <dd>{offer.item_count}</dd>
        <dt>Payout</dt>
        <dd>{formatMoney(offer.payout_estimate, offer.currency)}</dd>
        <dt>Order</dt>
        <dd>
          #{offer.order_number} · {formatMoney(offer.total, offer.currency)}
        </dd>
      </dl>

      <div className="rider-actions">
        <button
          type="button"
          className="rider-btn rider-btn--primary"
          disabled={acting}
          onClick={() => void accept()}
        >
          {acting ? "Accepting…" : "Accept"}
        </button>
        <button
          type="button"
          className="rider-btn rider-btn--danger"
          disabled={acting}
          onClick={() => void decline()}
        >
          Decline
        </button>
      </div>
    </section>
  );
}
