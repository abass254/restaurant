"use client";

import { usePathname } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import { accountNeedsLocationSetup } from "@/lib/account-location";

function isRiderLocationPath(pathname: string): boolean {
  return (
    pathname === "/delivery" ||
    pathname.startsWith("/delivery/") ||
    pathname === "/tools/delivery" ||
    pathname.startsWith("/tools/delivery/")
  );
}

export function MerchantLocationBanner() {
  const user = useAuthUser();
  const pathname = usePathname();
  const account = user.active_account ?? user.account;

  if (!isRiderLocationPath(pathname) || !accountNeedsLocationSetup(account)) {
    return null;
  }

  return (
    <div className="merchant-location-banner" role="status">
      <div className="merchant-location-banner__copy">
        <i className="fa-solid fa-location-dot" aria-hidden="true" />
        <span>
          <strong>Pin your store location</strong> so riders can find your shop.
        </span>
      </div>
      <a href="#section-store-location" className="btn btn-primary btn-sm">
        Set location
      </a>
    </div>
  );
}
