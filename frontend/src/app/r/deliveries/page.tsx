"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRider } from "@/components/rider/RiderProvider";

/** Legacy list route — resume active trip or send riders to home. */
export default function RiderDeliveriesRedirectPage() {
  const { me, loading } = useRider();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!me) {
      router.replace("/r/login");
      return;
    }
    if (me.active_trip_id && me.active_trip_route) {
      router.replace(
        `${me.active_trip_route}?order=${encodeURIComponent(me.active_trip_id)}`,
      );
      return;
    }
    router.replace(me.is_online ? "/r/online" : "/r/home");
  }, [loading, me, router]);

  return <p className="rider-muted">Opening rider home…</p>;
}
