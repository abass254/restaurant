"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapMenuForm } from "@/components/trans-chap/TransChapMenuForm";
import { isRestaurantStore } from "@/lib/onboarding";

import { PlatformRuntimeProvider } from "@/lib/platform-runtime";

export default function TransChapMenuPage() {
  const router = useRouter();
  const user = useAuthUser();
  const restaurant = isRestaurantStore(user.active_account ?? user.account);

  useEffect(() => {
    if (!restaurant) {
      router.replace("/trans-chap/stocks");
    }
  }, [restaurant, router]);

  if (!restaurant) return null;

  return (
    <PlatformRuntimeProvider>
      <div className="trans-chap-pos-host fb-app">
        <TransChapMenuForm />
      </div>
    </PlatformRuntimeProvider>
  );
}
