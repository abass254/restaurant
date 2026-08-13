"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { userCanAccessSection } from "@/lib/merchant-permissions";

const ALLOWED_WITHOUT_ONBOARDING = ["/tools", "/settings", "/bot", "/messages"];

export function OnboardingGate() {
  const user = useAuthUser();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const ig = user.instagram_account;
    if (!ig) {
      return;
    }

    if (ig.onboarding_complete) {
      return;
    }

    const allowed = ALLOWED_WITHOUT_ONBOARDING.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    );
    if (allowed) {
      return;
    }

    const blockedSection =
      pathname.startsWith("/messages") || pathname.startsWith("/tickets")
        ? "tickets"
        : pathname.startsWith("/tools") || pathname.startsWith("/bot")
          ? "tools"
          : null;

    if (blockedSection && !userCanAccessSection(user, blockedSection)) {
      return;
    }

    router.replace("/tools/onboarding");
  }, [pathname, router, user.instagram_account, user]);

  return null;
}
