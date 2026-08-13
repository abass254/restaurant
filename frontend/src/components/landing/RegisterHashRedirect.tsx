"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy #register hash opens the onboarding wizard. */
export function RegisterHashRedirect() {
  const router = useRouter();

  useEffect(() => {
    const redirectIfNeeded = () => {
      if (window.location.hash === "#register") {
        router.replace("/signup");
      }
    };
    redirectIfNeeded();
    window.addEventListener("hashchange", redirectIfNeeded);
    return () => window.removeEventListener("hashchange", redirectIfNeeded);
  }, [router]);

  return null;
}
