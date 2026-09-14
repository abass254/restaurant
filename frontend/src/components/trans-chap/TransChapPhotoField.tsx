"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { resolveAssetUrl } from "@/lib/config";

type Props = {
  existingUrl?: string | null;
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
};

export function TransChapPhotoField({
  existingUrl,
  file,
  onFileChange,
  disabled,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const shown = preview || (existingUrl ? resolveAssetUrl(existingUrl) : "");
  const busy = Boolean(disabled);

  function pick() {
    inputRef.current?.click();
  }

  function clear(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onFileChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="auth-split__field">
      <span id={`${inputId}-label`}>Product photo</span>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        hidden
        disabled={busy}
        onChange={(event) => {
          const next = event.target.files?.[0] ?? null;
          onFileChange(next);
        }}
      />
      <div className="trans-chap-photo">
        <button
          type="button"
          className={`trans-chap-photo__pick${shown ? " has-image" : ""}`}
          onClick={pick}
          disabled={busy}
          aria-labelledby={`${inputId}-label`}
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" />
          ) : (
            <>
              <i className="fa-solid fa-camera" aria-hidden />
              <span>Add a photo</span>
            </>
          )}
        </button>
        <div className="trans-chap-photo__actions">
          {file ? (
            <button type="button" className="trans-chap-photo__clear" onClick={clear} disabled={busy}>
              Remove photo
            </button>
          ) : shown ? (
            <button type="button" className="trans-chap-photo__clear" onClick={pick} disabled={busy}>
              Change photo
            </button>
          ) : (
            <p className="trans-chap-photo__hint">Optional. JPEG, PNG, or WebP.</p>
          )}
        </div>
      </div>
    </div>
  );
}
