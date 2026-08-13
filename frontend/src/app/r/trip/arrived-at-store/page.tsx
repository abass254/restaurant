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
      expectedPhase="at_store"
      title="Arrived at store"
      subtitle="Confirm you are at the shop, then collect the items."
      primaryLabel="Start picking up"
      nextPhase="picking_up"
      showMaps="store"
      showItems
    />
  );
}

export default function ArrivedAtStorePage() {
  return (
    <Suspense fallback={<p className="rider-muted">Loading trip…</p>}>
      <Inner />
    </Suspense>
  );
}
