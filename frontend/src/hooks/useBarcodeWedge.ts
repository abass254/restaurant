"use client";

import { useEffect, useRef } from "react";

type UseBarcodeWedgeOptions = {
  enabled?: boolean;
  minLength?: number;
  onScan: (code: string) => void;
};

/** Listen for HID keyboard-wedge barcode scanners (rapid keystrokes + Enter). */
export function useBarcodeWedge({
  enabled = true,
  minLength = 3,
  onScan,
}: UseBarcodeWedgeOptions) {
  const bufferRef = useRef("");
  const lastKeyAtRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    function isEditableElement(el: Element | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    function clearBuffer() {
      bufferRef.current = "";
      lastKeyAtRef.current = 0;
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableElement(document.activeElement)) return;

      if (event.key === "Enter") {
        const scanned = bufferRef.current.trim();
        clearBuffer();
        if (scanned.length < minLength) return;
        event.preventDefault();
        onScanRef.current(scanned);
        return;
      }

      if (event.key.length !== 1) return;

      const now = Date.now();
      if (now - lastKeyAtRef.current > 140) {
        bufferRef.current = "";
      }
      lastKeyAtRef.current = now;
      bufferRef.current += event.key;

      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        clearBuffer();
      }, 280);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearBuffer();
    };
  }, [enabled, minLength]);
}
