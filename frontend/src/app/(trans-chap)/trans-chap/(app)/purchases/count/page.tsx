"use client";

import { RestaurantOnly } from "@/components/trans-chap/restaurant/RestaurantOnly";
import { RestaurantStockTake } from "@/components/trans-chap/restaurant/RestaurantStockTake";

export default function TransChapStockTakePage() {
  return (
    <RestaurantOnly>
      <RestaurantStockTake />
    </RestaurantOnly>
  );
}
