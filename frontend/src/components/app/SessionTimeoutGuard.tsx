"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { setSuppressUnauthorizedEvents } from "@/lib/sessionGuardState";

type SessionTimeoutGuardProps = {
  loginPath: string;
  warningSeconds?: number;
};

const DEFAULT_WARNING_SECONDS = 60;

function formatCountdown(secondsLeft: number): string {
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  if (mins <= 0) {
    return `${secs}s`;
  }
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

export function SessionTimeoutGuard({
  loginPath,
  warningSeconds = DEFAULT_WARNING_SECONDS,
}: SessionTimeoutGuardProps) {
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(warningSeconds);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const logoutTimeoutRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const isWarningOpenRef = useRef(false);
  const isRecoveringRef = useRef(false);

  const goToLogin = useCallback(() => {
    window.location.href = loginPath;
  }, [loginPath]);

  const clearTimers = useCallback(() => {
    if (logoutTimeoutRef.current !== null) {
      window.clearTimeout(logoutTimeoutRef.current);
      logoutTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current !== null) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const performLogout = useCallback(async () => {
    clearTimers();
    isWarningOpenRef.current = false;
    isRecoveringRef.current = false;
    setSuppressUnauthorizedEvents(true);
    setWarningOpen(false);

    try {
      await apiFetch(apiRoutes.logout, { method: "POST" });
    } catch {
      // Best effort; redirect even if logout API fails.
    }
    goToLogin();
  }, [clearTimers, goToLogin]);

  const startCountdown = useCallback(() => {
    if (isRecoveringRef.current || isWarningOpenRef.current) {
      return;
    }

    clearTimers();
    isWarningOpenRef.current = true;
    setWarningOpen(true);
    setSecondsLeft(warningSeconds);

    const startedAt = Date.now();
    countdownIntervalRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const remaining = Math.max(warningSeconds - elapsed, 0);
      setSecondsLeft(remaining);
    }, 250);

    logoutTimeoutRef.current = window.setTimeout(() => {
      void performLogout();
    }, warningSeconds * 1000);
  }, [clearTimers, performLogout, warningSeconds]);

  const keepSessionAlive = useCallback(async () => {
    if (isRecoveringRef.current) {
      return;
    }

    isRecoveringRef.current = true;
    isWarningOpenRef.current = false;
    setSuppressUnauthorizedEvents(true);
    clearTimers();
    setWarningOpen(false);
    setSecondsLeft(warningSeconds);
    setIsRefreshing(true);

    try {
      await apiFetch(apiRoutes.sessionRefresh, { method: "POST" });
    } catch {
      await performLogout();
      return;
    } finally {
      isRecoveringRef.current = false;
      setIsRefreshing(false);
      setSuppressUnauthorizedEvents(false);
    }
  }, [clearTimers, performLogout, warningSeconds]);

  useEffect(() => {
    function onUnauthorized() {
      startCountdown();
    }

    window.addEventListener("app:unauthorized", onUnauthorized as EventListener);

    return () => {
      window.removeEventListener("app:unauthorized", onUnauthorized as EventListener);
      clearTimers();
      setSuppressUnauthorizedEvents(false);
    };
  }, [clearTimers, startCountdown]);

  if (!warningOpen) {
    return null;
  }

  return (
    <div className="session-timeout-modal" role="presentation">
      <div
        className="session-timeout-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-timeout-title"
      >
        <h2 id="session-timeout-title" className="session-timeout-modal__title">
          Session expired
        </h2>
        <p className="session-timeout-modal__message">
          Your session is no longer valid. You will be logged out shortly.
        </p>
        <p className="session-timeout-modal__countdown">
          Logging out in <strong>{formatCountdown(secondsLeft)}</strong>
        </p>
        <div className="session-timeout-modal__actions">
          <button
            type="button"
            className="session-timeout-modal__button session-timeout-modal__button--primary"
            onClick={() => void keepSessionAlive()}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing session..." : "Stay signed in"}
          </button>
          <button
            type="button"
            className="session-timeout-modal__button session-timeout-modal__button--secondary"
            onClick={() => void performLogout()}
            disabled={isRefreshing}
          >
            Sign in again
          </button>
        </div>
      </div>
    </div>
  );
}
