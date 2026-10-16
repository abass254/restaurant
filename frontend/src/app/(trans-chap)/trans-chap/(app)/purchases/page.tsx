"use client";

import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapPurchasesList } from "@/components/trans-chap/TransChapPurchasesList";
import { RestaurantSuppliesHub } from "@/components/trans-chap/restaurant/RestaurantSuppliesHub";
import { isRestaurantStore } from "@/lib/onboarding";

export default function TransChapPurchasesPage() {
  const user = useAuthUser();
  if (isRestaurantStore(user.active_account ?? user.account)) return <RestaurantSuppliesHub />;
  return <TransChapPurchasesList />;
}
