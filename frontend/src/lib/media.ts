import type { ProductImage } from "./types";

/**
 * Returns true if a product media item is a video (vs an image).
 *
 * We use `content_type` when present (the upload pipeline always sets it for
 * new files). For legacy rows without it, we fall back to a tiny extension
 * sniff so older photo-only galleries keep rendering as images.
 */
export function isVideoMedia(media: ProductImage): boolean {
  const ct = media.content_type?.toLowerCase();
  if (ct) return ct.startsWith("video/");
  const url = media.url?.toLowerCase() ?? "";
  return /\.(mp4|mov|webm|m4v)(\?|$)/.test(url);
}

export type MediaKind = "image" | "video";

export function mediaKind(media: ProductImage): MediaKind {
  return isVideoMedia(media) ? "video" : "image";
}
