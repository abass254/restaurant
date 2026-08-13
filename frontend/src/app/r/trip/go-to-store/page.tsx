"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TripScreen } from "@/components/rider/TripScreen";

function GoToStoreInner() {
  const orderId = useSearchParams().get("order") || "";
  if (!orderId) return <p className="rider-muted">Missing delivery.</p>;
  return (
    <TripScreen
      orderId={orderId}
      expectedPhase="en_route_to_store"
      title="Go to the store"
      subtitle="Head to the shop to pick up this order."
      primaryLabel="I’ve arrived"
      nextPhase="at_store"
      showMaps="store"
    />
  );
}

export default function GoToStorePage() {
  return (
    <Suspense fallback={<p className="rider-muted">Loading trip…</p>}>
      <GoToStoreInner />
    </Suspense>
  );
}
