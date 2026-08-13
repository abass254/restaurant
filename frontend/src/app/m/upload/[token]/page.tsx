"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import type {
  ProductImage,
  ProductUploadByTokenResponse,
  ProductUploadTokenInfoResponse,
} from "@/lib/types";

type PageStatus = "loading" | "ready" | "uploading" | "expired" | "error";

type Pending = {
  id: string;
  file: File;
  previewUrl: string;
  kind: "image" | "video";
};

const ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function fileKind(file: File): "image" | "video" {
  return file.type.startsWith("video/") ? "video" : "image";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MobileUploadPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";

  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<ProductUploadTokenInfoResponse["data"] | null>(
    null,
  );
  const [pending, setPending] = useState<Pending[]>([]);
  const [recentUploaded, setRecentUploaded] = useState<ProductImage[]>([]);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);

  // Validate the token + fetch product info.
  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMsg("Missing upload link.");
      return;
    }
    let alive = true;
    apiFetch<ProductUploadTokenInfoResponse>(apiRoutes.inventoryUploadByToken(token))
      .then((res) => {
        if (!alive) return;
        setInfo(res.data);
        setStatus("ready");
      })
      .catch((err) => {
        if (!alive) return;
        const status410 = err instanceof ApiError && err.status === 410;
        setErrorMsg(
          err instanceof ApiError
            ? err.message
            : "Upload link is invalid or expired.",
        );
        setStatus(status410 ? "expired" : "error");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  // Release object URLs when pending items are dropped.
  useEffect(() => {
    return () => {
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const next: Pending[] = arr.map((file) => ({
      id: newId(),
      file,
      previewUrl: URL.createObjectURL(file),
      kind: fileKind(file),
    }));
    setPending((prev) => [...prev, ...next]);
  }

  function removePending(id: string) {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function handleUpload() {
    if (pending.length === 0 || !token) return;
    setStatus("uploading");
    setErrorMsg(null);
    try {
      const form = new FormData();
      for (const item of pending) form.append("files", item.file);
      const res = await apiFetch<ProductUploadByTokenResponse>(
        apiRoutes.inventoryUploadByToken(token),
        { method: "POST", body: form },
      );
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setRecentUploaded((prev) => [...res.added, ...prev]);
      setPending([]);
      setStatus("ready");
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      if (apiErr?.status === 410) {
        setStatus("expired");
        setErrorMsg("Upload link has expired — ask for a fresh one.");
      } else {
        setStatus("ready");
        setErrorMsg(apiErr?.message ?? "Upload failed.");
      }
    }
  }

  const totalSize = useMemo(
    () => pending.reduce((sum, p) => sum + p.file.size, 0),
    [pending],
  );

  return (
    <main className="mu-shell">
      <header className="mu-header">
        <span className="mu-brand">DukAI</span>
        <span className="mu-header__tag">Mobile uploader</span>
      </header>

      {status === "loading" ? (
        <section className="mu-card mu-card--centered">
          <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
          <p>Checking your upload link…</p>
        </section>
      ) : null}

      {status === "expired" ? (
        <section className="mu-card mu-card--centered">
          <i className="fa-solid fa-clock-rotate-left mu-card__icon" aria-hidden="true" />
          <h1>This link has expired</h1>
          <p>Open the inventory page again and generate a fresh QR code.</p>
        </section>
      ) : null}

      {status === "error" ? (
        <section className="mu-card mu-card--centered">
          <i className="fa-solid fa-circle-exclamation mu-card__icon" aria-hidden="true" />
          <h1>Upload link is invalid</h1>
          <p>{errorMsg}</p>
        </section>
      ) : null}

      {(status === "ready" || status === "uploading") && info ? (
        <>
          <section className="mu-card mu-product">
            {info.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="mu-product__cover"
                src={resolveAssetUrl(info.image_url)}
                alt=""
              />
            ) : (
              <span className="mu-product__cover mu-product__cover--empty" aria-hidden="true">
                <i className="fa-solid fa-box" />
              </span>
            )}
            <div className="mu-product__text">
              <span className="mu-product__label">Uploading to</span>
              <strong>{info.name}</strong>
              {info.brand ? <span className="mu-product__brand">{info.brand}</span> : null}
            </div>
          </section>

          <section className="mu-actions">
            <button
              type="button"
              className="mu-action"
              onClick={() => cameraRef.current?.click()}
              disabled={status === "uploading"}
            >
              <i className="fa-solid fa-camera" aria-hidden="true" />
              <span>Take a photo</span>
            </button>
            <button
              type="button"
              className="mu-action"
              onClick={() => videoRef.current?.click()}
              disabled={status === "uploading"}
            >
              <i className="fa-solid fa-video" aria-hidden="true" />
              <span>Record a video</span>
            </button>
            <button
              type="button"
              className="mu-action mu-action--wide"
              onClick={() => libraryRef.current?.click()}
              disabled={status === "uploading"}
            >
              <i className="fa-solid fa-photo-film" aria-hidden="true" />
              <span>Choose from library</span>
            </button>

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={videoRef}
              type="file"
              accept="video/*"
              capture="environment"
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={libraryRef}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </section>

          {pending.length > 0 ? (
            <section className="mu-card">
              <header className="mu-list-header">
                <strong>
                  {pending.length} ready to upload · {formatBytes(totalSize)}
                </strong>
                <button
                  type="button"
                  className="mu-link-btn"
                  onClick={() => {
                    pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                    setPending([]);
                  }}
                  disabled={status === "uploading"}
                >
                  Clear
                </button>
              </header>

              <ul className="mu-pending">
                {pending.map((p) => (
                  <li key={p.id} className="mu-pending__item">
                    {p.kind === "video" ? (
                      <video
                        src={p.previewUrl}
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.previewUrl} alt="" />
                    )}
                    <span className={`mu-pending__kind mu-pending__kind--${p.kind}`}>
                      <i
                        className={`fa-solid ${p.kind === "video" ? "fa-video" : "fa-image"}`}
                        aria-hidden="true"
                      />
                      {p.kind === "video" ? "Video" : "Photo"}
                    </span>
                    <span className="mu-pending__name" title={p.file.name}>
                      {p.file.name}
                    </span>
                    <span className="mu-pending__size">{formatBytes(p.file.size)}</span>
                    <button
                      type="button"
                      className="mu-pending__remove"
                      aria-label="Remove"
                      onClick={() => removePending(p.id)}
                      disabled={status === "uploading"}
                    >
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="mu-submit"
                onClick={() => void handleUpload()}
                disabled={status === "uploading"}
              >
                {status === "uploading" ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-cloud-arrow-up" aria-hidden="true" />
                    Upload {pending.length} file{pending.length === 1 ? "" : "s"}
                  </>
                )}
              </button>
            </section>
          ) : null}

          {errorMsg ? <p className="mu-error">{errorMsg}</p> : null}

          {recentUploaded.length > 0 ? (
            <section className="mu-card">
              <header className="mu-list-header">
                <strong>
                  <i className="fa-solid fa-circle-check" aria-hidden="true" />{" "}
                  {recentUploaded.length} uploaded
                </strong>
                <span className="mu-list-header__hint">
                  Now visible in the inventory dashboard.
                </span>
              </header>
              <ul className="mu-recent">
                {recentUploaded.map((media) => {
                  const isVideo = media.content_type?.startsWith("video/");
                  const src = resolveAssetUrl(media.url);
                  return (
                    <li key={media.url} className="mu-recent__item">
                      {isVideo ? (
                        <video src={src} muted playsInline preload="metadata" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" />
                      )}
                      <span
                        className={`mu-pending__kind mu-pending__kind--${isVideo ? "video" : "image"}`}
                      >
                        <i
                          className={`fa-solid ${isVideo ? "fa-video" : "fa-image"}`}
                          aria-hidden="true"
                        />
                        {isVideo ? "Video" : "Photo"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <p className="mu-hint">
            You can keep adding more — close this page when you're done.
          </p>
        </>
      ) : null}
    </main>
  );
}
