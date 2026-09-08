"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarcodeCamera } from "@/components/inventory/BarcodeCamera";
import { useTransChapCameraEnabled } from "@/hooks/useTransChapCameraEnabled";
import {
  queryCameraPermission,
  type CameraPermissionState,
} from "@/lib/trans-chap-camera";

type Props = {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  title?: string;
};

export function TransChapBarcodeScannerSheet({
  open,
  onClose,
  onScan,
  title = "Scan barcode",
}: Props) {
  const enabled = useTransChapCameraEnabled();
  const [permission, setPermission] = useState<CameraPermissionState>("unknown");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void queryCameraPermission().then((state) => {
      if (alive) setPermission(state);
    });
    return () => {
      alive = false;
    };
  }, [open, enabled]);

  if (!open) return null;

  const blocked =
    !enabled || permission === "denied" || permission === "insecure";

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
          {blocked ? (
            <div className="trans-chap-camera-needed trans-chap-camera-needed--sheet">
              <i className="fa-solid fa-camera" aria-hidden />
              <strong>
                {permission === "denied"
                  ? "Camera is blocked"
                  : permission === "insecure"
                    ? "Camera needs HTTPS"
                    : "Camera is off"}
              </strong>
              <p>
                {permission === "denied"
                  ? "Enable Camera for this site in your phone browser settings, then turn it on in Trans Chap Settings."
                  : permission === "insecure"
                    ? "Open Trans Chap over https:// so the browser can ask for camera access."
                    : "Enable barcode camera in Settings first, then scan here."}
              </p>
              <Link
                href="/trans-chap/settings?pane=camera"
                className="trans-chap-camera-needed__btn"
                onClick={onClose}
              >
                Open camera settings
              </Link>
            </div>
          ) : (
            <BarcodeCamera
              active={open}
              onScan={onScan}
              autoStart={permission === "granted"}
            />
          )}
        </div>
        {!blocked ? (
          <p className="stock-scan-sheet__hint">
            Point at a barcode. You can also use a USB / Bluetooth scanner without the
            camera.
          </p>
        ) : null}
      </div>
    </div>
  );
}
