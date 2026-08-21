"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { FeedsCaptureStudio } from "@/components/app/FeedsCaptureStudio";
import { FeedsComposeProductPicker } from "@/components/app/FeedsComposeProductPicker";
import { FeedsTimelineEditor } from "@/components/app/feed-editor/FeedsTimelineEditor";
import { apiFetch } from "@/lib/api";
import { extractErrorMessage, showError, toastSuccess } from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  buildComposeCaption,
  composeCaptionLength,
  formatComposeProductLine,
  type ComposeLinkedProduct,
} from "@/lib/feedCaption";
import { FEED_UPLOAD_ACCEPT, fileIsFeedVideo, validateFeedFile } from "@/lib/feedsMedia";
import type { FeedPostResponse } from "@/lib/types";

const CAPTION_LIMIT = 2200;

type Step = "capture" | "caption";

type FeedsNewPostFlowProps = {
  feedsHref?: string;
  settingsHref?: string;
};

export function FeedsNewPostFlow({
  feedsHref = "/trans-chap/feeds",
  settingsHref = "/trans-chap/settings",
}: FeedsNewPostFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("capture");
  const [captionBody, setCaptionBody] = useState("");
  const [linkedProducts, setLinkedProducts] = useState<ComposeLinkedProduct[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIsVideo, setPreviewIsVideo] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSeedFiles, setEditorSeedFiles] = useState<File[] | undefined>();
  const [editorKey, setEditorKey] = useState(0);
  const [posting, setPosting] = useState(false);
  const directInputRef = useRef<HTMLInputElement | null>(null);

  const captionLength = useMemo(
    () => composeCaptionLength(captionBody, linkedProducts),
    [captionBody, linkedProducts],
  );
  const captionTooLong = captionLength > CAPTION_LIMIT;

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function applyFile(next: File | null) {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next ? URL.createObjectURL(next) : null;
    });
    setPreviewIsVideo(next ? fileIsFeedVideo(next) : false);
    setFile(next);
  }

  function handleCaptured(captured: File) {
    setEditorSeedFiles([captured]);
    setEditorKey((k) => k + 1);
    setEditorOpen(true);
  }

  function openEditor(seed?: File[]) {
    setEditorSeedFiles(seed);
    setEditorKey((k) => k + 1);
    setEditorOpen(true);
  }

  function handleEditorClose() {
    setEditorOpen(false);
    setEditorSeedFiles(undefined);
    if (!file) setStep("capture");
  }

  function handleEditorDone(exported: File) {
    const error = validateFeedFile(exported);
    if (error) {
      void showError("Unsupported file", error);
      return;
    }
    applyFile(exported);
    setEditorOpen(false);
    setEditorSeedFiles(undefined);
    setStep("caption");
  }

  async function handleSubmit() {
    if (!file) {
      await showError("Choose a file", "Record or upload a photo or video first.");
      return;
    }
    const fileError = validateFeedFile(file);
    if (fileError) {
      await showError("Unsupported file", fileError);
      return;
    }
    if (captionTooLong) {
      await showError(
        "Caption is too long",
        `Instagram captions are limited to ${CAPTION_LIMIT} characters.`,
      );
      return;
    }

    const caption = buildComposeCaption(captionBody, linkedProducts);
    setPosting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("platform", "instagram");
      if (caption) form.append("caption", caption);
      if (linkedProducts.length > 0) {
        form.append(
          "inventory_item_ids",
          JSON.stringify(linkedProducts.map((item) => item.inventoryItemId)),
        );
      }
      const res = await apiFetch<FeedPostResponse>(apiRoutes.feedsPost, {
        method: "POST",
        body: form,
      });
      await toastSuccess(res.message);
      if (res.permalink) {
        window.open(res.permalink, "_blank", "noopener,noreferrer");
      }
      router.replace(feedsHref);
    } catch (err) {
      await showError("Could not post to Instagram", extractErrorMessage(err));
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className={`feeds-new-post${step === "capture" ? " feeds-new-post--capture" : ""}`}>
      {step === "capture" ? (
        <FeedsCaptureStudio
          onCaptured={handleCaptured}
          onCancel={() => router.push(feedsHref)}
        />
      ) : (
        <div className="feeds-new-post__caption fb-app">
          <header className="feeds-new-post__caption-head">
            <div>
              <h2>
                <i className="fa-brands fa-instagram" aria-hidden="true" /> New post
              </h2>
              <span className="app-muted">Add a caption, then publish to Instagram.</span>
            </div>
            <button
              type="button"
              className="fb-icon-btn"
              aria-label="Start over"
              onClick={() => {
                applyFile(null);
                setCaptionBody("");
                setLinkedProducts([]);
                setStep("capture");
              }}
              disabled={posting}
            >
              <i className="fa-solid fa-arrow-rotate-left" aria-hidden="true" />
            </button>
          </header>

          <div className="feeds-new-post__caption-body">
            {previewUrl ? (
              <figure className="inv-post-modal__preview">
                {previewIsVideo ? (
                  <video
                    src={previewUrl}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label="Selected video preview"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="Selected photo preview" />
                )}
              </figure>
            ) : null}

            <input
              ref={directInputRef}
              type="file"
              accept={FEED_UPLOAD_ACCEPT}
              hidden
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null;
                e.target.value = "";
                if (picked) openEditor([picked]);
              }}
            />

            <div className="feeds-compose-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => openEditor(file ? [file] : undefined)}
                disabled={posting}
              >
                <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
                Edit again
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  applyFile(null);
                  setStep("capture");
                }}
                disabled={posting}
              >
                <i className="fa-solid fa-camera" aria-hidden="true" />
                Retake
              </button>
            </div>

            <FeedsComposeProductPicker
              disabled={posting}
              linkedProducts={linkedProducts}
              onChange={setLinkedProducts}
            />

            <label className="settings-field" htmlFor="feeds-new-caption">
              <div className="inv-post-modal__caption-head">
                <span>Caption</span>
                <span
                  className={
                    captionTooLong ? "feeds-compose-caption-count--over" : "app-muted"
                  }
                >
                  {captionLength}/{CAPTION_LIMIT}
                </span>
              </div>
              <textarea
                id="feeds-new-caption"
                rows={5}
                value={captionBody}
                onChange={(e) => setCaptionBody(e.target.value)}
                disabled={posting}
                placeholder="Write a caption for your post…"
              />
              {linkedProducts.length > 0 ? (
                <div
                  className="feeds-compose-caption-products"
                  aria-label="Products in caption"
                >
                  <span className="feeds-compose-caption-products__label">Shop:</span>
                  <pre className="feeds-compose-caption-products__list">
                    {linkedProducts
                      .map((product, index) => formatComposeProductLine(product, index))
                      .join("\n")}
                  </pre>
                </div>
              ) : null}
            </label>

            <p className="app-muted inv-post-modal__hint">
              Instagram must be connected via Meta OAuth in{" "}
              <Link href={settingsHref}>Settings</Link>. Videos publish as Reels and may
              take a minute to process.
            </p>

            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={posting || !file || captionTooLong}
                onClick={() => void handleSubmit()}
              >
                <i
                  className={
                    posting ? "fa-solid fa-spinner fa-spin" : "fa-brands fa-instagram"
                  }
                  aria-hidden="true"
                />
                {posting ? "Posting…" : "Post now"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => router.push(feedsHref)}
                disabled={posting}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <FeedsTimelineEditor
        key={editorKey}
        open={editorOpen}
        initialFiles={editorSeedFiles}
        onClose={handleEditorClose}
        onDone={handleEditorDone}
      />
    </div>
  );
}
