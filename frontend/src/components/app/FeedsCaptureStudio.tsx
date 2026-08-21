"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { showError } from "@/lib/alerts";

type CaptureMode = "photo" | "video";
type Facing = "environment" | "user";

type FeedsCaptureStudioProps = {
  onCaptured: (file: File) => void;
  onCancel?: () => void;
};

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionForMime(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("quicktime")) return "mov";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  return "bin";
}

async function canvasToJpegFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((next) => resolve(next), "image/jpeg", 0.92);
  });
  if (!blob) throw new Error("Could not capture photo.");
  return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
}

function formatTimer(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function FeedsCaptureStudio({ onCaptured, onCancel }: FeedsCaptureStudioProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartedAt = useRef(0);
  const timerRef = useRef<number | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const photoFallbackRef = useRef<HTMLInputElement | null>(null);
  const videoFallbackRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<CaptureMode>("photo");
  const [facing, setFacing] = useState<Facing>("environment");
  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [busy, setBusy] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
  }, []);

  const startCamera = useCallback(
    async (nextFacing: Facing) => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera is not available in this browser.");
        return;
      }
      setCameraError(null);
      setReady(false);
      stopStream();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: {
            facingMode: { ideal: nextFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setReady(true);
      } catch {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: nextFacing },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
          streamRef.current = stream;
          const video = videoRef.current;
          if (video) {
            video.srcObject = stream;
            await video.play().catch(() => undefined);
          }
          setReady(true);
        } catch {
          setCameraError(
            "Camera permission denied. You can still take a photo, record, or pick from your library.",
          );
        }
      }
    },
    [stopStream],
  );

  useEffect(() => {
    void startCamera(facing);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      stopStream();
    };
  }, [facing, startCamera, stopStream]);

  async function takePhoto() {
    const video = videoRef.current;
    if (!video || !ready || busy) {
      photoFallbackRef.current?.click();
      return;
    }
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1080;
      canvas.height = video.videoHeight || 1440;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not capture photo.");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      onCaptured(await canvasToJpegFile(canvas, `post-${Date.now()}.jpg`));
    } catch (err) {
      await showError(
        "Could not take photo",
        err instanceof Error ? err.message : "Try again or use your library.",
      );
    } finally {
      setBusy(false);
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || busy || recording) {
      videoFallbackRef.current?.click();
      return;
    }
    const mimeType = pickRecorderMime();
    if (!mimeType || typeof MediaRecorder === "undefined") {
      videoFallbackRef.current?.click();
      return;
    }
    chunksRef.current = [];
    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType.split(";")[0] });
        chunksRef.current = [];
        const ext = extensionForMime(blob.type);
        onCaptured(
          new File([blob], `post-${Date.now()}.${ext}`, {
            type: blob.type || "video/mp4",
            lastModified: Date.now(),
          }),
        );
        setRecording(false);
        setElapsedMs(0);
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
      recorder.start(200);
      recordStartedAt.current = Date.now();
      setRecording(true);
      setElapsedMs(0);
      timerRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - recordStartedAt.current);
      }, 200);
    } catch {
      videoFallbackRef.current?.click();
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    try {
      recorder.stop();
    } catch {
      setRecording(false);
    }
  }

  function onShutterClick() {
    if (mode === "photo") {
      void takePhoto();
      return;
    }
    if (recording) stopRecording();
    else startRecording();
  }

  function onGalleryPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    onCaptured(file);
  }

  return (
    <div className="feeds-capture">
      <div className="feeds-capture__stage">
        {cameraError && !ready ? (
          <div className="feeds-capture__fallback" role="status">
            <i className="fa-solid fa-camera" aria-hidden />
            <p>{cameraError}</p>
            <div className="feeds-capture__fallback-actions">
              <button
                type="button"
                className="feeds-capture__chip"
                onClick={() => photoFallbackRef.current?.click()}
              >
                <i className="fa-solid fa-camera" aria-hidden />
                Take photo
              </button>
              <button
                type="button"
                className="feeds-capture__chip"
                onClick={() => videoFallbackRef.current?.click()}
              >
                <i className="fa-solid fa-video" aria-hidden />
                Record video
              </button>
              <button
                type="button"
                className="feeds-capture__chip"
                onClick={() => galleryRef.current?.click()}
              >
                <i className="fa-solid fa-images" aria-hidden />
                Gallery
              </button>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="feeds-capture__video"
            playsInline
            muted
            autoPlay
            aria-label="Camera preview"
          />
        )}

        {recording ? (
          <div className="feeds-capture__rec" aria-live="polite">
            <span className="feeds-capture__rec-dot" />
            {formatTimer(elapsedMs)}
          </div>
        ) : null}

        {onCancel ? (
          <button
            type="button"
            className="feeds-capture__close"
            aria-label="Cancel"
            onClick={onCancel}
            disabled={recording || busy}
          >
            <i className="fa-solid fa-xmark" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="feeds-capture__dock">
        <div className="feeds-capture__modes" role="tablist" aria-label="Capture mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "photo"}
            className={mode === "photo" ? "is-active" : ""}
            disabled={recording}
            onClick={() => setMode("photo")}
          >
            Photo
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "video"}
            className={mode === "video" ? "is-active" : ""}
            disabled={recording}
            onClick={() => setMode("video")}
          >
            Video
          </button>
        </div>

        <div className="feeds-capture__controls">
          <button
            type="button"
            className="feeds-capture__side-btn"
            aria-label="Open gallery"
            disabled={recording || busy}
            onClick={() => galleryRef.current?.click()}
          >
            <i className="fa-solid fa-images" aria-hidden />
          </button>
          <button
            type="button"
            className={`feeds-capture__shutter${recording ? " is-recording" : ""}${
              mode === "video" ? " is-video" : ""
            }`}
            aria-label={
              mode === "photo"
                ? "Take photo"
                : recording
                  ? "Stop recording"
                  : "Start recording"
            }
            disabled={busy}
            onClick={onShutterClick}
          >
            <span />
          </button>
          <button
            type="button"
            className="feeds-capture__side-btn"
            aria-label="Flip camera"
            disabled={recording || busy || Boolean(cameraError && !ready)}
            onClick={() =>
              setFacing((prev) => (prev === "environment" ? "user" : "environment"))
            }
          >
            <i className="fa-solid fa-camera-rotate" aria-hidden />
          </button>
        </div>

        <p className="feeds-capture__hint">
          {mode === "photo"
            ? "Tap the shutter to take a photo, or open your gallery."
            : recording
              ? "Tap again to stop recording."
              : "Tap the shutter to start recording a Reel."}
        </p>
      </div>

      <input
        ref={galleryRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          onGalleryPick(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={photoFallbackRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          onGalleryPick(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={videoFallbackRef}
        type="file"
        accept="video/*"
        capture="environment"
        hidden
        onChange={(e) => {
          onGalleryPick(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
