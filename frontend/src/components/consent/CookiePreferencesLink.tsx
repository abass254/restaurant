"use client";

import { useAnalyticsConsent } from "@/components/consent/AnalyticsConsentProvider";

type CookiePreferencesLinkProps = {
  className?: string;
};

export function CookiePreferencesLink({
  className,
}: CookiePreferencesLinkProps) {
  const { analyticsConfigured, reopenPreferences } = useAnalyticsConsent();

  if (!analyticsConfigured) {
    return null;
  }

  return (
    <button
      type="button"
      className={className ?? "cookie-preferences-link"}
      onClick={reopenPreferences}
    >
      Cookie preferences
    </button>
  );
}

export function CookiePreferencesFooterItem({
  className,
}: CookiePreferencesLinkProps) {
  const { analyticsConfigured, reopenPreferences } = useAnalyticsConsent();

  if (!analyticsConfigured) {
    return null;
  }

  return (
    <li>
      <button
        type="button"
        className={className ?? "footer-link-btn cookie-preferences-link"}
        onClick={reopenPreferences}
      >
        Cookie preferences
      </button>
    </li>
  );
}
