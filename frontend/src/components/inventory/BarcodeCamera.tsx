"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";

type NativeBarcodeDetector = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};

type LegacyGetUserMedia = (
  constraints: MediaStreamConstraints,
  success: (stream: MediaStream) => void,
  error: (err: Error) => void,
) => void;

const NATIVE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf",
  "codabar",
  "qr_code",
  "data_matrix",
];

/** Simple constraints first so Android Chrome shows the permission prompt. */
const CAMERA_CONSTRAINTS: MediaStreamConstraints[] = [
  { audio: false, video: { facingMode: { ideal: "environment" } } },
  { audio: false, video: { facingMode: "environment" } },
  { audio: false, video: true },
];

function createNativeDetector(): NativeBarcodeDetector | null {
  const Ctor = (
    globalThis as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => NativeBarcodeDetector;
    }
  ).BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: NATIVE_FORMATS });
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

function createZxingReader() {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 80,
    delayBetweenScanSuccess: 1200,
    tryPlayVideoTimeout: 8000,
  });
}

function getUserMediaFn(): ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | null {
  if (typeof navigator === "undefined") return null;
  const devices = navigator.mediaDevices;
  if (devices?.getUserMedia) {
    return devices.getUserMedia.bind(devices);
  }
  const legacy = navigator as Navigator & {
    getUserMedia?: LegacyGetUserMedia;
    webkitGetUserMedia?: LegacyGetUserMedia;
    mozGetUserMedia?: LegacyGetUserMedia;
  };
  const fn = legacy.getUserMedia || legacy.webkitGetUserMedia || legacy.mozGetUserMedia;
  if (!fn) return null;
  return (constraints) =>
    new Promise((resolve, reject) => {
      fn.call(navigator, constraints, resolve, reject);
    });
}

function cameraErrorMessage(err: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Camera needs HTTPS. Open this site with https:// — a phone on http://192.168… will not show a permission prompt.";
  }
  const name = err instanceof DOMException ? err.name : "";
  const message = err instanceof Error ? err.message : "";
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    /Permission|NotAllowed|denied/i.test(message)
  ) {
    return "Camera access is blocked. Tap Allow camera, or enable Camera for this site in your phone settings.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found on this device.";
  }
  if (name === "NotReadableError") {
    return "The camera is in use by another app. Close it and try again.";
  }
  if (!getUserMediaFn()) {
    return "This browser cannot open the camera.";
  }
  return message || "Could not open the camera.";
}

async function requestCameraStream(): Promise<MediaStream> {
  const gum = getUserMediaFn();
  if (!gum) {
    throw new Error("This browser cannot open the camera.");
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error("insecure");
  }
  let lastError: unknown;
  for (const constraints of CAMERA_CONSTRAINTS) {
    try {
      return await gum(constraints);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not open the camera.");
}

async function playVideo(video: HTMLVideoElement, stream: MediaStream) {
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.autoplay = true;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.controls = false;
  video.srcObject = stream;

  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      video.addEventListener("loadedmetadata", done, { once: true });
      video.addEventListener("canplay", done, { once: true });
      window.setTimeout(done, 1200);
    });
  }

  try {
    await video.play();
  } catch {
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    await video.play();
  }
}

type BarcodeCameraProps = {
  active: boolean;
  onScan: (code: string) => void;
  className?: string;
};

export function BarcodeCamera({ active, onScan, className }: BarcodeCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopScanRef = useRef<(() => void) | null>(null);
  const startingRef = useRef(false);
  const generationRef = useRef(0);
  const lastCodeRef = useRef("");
  const lastAtRef = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [live, setLive] = useState(false);

  const emitScan = useCallback((code: string) => {
    const text = code.trim();
    if (!text) return;
    const now = Date.now();
    if (text === lastCodeRef.current && now - lastAtRef.current < 1500) {
      return;
    }
    lastCodeRef.current = text;
    lastAtRef.current = now;
    onScanRef.current(text);
  }, []);

  const releaseStream = useCallback(() => {
    stopScanRef.current?.();
    stopScanRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    startingRef.current = false;
    releaseStream();
    setLive(false);
    setStarting(false);
  }, [releaseStream]);

  const startCamera = useCallback(async () => {
    if (startingRef.current || streamRef.current) return;
    startingRef.current = true;
    const generation = generationRef.current;

    // Ask for the camera in the same user-gesture turn as the tap.
    // setState before getUserMedia drops the prompt on Android Chrome.
    let stream: MediaStream;
    try {
      stream = await requestCameraStream();
    } catch (err) {
      if (generation !== generationRef.current) return;
      startingRef.current = false;
      setStarting(false);
      setError(cameraErrorMessage(err));
      return;
    }

    if (generation !== generationRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    setError(null);
    setStarting(true);
    releaseStream();
    streamRef.current = stream;

    try {
      const video = videoRef.current;
      if (!video) {
        throw new Error("Camera preview is not ready. Close and try again.");
      }
      await playVideo(video, stream);
      if (generation !== generationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setLive(true);

      const detector = createNativeDetector();
      if (detector) {
        let stopped = false;
        let raf = 0;
        const tick = async () => {
          if (stopped) return;
          if (video.readyState >= 2) {
            try {
              const codes = await detector.detect(video);
              const text = codes[0]?.rawValue?.trim();
              if (text) emitScan(text);
            } catch {
              /* frame had no readable code */
            }
          }
          if (!stopped) raf = window.requestAnimationFrame(() => void tick());
        };
        void tick();
        stopScanRef.current = () => {
          stopped = true;
          window.cancelAnimationFrame(raf);
        };
        return;
      }

      const reader = createZxingReader();
      const controls: IScannerControls = await reader.decodeFromStream(
        stream,
        video,
        (result) => {
          if (!result) return;
          emitScan(result.getText());
        },
      );
      if (generation !== generationRef.current) {
        controls.stop();
        return;
      }
      stopScanRef.current = () => controls.stop();
    } catch (err) {
      if (generation !== generationRef.current) return;
      releaseStream();
      setLive(false);
      setError(cameraErrorMessage(err));
    } finally {
      if (generation === generationRef.current) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }, [emitScan, releaseStream]);

  useEffect(() => {
    if (!active) {
      stop();
      setError(null);
    }
    return () => {
      stop();
    };
  }, [active, stop]);

  if (!active) return null;

  return (
    <div className={`barcode-camera${className ? ` ${className}` : ""}`}>
      <video
        ref={videoRef}
        className="barcode-camera__video"
        muted
        playsInline
        autoPlay
        controls={false}
        disablePictureInPicture
        disableRemotePlayback
      />
      <div className="barcode-camera__frame" aria-hidden="true" />
      {!live ? (
        <div className="barcode-camera__gate">
          <button
            type="button"
            className="barcode-camera__allow"
            disabled={starting}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              void startCamera();
            }}
            onClick={() => void startCamera()}
          >
            {starting ? "Starting camera…" : "Allow camera"}
          </button>
          {error ? <p className="barcode-camera__error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
