"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarcodeCamera } from "@/components/inventory/BarcodeCamera";
import { useTransChapCameraEnabled } from "@/hooks/useTransChapCameraEnabled";
import {
  queryCameraPermission,
  type CameraPermissionState,
} from "@/lib/trans-chap-camera";

const SETTINGS_HREF = "/trans-chap/settings?pane=camera";

type Props = {
  active: boolean;
  onScan: (code: string) => void;
  className?: string;
};

export function TransChapBarcodeCamera({ active, onScan, className }: Props) {
  const enabled = useTransChapCameraEnabled();
  const [permission, setPermission] = useState<CameraPermissionState>("unknown");

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void queryCameraPermission().then((state) => {
      if (alive) setPermission(state);
    });
    return () => {
      alive = false;
    };
  }, [active, enabled]);

  if (!active) return null;

  if (!enabled || permission === "denied" || permission === "insecure") {
    const title =
      permission === "denied"
        ? "Camera is blocked"
        : permission === "insecure"
          ? "Camera needs HTTPS"
          : "Camera is off";
    const body =
      permission === "denied"
        ? "Allow Camera for this site in your phone browser settings, then enable it again in DukAI Merch Settings."
        : permission === "insecure"
          ? "Open DukAI Merch over https:// so the browser can ask for camera access."
          : "Turn on barcode camera once in Settings. Scan pages will use it without asking again.";
    return (
      <div className={`trans-chap-camera-needed${className ? ` ${className}` : ""}`}>
        <i className="fa-solid fa-camera" aria-hidden />
        <strong>{title}</strong>
        <p>{body}</p>
        <Link href={SETTINGS_HREF} className="trans-chap-camera-needed__btn">
          Open camera settings
        </Link>
      </div>
    );
  }

  return (
    <BarcodeCamera
      active={active}
      onScan={onScan}
      className={className}
      autoStart={permission === "granted"}
    />
  );
}
