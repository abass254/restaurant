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
        ? "Installed. Open Trans Chap from your home screen."
        : "Install dismissed. You can try again anytime.",
    );
  }

  async function copyLink() {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/trans-chap/install`
        : "/trans-chap/install";
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus("Could not copy — copy the URL from the address bar.");
    }
  }

  return (
    <div className="trans-chap-install">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="trans-chap-install__mark"
        src="/icons/trans-chap-icon.svg"
        alt=""
        width={128}
        height={128}
      />
      <p className="trans-chap-install__lead">
        Add Trans Chap to your home screen. It opens this sales app only — not the
        full merchant dashboard. No App Store required.
      </p>

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
                <li>Or open the browser menu → Install Trans Chap</li>
              </ol>
            </>
          )}
        </div>
      )}

      <button type="button" className="trans-chap-install__copy" onClick={() => void copyLink()}>
        {copied ? "Link copied" : "Copy download link"}
      </button>

      {showOpenLink ? (
        <Link href="/trans-chap" className="trans-chap-receipt__again">
          Open Trans Chap
        </Link>
      ) : null}

      {status ? <p className="trans-chap-install__hint">{status}</p> : null}
    </div>
  );
}
