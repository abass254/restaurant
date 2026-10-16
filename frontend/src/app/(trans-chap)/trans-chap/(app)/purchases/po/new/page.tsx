"use client";

import { RestaurantOnly } from "@/components/trans-chap/restaurant/RestaurantOnly";
import { RestaurantPurchaseOrderForm } from "@/components/trans-chap/restaurant/RestaurantPurchaseOrderForm";

export default function TransChapNewPurchaseOrderPage() {
  return (
    <RestaurantOnly>
      <RestaurantPurchaseOrderForm />
    </RestaurantOnly>
  );
}
