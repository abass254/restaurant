"use client";

import { useSearchParams } from "next/navigation";
import { RestaurantKitchenTab } from "@/components/trans-chap/restaurant/RestaurantKitchenTab";
import { RestaurantOnly } from "@/components/trans-chap/restaurant/RestaurantOnly";
import { RestaurantStationsList } from "@/components/trans-chap/restaurant/RestaurantStationsList";

export default function TransChapKitchenPage() {
  const searchParams = useSearchParams();
  const stationId = searchParams.get("station")?.trim() || "";

  return (
    <RestaurantOnly>
      {stationId ? <RestaurantKitchenTab /> : <RestaurantStationsList />}
    </RestaurantOnly>
  );
}
