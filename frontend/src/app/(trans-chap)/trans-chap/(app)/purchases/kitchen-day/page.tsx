"use client";

import { RestaurantKitchenDayReport } from "@/components/trans-chap/restaurant/RestaurantKitchenDayReport";
import { RestaurantOnly } from "@/components/trans-chap/restaurant/RestaurantOnly";

export default function TransChapKitchenDayPage() {
  return (
    <RestaurantOnly>
      <RestaurantKitchenDayReport />
    </RestaurantOnly>
  );
}
