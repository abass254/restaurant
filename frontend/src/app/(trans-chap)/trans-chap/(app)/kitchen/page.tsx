"use client";

import { RestaurantKitchenTab } from "@/components/trans-chap/restaurant/RestaurantKitchenTab";
import { RestaurantOnly } from "@/components/trans-chap/restaurant/RestaurantOnly";

export default function TransChapKitchenPage() {
  return (
    <RestaurantOnly>
      <RestaurantKitchenTab />
    </RestaurantOnly>
  );
}
