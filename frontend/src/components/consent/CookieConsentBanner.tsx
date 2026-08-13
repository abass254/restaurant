"use client";

import Link from "next/link";

type CookieConsentBannerProps = {
  onAccept: () => void;
  onReject: () => void;
};

export function CookieConsentBanner({
  onAccept,
  onReject,
}: CookieConsentBannerProps) {
  return (
    <div
      className="cookie-consent"
      role="dialog"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-desc"
    >
      <div className="cookie-consent__inner">
        <div className="cookie-consent__copy">
          <p id="cookie-consent-title" className="cookie-consent__title">
            Cookies for analytics
          </p>
          <p id="cookie-consent-desc" className="cookie-consent__text">
            We use optional analytics cookies to understand how visitors use our
            site and improve DukAI. Accepting enables Google Analytics. Rejecting
            keeps the site working without analytics tracking.{" "}
            <Link href="/privacy_policy">Privacy Policy</Link>
            {" · "}
            <Link href="/terms">Terms of Service</Link>
          </p>
        </div>
        <div className="cookie-consent__actions">
          <button
            type="button"
            className="cookie-consent__btn cookie-consent__btn--secondary"
            onClick={onReject}
          >
            Reject
          </button>
          <button
            type="button"
            className="cookie-consent__btn cookie-consent__btn--primary"
            onClick={onAccept}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
