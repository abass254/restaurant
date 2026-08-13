"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthUser } from "@/components/app/AuthProvider";
import {
  firstAllowedPath,
  userCanAccessPath,
} from "@/lib/merchant-permissions";

export function MerchantSectionGate() {
  const user = useAuthUser();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!userCanAccessPath(user, pathname)) {
      router.replace(firstAllowedPath(user));
    }
  }, [pathname, router, user]);

  return null;
}
