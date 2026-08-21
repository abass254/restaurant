/** Timeline editor project model for New post. */

export const EDITOR_WIDTH = 1080;
export const EDITOR_HEIGHT = 1920;
export const EDITOR_FPS = 30;
export const DEFAULT_IMAGE_DURATION = 3;
export const MAX_CLIPS = 8;
export const MAX_PROJECT_DURATION = 90;
export const DEFAULT_TRANSITION_DURATION = 0.5;

export type TransitionType = "none" | "fade" | "dissolve" | "slideleft" | "slideright";

export type MediaKind = "video" | "image" | "audio";

export type EditorMediaAsset = {
  id: string;
  kind: MediaKind;
  name: string;
  /** Object URL for preview; revoked when the editor closes. */
  objectUrl: string;
  /** Source duration in seconds (images use DEFAULT_IMAGE_DURATION). */
  duration: number;
  width?: number;
  height?: number;
};

export type VideoClip = {
  id: string;
  mediaId: string;
  /** Inclusive trim start within the source media (seconds). */
  trimStart: number;
  /** Exclusive trim end within the source media (seconds). */
  trimEnd: number;
};

export type Transition = {
  /** Applied between clip index i and i+1 (afterClipsIndex = i). */
  afterClipIndex: number;
  type: TransitionType;
  duration: number;
};

export type AudioClip = {
  id: string;
  mediaId: string;
  /** Start time on the project timeline (seconds). */
  startAt: number;
  trimStart: number;
  trimEnd: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
};

export type TextOverlay = {
  id: string;
  text: string;
  startAt: number;
  duration: number;
  /** Normalized 0–1 position of text center within the 9:16 canvas. */
  x: number;
  y: number;
  fontSize: number;
  color: string;
};

export type EditorProject = {
  aspect: "9:16";
  width: number;
  height: number;
  fps: number;
  clips: VideoClip[];
  transitions: Transition[];
  audioClips: AudioClip[];
  textOverlays: TextOverlay[];
};

export type EditorExportPreset = "1080p" | "720p";

export function createEmptyProject(): EditorProject {
  return {
    aspect: "9:16",
    width: EDITOR_WIDTH,
    height: EDITOR_HEIGHT,
    fps: EDITOR_FPS,
    clips: [],
    transitions: [],
    audioClips: [],
    textOverlays: [],
  };
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function clipDuration(clip: VideoClip): number {
  return Math.max(0.05, clip.trimEnd - clip.trimStart);
}

/** Effective timeline duration accounting for transition overlaps (xfade). */
export function projectDuration(
  project: EditorProject,
  options?: { ignoreTransitions?: boolean },
): number {
  if (project.clips.length === 0) return 0;
  let total = project.clips.reduce((sum, c) => sum + clipDuration(c), 0);
  if (!options?.ignoreTransitions) {
    for (const t of project.transitions) {
      if (t.type === "none") continue;
      total -= Math.min(t.duration, clipDuration(project.clips[t.afterClipIndex]!) * 0.45);
    }
  }
  const audioEnd = project.audioClips.reduce(
    (max, a) => Math.max(max, a.startAt + (a.trimEnd - a.trimStart)),
    0,
  );
  const textEnd = project.textOverlays.reduce(
    (max, t) => Math.max(max, t.startAt + t.duration),
    0,
  );
  return Math.max(0.05, total, audioEnd, textEnd);
}

export function transitionBetween(
  project: EditorProject,
  afterClipIndex: number,
): Transition | undefined {
  return project.transitions.find((t) => t.afterClipIndex === afterClipIndex);
}

export function setTransition(
  project: EditorProject,
  afterClipIndex: number,
  type: TransitionType,
  duration = DEFAULT_TRANSITION_DURATION,
): EditorProject {
  const filtered = project.transitions.filter((t) => t.afterClipIndex !== afterClipIndex);
  if (type === "none") {
    return { ...project, transitions: filtered };
  }
  return {
    ...project,
    transitions: [
      ...filtered,
      { afterClipIndex, type, duration: Math.max(0.1, Math.min(2, duration)) },
    ].sort((a, b) => a.afterClipIndex - b.afterClipIndex),
  };
}

export function addClipFromMedia(
  project: EditorProject,
  media: EditorMediaAsset,
): EditorProject {
  if (project.clips.length >= MAX_CLIPS) return project;
  const clip: VideoClip = {
    id: newId("clip"),
    mediaId: media.id,
    trimStart: 0,
    trimEnd: media.duration,
  };
  const next = { ...project, clips: [...project.clips, clip] };
  // Drop orphan transitions past the new end.
  return {
    ...next,
    transitions: next.transitions.filter((t) => t.afterClipIndex < next.clips.length - 1),
  };
}

export function updateClip(
  project: EditorProject,
  clipId: string,
  patch: Partial<Pick<VideoClip, "trimStart" | "trimEnd">>,
): EditorProject {
  return {
    ...project,
    clips: project.clips.map((c) => {
      if (c.id !== clipId) return c;
      const trimStart = patch.trimStart ?? c.trimStart;
      const trimEnd = patch.trimEnd ?? c.trimEnd;
      return {
        ...c,
        trimStart: Math.max(0, Math.min(trimStart, trimEnd - 0.05)),
        trimEnd: Math.max(trimStart + 0.05, trimEnd),
      };
    }),
  };
}

export function removeClip(project: EditorProject, clipId: string): EditorProject {
  const idx = project.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) return project;
  const clips = project.clips.filter((c) => c.id !== clipId);
  const transitions = project.transitions
    .filter((t) => t.afterClipIndex !== idx && t.afterClipIndex !== idx - 1)
    .map((t) =>
      t.afterClipIndex > idx
        ? { ...t, afterClipIndex: t.afterClipIndex - 1 }
        : t,
    )
    .filter((t) => t.afterClipIndex < clips.length - 1);
  return { ...project, clips, transitions };
}

