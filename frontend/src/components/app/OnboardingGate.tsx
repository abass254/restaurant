"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { userCanAccessSection } from "@/lib/merchant-permissions";

const IG_SURFACES = ["/tickets", "/messages", "/feeds"];

function isInstagramSurface(pathname: string): boolean {
  return IG_SURFACES.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function OnboardingGate() {
  const user = useAuthUser();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const ig = user.instagram_account;
    if (!ig || ig.onboarding_complete) {
      return;
    }

    if (pathname === "/tools/onboarding" || pathname.startsWith("/tools/onboarding/")) {
      return;
    }

    if (!isInstagramSurface(pathname)) {
      return;
    }

    if (!userCanAccessSection(user, pathname.startsWith("/feeds") ? "feeds" : "tickets")) {
      return;
    }

    router.replace("/tools/onboarding");
  }, [pathname, router, user]);

  return null;
}
