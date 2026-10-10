"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useAuthUser } from "@/components/app/AuthProvider";
import { isRestaurantStore } from "@/lib/onboarding";

export function RestaurantOnly({ children }: { children: ReactNode }) {
  const user = useAuthUser();
  if (isRestaurantStore(user.active_account ?? user.account)) return <>{children}</>;
  return (
    <div className="rs">
      <p className="rs-empty">
        This page is for restaurants. <Link href="/trans-chap/purchases">Back to purchases</Link>
      </p>
    </div>
  );
}
