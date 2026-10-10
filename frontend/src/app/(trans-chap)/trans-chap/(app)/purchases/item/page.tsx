"use client";

import { RestaurantOnly } from "@/components/trans-chap/restaurant/RestaurantOnly";
import { RestaurantStockCard } from "@/components/trans-chap/restaurant/RestaurantStockCard";

export default function TransChapStockCardPage() {
  return (
    <RestaurantOnly>
      <RestaurantStockCard />
    </RestaurantOnly>
  );
}
