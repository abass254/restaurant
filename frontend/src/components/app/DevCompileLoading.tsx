"use client";

import { useEffect, useState } from "react";
import { DukAiLogoMark } from "@/components/landing/DukAiLogoMark";
import { isDebugMode, isDevEnvironment } from "@/lib/config";

const STATUS_LABELS = new Set([
  "Rendering",
  "Rendering...",
  "Compiling",
  "Compiling...",
  "Prerendering",
  "Prerendering...",
]);

function getPortalShadow(): ShadowRoot | null {
  const portal = document.querySelector("nextjs-portal");
  return portal?.shadowRoot ?? null;
}

function readBuildStatus(shadow: ShadowRoot): string | null {
  const dot = shadow.querySelector("[data-status-dot]");
  if (dot) {
    const label =
      dot.parentElement?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (label) return label;
    return "Rendering...";
  }

  for (const el of shadow.querySelectorAll("*")) {
    if (el.children.length > 0) continue;
    const text = el.textContent?.trim() ?? "";
    if (STATUS_LABELS.has(text)) return text;
  }
  return null;
}

/** Hide Next's status pill inside the shadow root; keep error overlay usable. */
function hideNextStatusPill(shadow: ShadowRoot) {
  if (shadow.getElementById("dukai-hide-next-status")) return;
  const style = document.createElement("style");
  style.id = "dukai-hide-next-status";
  style.textContent = `
    [data-status-dot],
    [data-status-dot] ~ *,
    *:has(> [data-status-dot]) {
      opacity: 0 !important;
      pointer-events: none !important;
      width: 0 !important;
      min-width: 0 !important;
      height: 0 !important;
      overflow: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
    }
  `;
  shadow.appendChild(style);
}

/**
 * When `NEXT_PUBLIC_DEBUG` is on (dev default), replace the Next.js
 * bottom-left "Rendering… / Compiling…" badge with DukAI's loading effect.
 */
export function DevCompileLoading() {
  const enabled = isDebugMode && isDevEnvironment;
  const [active, setActive] = useState(false);
  const [label, setLabel] = useState("Loading…");

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let observer: MutationObserver | null = null;
    let pollId = 0;
    let attachedTo: ShadowRoot | null = null;

    const sync = () => {
      if (cancelled) return;
      const shadow = getPortalShadow();
      if (!shadow) {
        setActive(false);
        return;
      }

      if (attachedTo !== shadow) {
        attachedTo = shadow;
        hideNextStatusPill(shadow);
        observer?.disconnect();
        observer = new MutationObserver(sync);
        observer.observe(shadow, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
      }

      const status = readBuildStatus(shadow);
      if (status) {
        setLabel(
          status.toLowerCase().includes("compil")
            ? "Compiling…"
            : status.toLowerCase().includes("prerender")
              ? "Prerendering…"
              : "Rendering…",
        );
        setActive(true);
      } else {
        setActive(false);
      }
    };

    sync();
    // Portal mounts async after hydration.
    pollId = window.setInterval(sync, 400);

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.clearInterval(pollId);
    };
  }, [enabled]);

  if (!enabled || !active) return null;

  return (
    <div className="dev-compile-loading" role="status" aria-live="polite">
      <div className="dev-compile-loading__bar" aria-hidden="true">
        <div className="dev-compile-loading__track" />
      </div>
      <div className="dev-compile-loading__toast">
        <DukAiLogoMark size={18} color="#ffffff" accentColor="#ffffff" />
        <span>{label}</span>
      </div>
    </div>
  );
}
