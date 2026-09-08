"use client";

const STORAGE_KEY = "trans-chap.cameraScanning";
const CHANGE_EVENT = "trans-chap-camera-change";

export type CameraPermissionState =
  | "granted"
  | "denied"
  | "prompt"
  | "unsupported"
  | "insecure"
  | "unknown";

export type CameraPermissionResult = {
  ok: boolean;
  state: CameraPermissionState;
  message?: string;
};

function emitChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function isCameraScanningEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setCameraScanningEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* private mode */
  }
  emitChange();
}

export function subscribeCameraScanningEnabled(
  listener: (enabled: boolean) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key && event.key !== STORAGE_KEY) return;
    listener(isCameraScanningEnabled());
  };
  const onCustom = () => listener(isCameraScanningEnabled());
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onCustom);
  };
}

function getUserMediaFn():
  | ((constraints: MediaStreamConstraints) => Promise<MediaStream>)
  | null {
  if (typeof navigator === "undefined") return null;
  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  }
  const legacy = navigator as Navigator & {
    getUserMedia?: (
      constraints: MediaStreamConstraints,
      success: (stream: MediaStream) => void,
      error: (err: Error) => void,
    ) => void;
    webkitGetUserMedia?: (
      constraints: MediaStreamConstraints,
      success: (stream: MediaStream) => void,
      error: (err: Error) => void,
    ) => void;
  };
  const fn = legacy.getUserMedia || legacy.webkitGetUserMedia;
  if (!fn) return null;
  return (constraints) =>
    new Promise((resolve, reject) => {
      fn.call(navigator, constraints, resolve, reject);
    });
}

export async function queryCameraPermission(): Promise<CameraPermissionState> {
  if (typeof window === "undefined") return "unknown";
  if (!window.isSecureContext) return "insecure";
  if (!getUserMediaFn()) return "unsupported";

  const permissions = navigator.permissions;
  if (!permissions?.query) return "unknown";

  try {
    const status = await permissions.query({
      name: "camera" as PermissionName,
    });
    if (status.state === "granted") return "granted";
    if (status.state === "denied") return "denied";
    if (status.state === "prompt") return "prompt";
  } catch {
    /* iOS / Firefox may reject camera permission queries */
  }
  return "unknown";
}

const REQUEST_CONSTRAINTS: MediaStreamConstraints[] = [
  { audio: false, video: { facingMode: { ideal: "environment" } } },
  { audio: false, video: { facingMode: "environment" } },
  { audio: false, video: true },
];

/** Must run from a user gesture so Android Chrome shows the system prompt. */
export async function requestCameraPermission(): Promise<CameraPermissionResult> {
  if (typeof window === "undefined") {
    return { ok: false, state: "unsupported", message: "Camera is unavailable." };
  }
  if (!window.isSecureContext) {
    return {
      ok: false,
      state: "insecure",
      message:
        "Camera needs HTTPS. Open Trans Chap with https:// — http://192.168… will not show a permission prompt.",
    };
  }

  const gum = getUserMediaFn();
  if (!gum) {
    return {
      ok: false,
      state: "unsupported",
      message: "This browser cannot open the camera.",
    };
  }

  let lastError: unknown;
  for (const constraints of REQUEST_CONSTRAINTS) {
    try {
      const stream = await gum(constraints);
      stream.getTracks().forEach((track) => track.stop());
      setCameraScanningEnabled(true);
      return { ok: true, state: "granted" };
    } catch (err) {
      lastError = err;
    }
  }

  const name = lastError instanceof DOMException ? lastError.name : "";
  const message = lastError instanceof Error ? lastError.message : "";
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    /Permission|NotAllowed|denied/i.test(message)
  ) {
    return {
      ok: false,
      state: "denied",
      message:
        "Camera access is blocked. Enable Camera for this site in your phone browser settings, then try again.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return {
      ok: false,
      state: "unsupported",
      message: "No camera was found on this device.",
    };
  }
  return {
    ok: false,
    state: "unknown",
    message: message || "Could not open the camera.",
  };
}

export function cameraPermissionLabel(state: CameraPermissionState): string {
  switch (state) {
    case "granted":
      return "Allowed";
    case "denied":
      return "Blocked";
    case "prompt":
      return "Not asked";
    case "insecure":
      return "Needs HTTPS";
    case "unsupported":
      return "Unavailable";
    default:
      return "Unknown";
  }
}
