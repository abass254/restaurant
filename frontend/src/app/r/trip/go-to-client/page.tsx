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
      expectedPhase="en_route_to_client"
      title="Go to the client"
      subtitle="Navigate to the customer and hand over the order."
      primaryLabel="I’m at the customer"
      nextPhase="at_client"
      showMaps="client"
      showCall
    />
  );
}

export default function GoToClientPage() {
  return (
    <Suspense fallback={<p className="rider-muted">Loading trip…</p>}>
      <Inner />
    </Suspense>
  );
}