export function reorderClips(
  project: EditorProject,
  fromIndex: number,
  toIndex: number,
): EditorProject {
  if (fromIndex === toIndex) return project;
  if (fromIndex < 0 || toIndex < 0) return project;
  if (fromIndex >= project.clips.length || toIndex >= project.clips.length) return project;
  const clips = [...project.clips];
  const [moved] = clips.splice(fromIndex, 1);
  clips.splice(toIndex, 0, moved!);
  // Transitions are cut-point metadata; clear them on reorder to avoid wrong pairings.
  return { ...project, clips, transitions: [] };
}

export function splitClip(
  project: EditorProject,
  clipId: string,
  atLocalTime: number,
): EditorProject {
  const idx = project.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) return project;
  const clip = project.clips[idx]!;
  const abs = clip.trimStart + atLocalTime;
  if (abs <= clip.trimStart + 0.05 || abs >= clip.trimEnd - 0.05) return project;
  const left: VideoClip = { ...clip, id: newId("clip"), trimEnd: abs };
  const right: VideoClip = { ...clip, id: newId("clip"), trimStart: abs };
  const clips = [...project.clips];
  clips.splice(idx, 1, left, right);
  const transitions = project.transitions.map((t) =>
    t.afterClipIndex >= idx ? { ...t, afterClipIndex: t.afterClipIndex + 1 } : t,
  );
  return { ...project, clips, transitions };
}

export function addAudioClip(
  project: EditorProject,
  media: EditorMediaAsset,
  startAt = 0,
): EditorProject {
  const audio: AudioClip = {
    id: newId("audio"),
    mediaId: media.id,
    startAt: Math.max(0, startAt),
    trimStart: 0,
    trimEnd: media.duration,
    volume: 0.8,
    fadeIn: 0.3,
    fadeOut: 0.5,
  };
  return { ...project, audioClips: [...project.audioClips, audio] };
}

export function updateAudioClip(
  project: EditorProject,
  audioId: string,
  patch: Partial<Omit<AudioClip, "id" | "mediaId">>,
): EditorProject {
  return {
    ...project,
    audioClips: project.audioClips.map((a) =>
      a.id === audioId ? { ...a, ...patch } : a,
    ),
  };
}

export function removeAudioClip(project: EditorProject, audioId: string): EditorProject {
  return {
    ...project,
    audioClips: project.audioClips.filter((a) => a.id !== audioId),
  };
}

export function addTextOverlay(
  project: EditorProject,
  text = "Your text",
  startAt = 0,
): EditorProject {
  const overlay: TextOverlay = {
    id: newId("text"),
    text,
    startAt: Math.max(0, startAt),
    duration: 3,
    x: 0.5,
    y: 0.72,
    fontSize: 56,
    color: "#ffffff",
  };
  return { ...project, textOverlays: [...project.textOverlays, overlay] };
}

export function updateTextOverlay(
  project: EditorProject,
  textId: string,
  patch: Partial<Omit<TextOverlay, "id">>,
): EditorProject {
  return {
    ...project,
    textOverlays: project.textOverlays.map((t) =>
      t.id === textId ? { ...t, ...patch } : t,
    ),
  };
}

export function removeTextOverlay(project: EditorProject, textId: string): EditorProject {
  return {
    ...project,
    textOverlays: project.textOverlays.filter((t) => t.id !== textId),
  };
}

/** Whether the project can export as a still JPEG (single image, no motion layers). */
export function isPhotoOnlyProject(
  project: EditorProject,
  mediaById: Map<string, EditorMediaAsset>,
): boolean {
  if (project.clips.length !== 1) return false;
  if (project.audioClips.length > 0) return false;
  if (project.textOverlays.length > 0) return false;
  const media = mediaById.get(project.clips[0]!.mediaId);
  return media?.kind === "image";
}

export function prefersMobileExportPreset(): EditorExportPreset {
  if (typeof window === "undefined") return "1080p";
  return window.matchMedia("(max-width: 768px)").matches ? "720p" : "1080p";
}
