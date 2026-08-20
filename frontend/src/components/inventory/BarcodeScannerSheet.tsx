"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";

type BarcodeScannerSheetProps = {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  title?: string;
};

export function BarcodeScannerSheet({
  open,
  onClose,
  onScan,
  title = "Scan barcode",
}: BarcodeScannerSheetProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastCodeRef = useRef<string>("");
  const lastAtRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    async function start() {
      setError(null);
      setStarting(true);
      try {
        if (!videoRef.current) return;
        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
            },
          },
          videoRef.current,
          (result, _err, controls) => {
            controlsRef.current = controls;
            if (!result || cancelled) return;
            const text = result.getText().trim();
            if (!text) return;
            const now = Date.now();
            if (
              text === lastCodeRef.current &&
              now - lastAtRef.current < 1500
            ) {
              return;
            }
            lastCodeRef.current = text;
            lastAtRef.current = now;
            onScan(text);
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Could not open the camera.";
        setError(
          /Permission|NotAllowed/i.test(message)
            ? "Camera permission denied. Allow camera access or use a USB barcode scanner."
            : message,
        );
      } finally {
        if (!cancelled) setStarting(false);
      }
    }

    void start();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onScan]);

  if (!open) return null;

  return (
    <div className="stock-scan-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="stock-scan-sheet__backdrop" onClick={onClose} />
      <div className="stock-scan-sheet__panel">
        <header className="stock-scan-sheet__head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="stock-scan-sheet__viewport">
          <video ref={videoRef} muted playsInline className="stock-scan-sheet__video" />
          <div className="stock-scan-sheet__frame" aria-hidden="true" />
        </div>
        {starting && !error ? (
          <p className="stock-scan-sheet__hint">Starting camera…</p>
        ) : null}
        {error ? <p className="stock-scan-sheet__error">{error}</p> : null}
        <p className="stock-scan-sheet__hint">
          Point at a barcode. You can also use a USB / Bluetooth scanner without the camera.
        </p>
      </div>
    </div>
  );
}
