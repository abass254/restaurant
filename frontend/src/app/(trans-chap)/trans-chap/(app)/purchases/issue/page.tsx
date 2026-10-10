"use client";

import { RestaurantKitchenIssue } from "@/components/trans-chap/restaurant/RestaurantKitchenIssue";
import { RestaurantOnly } from "@/components/trans-chap/restaurant/RestaurantOnly";

export default function TransChapKitchenIssuePage() {
  return (
    <RestaurantOnly>
      <RestaurantKitchenIssue />
    </RestaurantOnly>
  );
}
