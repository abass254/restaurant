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
      expectedPhase="picking_up"
      title="Picking up"
      subtitle="Check every item, then mark the order as picked up."
      primaryLabel="Order picked up"
      nextPhase="en_route_to_client"
      showItems
    />
  );
}

export default function PickingUpPage() {
  return (
    <Suspense fallback={<p className="rider-muted">Loading trip…</p>}>
      <Inner />
    </Suspense>
  );
}
