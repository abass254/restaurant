"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  isNavigationLoading,
  notifyNavigationStart,
  subscribeNavigationComplete,
  subscribeNavigationStart,
} from "@/lib/navigation-loading";
import { toastLoading } from "@/lib/alerts";

const FALLBACK_COMPLETE_MS = 1500;

export function PageLoadingBar() {
  const pathname = usePathname();
  const isFirstPath = useRef(true);
  const tickRef = useRef<number | null>(null);
  const fallbackRef = useRef<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  const stopTicks = () => {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (fallbackRef.current) {
      window.clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
    }
  };

  const begin = () => {
    stopTicks();
    setVisible(true);
    setProgress(14);

    tickRef.current = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 90) return current;
        return Math.min(90, current + Math.random() * 10 + 4);
      });
    }, 350);

    fallbackRef.current = window.setTimeout(stopTicks, FALLBACK_COMPLETE_MS);
  };

  const finish = () => {
    stopTicks();
    setProgress(100);
    window.setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 220);
  };

  useEffect(() => {
    const unsubStart = subscribeNavigationStart(begin);
    const unsubComplete = subscribeNavigationComplete(finish);
    return () => {
      unsubStart();
      unsubComplete();
      stopTicks();
    };
    // begin/finish are stable enough for mount-only subscriptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Programmatic navigation (router.push) may not emit a click we can catch.
  useEffect(() => {
    if (isFirstPath.current) {
      isFirstPath.current = false;
      return;
    }

    if (!isNavigationLoading()) {
      notifyNavigationStart();
      void toastLoading("Loading…");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!visible) return null;

  return (
    <div className="page-loading-bar" aria-hidden="true">
      <div
        className="page-loading-bar__track"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
