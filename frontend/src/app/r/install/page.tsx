"use client";

import { useState } from "react";
import Link from "next/link";
import { usePwaInstall } from "@/hooks/usePwaInstall";

export default function RiderInstallPage() {
  const { canPrompt, installed, platform, prompting, promptInstall } = usePwaInstall();
  const [status, setStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onInstall() {
    const ok = await promptInstall();
    setStatus(
      ok
        ? "Installed. Open TransChap Rider from your home screen."
        : "Install dismissed. You can try again anytime.",
    );
  }

  async function copyLink() {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/r/install`
        : "/r/install";
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus("Could not copy — copy the URL from the address bar.");
    }
  }

  return (
    <section className="rider-card">
      <p className="rider-eyebrow">Install</p>
      <h1>Download TransChap Rider</h1>
      <p className="rider-muted">
        Add the app to your home screen for quicker access while delivering. No App Store
        required.
      </p>

      {installed ? (
        <p className="rider-banner">Already installed — open it from your home screen.</p>
      ) : null}

      <div className="rider-actions">
        {canPrompt ? (
          <button
            type="button"
            className="rider-btn rider-btn--primary"
            disabled={prompting}
            onClick={() => void onInstall()}
          >
            {prompting ? "Opening install…" : "Install app"}
          </button>
        ) : !installed ? (
          <div className="rider-install-steps">
            {platform === "ios" ? (
              <>
                <p className="rider-muted">
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
                <p className="rider-muted">
                  <strong>Android (Chrome)</strong>
                </p>
                <ol>
                  <li>Open the browser menu ⋮</li>
                  <li>Tap Install app or Add to Home screen</li>
                </ol>
              </>
            ) : (
              <>
                <p className="rider-muted">
                  <strong>Desktop (Chrome / Edge)</strong>
                </p>
                <ol>
                  <li>Use the install icon in the address bar</li>
                  <li>Or open the browser menu → Install TransChap Rider</li>
                </ol>
              </>
            )}
          </div>
        ) : null}

        <button type="button" className="rider-btn rider-btn--ghost" onClick={() => void copyLink()}>
          {copied ? "Link copied" : "Copy download link"}
        </button>
        <Link href="/r/home" className="rider-btn rider-btn--ghost">
          Back to home
        </Link>
      </div>

      {status ? <p className="rider-muted">{status}</p> : null}
    </section>
  );
}
