"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  isNavigationLoading,
  notifyNavigationStart,
  notifyRouteChange,
  subscribeNavigationComplete,
  subscribeNavigationStart,
} from "@/lib/navigation-loading";
import { toastLoading } from "@/lib/alerts";

export function PageLoadingBar() {
  const pathname = usePathname();
  const isFirstPath = useRef(true);
  const tickRef = useRef<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  const stopTicks = () => {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const begin = () => {
    stopTicks();
    setVisible(true);
    setProgress(16);

    tickRef.current = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 95) return current;
        if (current < 45) return current + Math.random() * 8 + 4;
        if (current < 70) return current + Math.random() * 4 + 2;
        if (current < 86) return current + Math.random() * 2 + 1;
        return Math.min(95, current + 0.35);
      });
    }, 240);
  };

  const finish = () => {
    stopTicks();
    setProgress(100);
    window.setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 260);
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
      notifyNavigationStart(pathname);
      void toastLoading("Loading…");
    }
    notifyRouteChange(pathname);
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
