"use client";

import { RestaurantOnly } from "@/components/trans-chap/restaurant/RestaurantOnly";
import { RestaurantPurchaseOrderDetail } from "@/components/trans-chap/restaurant/RestaurantPurchaseOrderDetail";

export default function TransChapPurchaseOrderPage() {
  return (
    <RestaurantOnly>
      <RestaurantPurchaseOrderDetail />
    </RestaurantOnly>
  );
}
