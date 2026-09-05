"use client";

import { useCallback, useEffect, useState } from "react";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

function getFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function isFullscreenSupported(): boolean {
  const el = document.documentElement as FullscreenElement;
  return Boolean(el.requestFullscreen || el.webkitRequestFullscreen);
}

async function enterFullscreen(): Promise<void> {
  const el = document.documentElement as FullscreenElement;
  if (el.requestFullscreen) {
    await el.requestFullscreen();
    return;
  }
  await el.webkitRequestFullscreen?.();
}

async function exitFullscreen(): Promise<void> {
  const doc = document as FullscreenDocument;
  if (doc.exitFullscreen) {
    await doc.exitFullscreen();
    return;
  }
  await doc.webkitExitFullscreen?.();
}

export function FullscreenToggle() {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(isFullscreenSupported());

    const sync = () => setActive(Boolean(getFullscreenElement()));
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (getFullscreenElement()) await exitFullscreen();
      else await enterFullscreen();
    } catch {
      /* User dismissed or browser blocked fullscreen. */
    }
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      className="fullscreen-toggle"
      onClick={() => void toggle()}
      aria-label={active ? "Exit full screen" : "Enter full screen"}
      aria-pressed={active}
      title={active ? "Exit full screen" : "Full screen"}
    >
      <i
        className={`fas ${active ? "fa-compress" : "fa-expand"}`}
        aria-hidden="true"
      />
    </button>
  );
}
