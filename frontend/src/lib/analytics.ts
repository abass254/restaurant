import { gaMeasurementId } from "@/lib/config";
import { readAnalyticsConsent } from "@/lib/analytics-consent";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let initialized = false;

export function isAnalyticsEnabled(): boolean {
  return Boolean(gaMeasurementId) && readAnalyticsConsent() === "accepted";
}

export function initAnalytics(): void {
  if (!gaMeasurementId || !isAnalyticsEnabled() || initialized) {
    return;
  }

  if (typeof window === "undefined") {
    return;
  }

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  };

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`;
  document.head.appendChild(script);

  window.gtag("js", new Date());
  window.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  window.gtag("config", gaMeasurementId, {
    anonymize_ip: true,
    send_page_view: false,
  });

  initialized = true;
}

export function resetAnalytics(): void {
  initialized = false;
  if (typeof window !== "undefined") {
    delete window.gtag;
    delete window.dataLayer;
  }
}

export function trackPageView(path: string): void {
  if (!isAnalyticsEnabled() || typeof window === "undefined" || !window.gtag) {
    return;
  }

  window.gtag("event", "page_view", {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}
