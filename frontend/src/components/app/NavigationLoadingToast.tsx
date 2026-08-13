"use client";

import { useEffect } from "react";
import { finishNavigationLoading } from "@/lib/alerts";
import {
  subscribeNavigationComplete,
  subscribeNavigationStart,
} from "@/lib/navigation-loading";

const FALLBACK_DISMISS_MS = 1500;

export function NavigationLoadingToast() {
  useEffect(() => {
    let fallback: number | null = null;

    const clearFallback = () => {
      if (fallback) {
        window.clearTimeout(fallback);
        fallback = null;
      }
    };

    const unsubStart = subscribeNavigationStart(() => {
      clearFallback();
      fallback = window.setTimeout(() => finishNavigationLoading(), FALLBACK_DISMISS_MS);
    });

    const unsubComplete = subscribeNavigationComplete(clearFallback);

    return () => {
      unsubStart();
      unsubComplete();
      clearFallback();
    };
  }, []);

  return null;
}
