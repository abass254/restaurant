"use client";

import { useState } from "react";
import Link from "next/link";
import { usePwaInstall } from "@/hooks/usePwaInstall";

export function TransChapInstallPanel({
  showOpenLink = true,
}: {
  showOpenLink?: boolean;
}) {
  const { canPrompt, installed, platform, prompting, promptInstall } = usePwaInstall();
  const [status, setStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onInstall() {
    const ok = await promptInstall();
    setStatus(
      ok
        ? "Installed. Open TransChap from your home screen."
        : "Install dismissed. You can try again anytime.",
    );
  }

  async function copyLink() {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/install`
        : "/install";
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus("Could not copy — copy the URL from the address bar.");
    }
  }

  return (
    <div className="trans-chap-install ios-settings-detail">
      <p className="ios-settings__footer ios-settings__footer--top">
        Add TransChap to your home screen. It opens this sales app only — not the
        full merchant dashboard. No App Store required.
      </p>

      <div className="ios-settings__group">
        <div className="ios-settings__card ios-settings__card--pad ios-settings__card--center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="trans-chap-install__mark"
            src="/icons/trans-chap-icon.svg"
            alt=""
            width={88}
            height={88}
          />
          {installed ? (
            <p className="trans-chap-install__status">
              Already installed. Open it from your home screen.
            </p>
          ) : canPrompt ? (
            <button
              type="button"
              className="auth-split__btn"
              disabled={prompting}
              onClick={() => void onInstall()}
            >
              {prompting ? "Opening install…" : "Install app"}
            </button>
          ) : (
            <div className="trans-chap-install__steps">
              {platform === "ios" ? (
                <>
                  <p>
                    <strong>iPhone / iPad (Safari)</strong>
                  </p>
                  <ol>
                    <li>Tap Share</li>
                    <li>Tap Add to Home Screen</li>
                    <li>Tap Add</li>
                  </ol>
                </>
              ) : platform === "android" ? (
                <>
                  <p>
                    <strong>Android (Chrome)</strong>
                  </p>
                  <ol>
                    <li>Open the browser menu ⋮</li>
                    <li>Tap Install app or Add to Home screen</li>
                  </ol>
                </>
              ) : (
                <>
                  <p>
                    <strong>Desktop (Chrome / Edge)</strong>
                  </p>
                  <ol>
                    <li>Use the install icon in the address bar</li>
                    <li>Or open the browser menu → Install TransChap</li>
                  </ol>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="ios-settings__group">
        <div className="ios-settings__card">
          <button type="button" className="ios-settings__row" onClick={() => void copyLink()}>
            <span className="ios-settings__label ios-settings__label--action">
              {copied ? "Link Copied" : "Copy Download Link"}
            </span>
          </button>
          {showOpenLink ? (
            <Link href="/" className="ios-settings__row">
              <span className="ios-settings__label ios-settings__label--action">
                Open TransChap
              </span>
              <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>

      {status ? <p className="ios-settings__footer">{status}</p> : null}
    </div>
  );
}
