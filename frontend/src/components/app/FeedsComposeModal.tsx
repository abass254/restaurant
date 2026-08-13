"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FeedsComposeProductPicker } from "@/components/app/FeedsComposeProductPicker";
import { MotionModal } from "@/components/app/MotionModal";
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

type FeedsComposeModalProps = {
  open: boolean;
  posting: boolean;
  onClose: () => void;
  onPosted: (result: FeedPostResponse) => void;
  onPostingChange: (posting: boolean) => void;
};

export function FeedsComposeModal({
  open,
  posting,
  onClose,
  onPosted,
  onPostingChange,
}: FeedsComposeModalProps) {
  const [captionBody, setCaptionBody] = useState("");
  const [linkedProducts, setLinkedProducts] = useState<ComposeLinkedProduct[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIsVideo, setPreviewIsVideo] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const captionLength = useMemo(
    () => composeCaptionLength(captionBody, linkedProducts),
    [captionBody, linkedProducts],
  );
  const captionTooLong = captionLength > CAPTION_LIMIT;

  useEffect(() => {
    if (!open) {
      setCaptionBody("");
      setLinkedProducts([]);
      setFile(null);
      setPreviewIsVideo(false);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }
  }, [open]);

  function handleFileChange(next: File | null) {
    if (next) {
      const validationError = validateFeedFile(next);
      if (validationError) {
        void showError("Unsupported file", validationError);
        return;
      }
    }

    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next ? URL.createObjectURL(next) : null;
    });
    setPreviewIsVideo(next ? fileIsFeedVideo(next) : false);
    setFile(next);
  }

  async function handleSubmit() {
    if (!file) {
      await showError("Choose a file", "Select a photo or video to publish.");
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
    onPostingChange(true);
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
      onPosted(res);
      onClose();
      await toastSuccess(res.message);
      if (res.permalink) {
        window.open(res.permalink, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      await showError("Could not post to Instagram", extractErrorMessage(err));
    } finally {
      onPostingChange(false);
    }
  }

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="Create a new social post"
      panelClassName="inv-post-modal feeds-compose-modal"
      closeOnBackdrop={!posting}
      closeOnEscape={!posting}
    >
      <header className="inventory-modal__head">
        <div>
          <h2>
            <i className="fa-brands fa-instagram" aria-hidden="true" /> New post
          </h2>
          <span className="app-muted">
            Upload a photo or video and publish it to your connected Instagram account.
          </span>
        </div>
        <button
          type="button"
          className="fb-icon-btn"
          aria-label="Close"
          onClick={onClose}
          disabled={posting}
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </header>

      <div className="inventory-modal__body inv-post-modal__body">
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
        ) : (
          <button
            type="button"
            className="feeds-compose-dropzone"
            onClick={() => fileInputRef.current?.click()}
            disabled={posting}
          >
            <i className="fa-solid fa-cloud-arrow-up" aria-hidden="true" />
            <strong>Choose a photo or video</strong>
            <span className="app-muted">
              JPEG, MP4, or MOV · photos up to 5 MB · videos up to 50 MB
            </span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={FEED_UPLOAD_ACCEPT}
          hidden
          onChange={(e) => {
            handleFileChange(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />

        {previewUrl ? (
          <div className="feeds-compose-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={posting}
            >
              Change file
            </button>
          </div>
        ) : null}

        <FeedsComposeProductPicker
          disabled={posting}
          linkedProducts={linkedProducts}
          onChange={setLinkedProducts}
        />

        <label className="settings-field" htmlFor="feeds-compose-caption">
          <div className="inv-post-modal__caption-head">
            <span>Caption</span>
            <span className={captionTooLong ? "feeds-compose-caption-count--over" : "app-muted"}>
              {captionLength}/{CAPTION_LIMIT}
            </span>
          </div>
          <textarea
            id="feeds-compose-caption"
            rows={5}
            value={captionBody}
            onChange={(e) => setCaptionBody(e.target.value)}
            disabled={posting}
            placeholder="Write a caption for your post…"
          />
          {linkedProducts.length > 0 ? (
            <div className="feeds-compose-caption-products" aria-label="Products in caption">
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
          <Link href="/settings">Settings</Link>. Your site must be publicly
          reachable so Instagram can fetch the file. Videos are published as Reels
          and may take a minute to process.
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
                posting
                  ? "fa-solid fa-spinner fa-spin"
                  : "fa-brands fa-instagram"
              }
              aria-hidden="true"
            />
            {posting ? "Posting…" : "Post now"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={posting}
          >
            Cancel
          </button>
        </div>
      </div>
    </MotionModal>
  );
}
