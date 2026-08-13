"use client";

import { useState } from "react";
import Link from "next/link";
import { usePwaInstall } from "@/hooks/usePwaInstall";

export function InstallPwaPanel() {
  const { canPrompt, installed, platform, prompting, promptInstall } =
    usePwaInstall();
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function copyLink() {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/install`
        : "/install";
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus("Could not copy — select the address bar and copy /install.");
    }
  }

  async function onInstall() {
    const ok = await promptInstall();
    setStatus(
      ok
        ? "Installed. Open DukAI from your home screen."
        : "Install dismissed. You can try again anytime.",
    );
  }

  return (
    <div className="install-pwa">
      <div className="install-pwa__icon" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={96} height={96} />
      </div>

      <h1>Download DukAI Merchant</h1>
      <p className="install-pwa__lead">
        Install the app on your phone or tablet for faster order alerts and a
        home-screen shortcut. No App Store needed — it installs from this page.
      </p>

      {installed ? (
        <div className="install-pwa__status install-pwa__status--ok">
          <i className="fas fa-circle-check" aria-hidden />
          Already installed. Open it from your home screen, or continue in the
          browser.
        </div>
      ) : canPrompt ? (
        <button
          type="button"
          className="cta-btn install-pwa__primary"
          disabled={prompting}
          onClick={() => void onInstall()}
        >
          <i className="fas fa-download" aria-hidden />
          {prompting ? "Opening install…" : "Install app"}
        </button>
      ) : (
        <div className="install-pwa__steps">
          {platform === "ios" ? (
            <>
              <h2>iPhone / iPad</h2>
              <ol>
                <li>
                  Tap the <strong>Share</strong> button{" "}
                  <i className="fas fa-arrow-up-from-bracket" aria-hidden /> in
                  Safari
                </li>
                <li>
                  Scroll and tap <strong>Add to Home Screen</strong>
                </li>
                <li>
                  Tap <strong>Add</strong>
                </li>
              </ol>
            </>
          ) : platform === "android" ? (
            <>
              <h2>Android</h2>
              <ol>
                <li>
                  Open this page in <strong>Chrome</strong>
                </li>
                <li>
                  Tap the menu <strong>⋮</strong>
                </li>
                <li>
                  Tap <strong>Install app</strong> or{" "}
                  <strong>Add to Home screen</strong>
                </li>
              </ol>
            </>
          ) : (
            <>
              <h2>Desktop</h2>
              <ol>
                <li>Open this page in Chrome or Edge</li>
                <li>
                  Click the install icon in the address bar, or use the browser
                  menu → <strong>Install DukAI Merchant</strong>
                </li>
              </ol>
            </>
          )}
        </div>
      )}

      {status && <p className="install-pwa__hint">{status}</p>}

      <div className="install-pwa__actions">
        <button type="button" className="cta-btn secondary" onClick={() => void copyLink()}>
          <i className="fas fa-link" aria-hidden />
          {copied ? "Link copied" : "Copy download link"}
        </button>
        <Link href="/m" className="cta-btn secondary">
          Open companion
        </Link>
        <Link href="/sign-in" className="cta-btn secondary">
          Log in
        </Link>
      </div>

      <p className="install-pwa__share">
        Share this link with your team:{" "}
        <code>/install</code>
      </p>
    </div>
  );
}
