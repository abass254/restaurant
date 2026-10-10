"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { notifyRouteChange } from "@/lib/navigation-loading";

export function NavigationLoadingToast() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstMount = useRef(true);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    notifyRouteChange(pathname);
  }, [pathname, searchParams]);

  return null;
}
