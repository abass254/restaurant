"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TripScreen } from "@/components/rider/TripScreen";

function Inner() {
  const orderId = useSearchParams().get("order") || "";
  if (!orderId) return <p className="rider-muted">Missing delivery.</p>;
  return (
    <TripScreen
      orderId={orderId}
      expectedPhase="at_client"
      title="Complete delivery"
      subtitle="Hand the order to the customer, then confirm delivery."
      primaryLabel="Confirm delivered"
      nextPhase="confirm"
      showMaps="client"
      showCall
      showItems
    />
  );
}

export default function DeliveryProcessPage() {
  return (
    <Suspense fallback={<p className="rider-muted">Loading trip…</p>}>
      <Inner />
    </Suspense>
  );
}
