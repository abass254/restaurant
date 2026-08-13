"use client";

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { gaMeasurementId } from "@/lib/config";
import {
  clearAnalyticsConsent,
  readAnalyticsConsent,
  writeAnalyticsConsent,
  type AnalyticsConsent,
} from "@/lib/analytics-consent";
import { initAnalytics, resetAnalytics } from "@/lib/analytics";
import { AnalyticsTracker } from "@/components/consent/AnalyticsTracker";
import { CookieConsentBanner } from "@/components/consent/CookieConsentBanner";

type AnalyticsConsentContextValue = {
  consent: AnalyticsConsent | null;
  analyticsConfigured: boolean;
  accept: () => void;
  reject: () => void;
  reopenPreferences: () => void;
};

const AnalyticsConsentContext =
  createContext<AnalyticsConsentContextValue | null>(null);

export function AnalyticsConsentProvider({ children }: { children: ReactNode }) {
  const analyticsConfigured = Boolean(gaMeasurementId);
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConsent(readAnalyticsConsent());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || consent !== "accepted") {
      return;
    }
    initAnalytics();
  }, [ready, consent]);

  const accept = useCallback(() => {
    writeAnalyticsConsent("accepted");
    setConsent("accepted");
    initAnalytics();
  }, []);

  const reject = useCallback(() => {
    writeAnalyticsConsent("rejected");
    setConsent("rejected");
    resetAnalytics();
  }, []);

  const reopenPreferences = useCallback(() => {
    clearAnalyticsConsent();
    resetAnalytics();
    setConsent(null);
  }, []);

  const value = useMemo(
    () => ({
      consent,
      analyticsConfigured,
      accept,
      reject,
      reopenPreferences,
    }),
    [accept, analyticsConfigured, consent, reject, reopenPreferences],
  );

  return (
    <AnalyticsConsentContext.Provider value={value}>
      {children}
      {ready && analyticsConfigured && consent === null ? (
        <CookieConsentBanner onAccept={accept} onReject={reject} />
      ) : null}
      {ready && analyticsConfigured && consent === "accepted" ? (
        <Suspense fallback={null}>
          <AnalyticsTracker />
        </Suspense>
      ) : null}
    </AnalyticsConsentContext.Provider>
  );
}

export function useAnalyticsConsent() {
  const ctx = useContext(AnalyticsConsentContext);
  if (!ctx) {
    throw new Error(
      "useAnalyticsConsent must be used within AnalyticsConsentProvider",
    );
  }
  return ctx;
}
