import {
  clipDuration,
  transitionBetween,
  type EditorMediaAsset,
  type EditorProject,
  type VideoClip,
} from "./project";

export type ClipSegment = {
  clip: VideoClip;
  media: EditorMediaAsset;
  /** Absolute start on the timeline (seconds). */
  startAt: number;
  /** Absolute end on the timeline (seconds). */
  endAt: number;
  /** Duration of this segment after transition overlap accounting. */
  duration: number;
};

/**
 * Map each clip to absolute timeline ranges.
 * Transition duration is subtracted from the *end* of the earlier clip
 * (matching FFmpeg xfade overlap semantics).
 */
export function buildClipSegments(
  project: EditorProject,
  mediaById: Map<string, EditorMediaAsset>,
): ClipSegment[] {
  const segments: ClipSegment[] = [];
  let cursor = 0;

  project.clips.forEach((clip, index) => {
    const media = mediaById.get(clip.mediaId);
    if (!media) return;
    const full = clipDuration(clip);
    const transition = transitionBetween(project, index);
    const overlap =
      transition && transition.type !== "none"
        ? Math.min(transition.duration, full * 0.45)
        : 0;
    const duration = Math.max(0.05, full - overlap);
    const startAt = cursor;
    const endAt = cursor + duration;
    segments.push({ clip, media, startAt, endAt, duration });
    cursor = endAt;
  });

  return segments;
}

export function findActiveSegment(
  segments: ClipSegment[],
  time: number,
): ClipSegment | null {
  if (segments.length === 0) return null;
  for (const seg of segments) {
    if (time >= seg.startAt && time < seg.endAt) return seg;
  }
  return segments[segments.length - 1] ?? null;
}

/** Local media time for a timeline clock position within a segment. */
export function mediaTimeAt(
  segment: ClipSegment,
  timelineTime: number,
): number {
  const local = Math.max(0, timelineTime - segment.startAt);
  return segment.clip.trimStart + Math.min(local, clipDuration(segment.clip));
}

export function formatTimecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  const whole = Math.floor(rem);
  const frac = Math.floor((rem - whole) * 10);
  return `${m}:${whole.toString().padStart(2, "0")}.${frac}`;
}

export function pxPerSecond(projectDurationSec: number, trackWidthPx: number): number {
  const duration = Math.max(1, projectDurationSec);
  return Math.max(24, trackWidthPx / duration);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export async function probeMediaFile(file: File): Promise<{
  kind: "video" | "image" | "audio";
  duration: number;
  width?: number;
  height?: number;
}> {
  if (file.type.startsWith("image/")) {
    const dims = await loadImageDims(file);
    return { kind: "image", duration: 3, ...dims };
  }
  if (file.type.startsWith("audio/")) {
    const duration = await loadMediaDuration(file, "audio");
    return { kind: "audio", duration };
  }
  const meta = await loadVideoMeta(file);
  return { kind: "video", ...meta };
}

function loadImageDims(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image."));
    };
    img.src = url;
  });
}

function loadMediaDuration(file: File, kind: "audio" | "video"): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const duration = Number.isFinite(el.duration) ? el.duration : 0;
      URL.revokeObjectURL(url);
      resolve(Math.max(0.1, duration));
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${kind} file.`));
    };
    el.src = url;
  });
}

function loadVideoMeta(
  file: File,
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      resolve({
        duration: Math.max(0.1, duration),
        width: video.videoWidth || 1080,
        height: video.videoHeight || 1920,
      });
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video file."));
    };
    video.src = url;
  });
}
