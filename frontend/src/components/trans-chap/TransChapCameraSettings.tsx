"use client";

import { useCallback, useEffect, useState } from "react";
import { showInternalError, toastSuccess } from "@/lib/alerts";
import {
  cameraPermissionLabel,
  isCameraScanningEnabled,
  queryCameraPermission,
  requestCameraPermission,
  setCameraScanningEnabled,
  subscribeCameraScanningEnabled,
  type CameraPermissionState,
} from "@/lib/trans-chap-camera";

export function TransChapCameraSettings() {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<CameraPermissionState>("unknown");
  const [busy, setBusy] = useState(false);

  const refreshPermission = useCallback(async () => {
    const state = await queryCameraPermission();
    setPermission(state);
    return state;
  }, []);

  useEffect(() => {
    setEnabled(isCameraScanningEnabled());
    void refreshPermission();
    return subscribeCameraScanningEnabled(setEnabled);
  }, [refreshPermission]);

  async function enableCamera() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await requestCameraPermission();
      setPermission(result.state);
      setEnabled(isCameraScanningEnabled());
      if (result.ok) {
        await toastSuccess("Camera ready for barcode scanning");
        return;
      }
      await showInternalError();
    } catch {
      await showInternalError();
    } finally {
      setBusy(false);
    }
  }

  function disableCamera() {
    setCameraScanningEnabled(false);
    setEnabled(false);
    void toastSuccess("Barcode camera turned off");
  }

  const statusValue = !enabled
    ? "Off"
    : permission === "granted"
      ? "Ready"
      : cameraPermissionLabel(permission);

  return (
    <div className="trans-chap-camera-settings">
      <section className="ios-settings__group" aria-label="Camera status">
        <div className="ios-settings__card">
          <div className="ios-settings__row ios-settings__row--static">
            <span className="ios-settings__icon ios-settings__icon--camera" aria-hidden>
              <i className="fa-solid fa-camera" />
            </span>
            <span className="ios-settings__label">Barcode camera</span>
            <span className="ios-settings__value">{statusValue}</span>
          </div>
        </div>
        <p className="ios-settings__footer">
          Grant camera access once here. Sales and purchase scan pages will use it
          without asking again on every visit.
        </p>
      </section>

      <section className="ios-settings__group" aria-label="Camera actions">
        <div className="ios-settings__card">
          {enabled && permission === "granted" ? (
            <button
              type="button"
              className="ios-settings__row ios-settings__row--danger"
              onClick={disableCamera}
              disabled={busy}
            >
              <span className="ios-settings__label ios-settings__label--center">
                Turn Off Camera Scanning
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="ios-settings__row"
              onClick={() => void enableCamera()}
              disabled={busy}
              aria-busy={busy}
            >
              <span className="ios-settings__icon ios-settings__icon--camera" aria-hidden>
                <i className="fa-solid fa-camera" />
              </span>
              <span className="ios-settings__label">
                {busy ? "Requesting…" : "Enable Camera"}
              </span>
              <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
            </button>
          )}
        </div>
        {permission === "denied" ? (
          <p className="ios-settings__footer">
            Camera is blocked for this site. Open your phone browser site settings,
            allow Camera, then tap Enable Camera again.
          </p>
        ) : permission === "insecure" ? (
          <p className="ios-settings__footer">
            This page is not HTTPS. Camera permission will not appear on
            http://192.168… — use https:// or localhost via USB reverse.
          </p>
        ) : (
          <p className="ios-settings__footer">
            Tap Enable Camera, then Allow on the system prompt. You can still use USB
            barcode scanners without the camera.
          </p>
        )}
      </section>
    </div>
  );
}
