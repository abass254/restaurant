"use client";

import { useState } from "react";
import { usePwaInstall } from "@/hooks/usePwaInstall";

export function PwaInstallBanner() {
  const { canPrompt, promptInstall } = usePwaInstall();
  const [hidden, setHidden] = useState(false);

  if (hidden || !canPrompt) return null;

  return (
    <div className="pwa-install">
      <div>
        <strong style={{ display: "block" }}>Install DukAI Merchant</strong>
        <span style={{ color: "var(--station-muted)", fontSize: "0.82rem" }}>
          Add to your home screen for faster order alerts.{" "}
          <a href="/install" style={{ color: "inherit", textDecoration: "underline" }}>
            Download link
          </a>
        </span>
      </div>
      <div className="station-ticket__actions">
        <button
          type="button"
          className="station-btn station-btn--primary"
          onClick={async () => {
            await promptInstall();
            setHidden(true);
          }}
        >
          Install
        </button>
        <button
          type="button"
          className="station-btn station-btn--ghost"
          onClick={() => setHidden(true)}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
