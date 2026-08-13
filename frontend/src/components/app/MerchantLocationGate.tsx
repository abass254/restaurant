"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { accountNeedsLocationSetup } from "@/lib/account-location";
import { useGoogleMapsPublicConfig } from "@/lib/useGoogleMapsPublicConfig";

const ALLOWED_WITHOUT_LOCATION = ["/basics", "/settings", "/tools", "/bot", "/messages"];

export function MerchantLocationGate() {
  const user = useAuthUser();
  const pathname = usePathname();
  const router = useRouter();
  const { mapEnabled, loading } = useGoogleMapsPublicConfig();

  useEffect(() => {
    if (loading || !mapEnabled) {
      return;
    }

    if (!accountNeedsLocationSetup(user.account)) {
      return;
    }

    const allowed = ALLOWED_WITHOUT_LOCATION.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    );
    if (allowed) {
      return;
    }

    router.replace("/basics");
  }, [loading, mapEnabled, pathname, router, user.account]);

  return null;
}

export function MerchantLocationBanner() {
  const user = useAuthUser();
  const pathname = usePathname();
  const { mapEnabled, loading } = useGoogleMapsPublicConfig();

  if (loading || !mapEnabled || !accountNeedsLocationSetup(user.account)) {
    return null;
  }

  if (pathname.startsWith("/basics") || pathname.startsWith("/settings")) {
    return null;
  }

  return (
    <div className="merchant-location-banner" role="status">
      <div className="merchant-location-banner__copy">
        <i className="fa-solid fa-location-dot" aria-hidden="true" />
        <span>
          <strong>Set your shop location</strong> on the map so delivery routes and fees
          work correctly.
        </span>
      </div>
      <Link href="/basics" className="btn btn-primary btn-sm">
        Set location
      </Link>
    </div>
  );
}
