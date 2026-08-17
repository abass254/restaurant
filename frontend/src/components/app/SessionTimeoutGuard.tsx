"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import { setSuppressUnauthorizedEvents } from "@/lib/sessionGuardState";

type SessionTimeoutGuardProps = {
  loginPath: string;
  warningSeconds?: number;
  idleSeconds?: number;
};

type WarningReason = "inactivity" | "unauthorized";

const DEFAULT_WARNING_SECONDS = 60;
const DEFAULT_IDLE_SECONDS = 15 * 60;

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "click",
];

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
  idleSeconds = DEFAULT_IDLE_SECONDS,
}: SessionTimeoutGuardProps) {
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(warningSeconds);
  const [reason, setReason] = useState<WarningReason>("inactivity");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const warningTimeoutRef = useRef<number | null>(null);
  const logoutTimeoutRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const isWarningOpenRef = useRef(false);
  const isRecoveringRef = useRef(false);

  const goToLogin = useCallback(() => {
    window.location.href = loginPath;
  }, [loginPath]);

  const clearTimers = useCallback(() => {
    if (warningTimeoutRef.current !== null) {
      window.clearTimeout(warningTimeoutRef.current);
      warningTimeoutRef.current = null;
    }
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

  const startCountdown = useCallback(
    (mode: WarningReason) => {
      if (isRecoveringRef.current) {
        return;
      }

      clearTimers();
      isWarningOpenRef.current = true;
      setReason(mode);
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
    },
    [clearTimers, performLogout, warningSeconds],
  );

  const scheduleInactivityTimers = useCallback(() => {
    clearTimers();
    const delayMs = Math.max(idleSeconds - warningSeconds, 1) * 1000;
    warningTimeoutRef.current = window.setTimeout(() => {
      startCountdown("inactivity");
    }, delayMs);
  }, [clearTimers, idleSeconds, startCountdown, warningSeconds]);

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
      scheduleInactivityTimers();
    } catch {
      await performLogout();
      return;
    } finally {
      isRecoveringRef.current = false;
      setIsRefreshing(false);
      setSuppressUnauthorizedEvents(false);
    }
  }, [clearTimers, performLogout, scheduleInactivityTimers, warningSeconds]);

  const message = useMemo(() => {
    if (reason === "unauthorized") {
      return "Your session is no longer valid. You will be logged out shortly.";
    }
    return "You have been inactive. You will be logged out unless you continue your session.";
  }, [reason]);

  useEffect(() => {
    scheduleInactivityTimers();

    function onActivity() {
      if (isWarningOpenRef.current || isRecoveringRef.current) {
        return;
      }
      scheduleInactivityTimers();
    }

    function onUnauthorized() {
      if (isWarningOpenRef.current || isRecoveringRef.current) {
        return;
      }
      startCountdown("unauthorized");
    }

    ACTIVITY_EVENTS.forEach((eventName) =>
      window.addEventListener(eventName, onActivity, { passive: true }),
    );
    window.addEventListener("app:unauthorized", onUnauthorized as EventListener);

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) =>
        window.removeEventListener(eventName, onActivity),
      );
      window.removeEventListener("app:unauthorized", onUnauthorized as EventListener);
      clearTimers();
      setSuppressUnauthorizedEvents(false);
    };
  }, [clearTimers, scheduleInactivityTimers, startCountdown]);

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
          Session expiring soon
        </h2>
        <p className="session-timeout-modal__message">{message}</p>
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
            {reason === "unauthorized" ? "Sign in again" : "Log out now"}
          </button>
        </div>
      </div>
    </div>
  );
}
