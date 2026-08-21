"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorPreview } from "@/components/app/feed-editor/EditorPreview";
import { EditorTimeline } from "@/components/app/feed-editor/EditorTimeline";
import {
  EditorToolbar,
  type EditorTool,
} from "@/components/app/feed-editor/EditorToolbar";
import { extractErrorMessage, showError } from "@/lib/alerts";
import {
  DEFAULT_IMAGE_DURATION,
  MAX_CLIPS,
  MAX_PROJECT_DURATION,
  addAudioClip,
  addClipFromMedia,
  addTextOverlay,
  createEmptyProject,
  newId,
  prefersMobileExportPreset,
  projectDuration,
  removeAudioClip,
  removeClip,
  removeTextOverlay,
  reorderClips,
  setTransition,
  splitClip,
  updateAudioClip,
  updateClip,
  updateTextOverlay,
  type EditorMediaAsset,
  type EditorProject,
  type TransitionType,
} from "@/lib/feed-editor/project";
import {
  buildClipSegments,
  clamp,
  probeMediaFile,
} from "@/lib/feed-editor/timeline";
import { FEED_VIDEO_MAX_BYTES, validateFeedFile } from "@/lib/feedsMedia";

export type FeedsTimelineEditorProps = {
  open: boolean;
  initialFiles?: File[];
  onClose: () => void;
  onDone: (file: File) => void;
};

export function FeedsTimelineEditor({
  open,
  initialFiles,
  onClose,
  onDone,
}: FeedsTimelineEditorProps) {
  const [project, setProject] = useState<EditorProject>(() => createEmptyProject());
  const [mediaById, setMediaById] = useState<Map<string, EditorMediaAsset>>(
    () => new Map(),
  );
  const filesByIdRef = useRef<Map<string, File>>(new Map());
  const objectUrlsRef = useRef<string[]>([]);
  const projectRef = useRef(project);
  const mediaByIdRef = useRef(mediaById);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  useEffect(() => {
    mediaByIdRef.current = mediaById;
  }, [mediaById]);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{
    ratio: number;
    message: string;
  } | null>(null);
  const [activeTool, setActiveTool] = useState<EditorTool>(null);
  const [exportPreset, setExportPreset] = useState<"1080p" | "720p">(() =>
    prefersMobileExportPreset(),
  );
  const [clipMuted, setClipMuted] = useState(true);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const initialHandled = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  const duration = useMemo(() => projectDuration(project), [project]);

  const importFiles = useCallback(async (fileList: FileList | File[], asMusic: boolean) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    let nextProject = projectRef.current;
    const nextMedia = new Map(mediaByIdRef.current);

    for (const file of files) {
      try {
        const probed = await probeMediaFile(file);
        if (asMusic) {
          if (probed.kind !== "audio" && !file.type.startsWith("audio/")) {
            await showError("Unsupported file", "Choose an audio file for music.");
            continue;
          }
          const id = newId("media");
          const objectUrl = URL.createObjectURL(file);
          objectUrlsRef.current.push(objectUrl);
          const asset: EditorMediaAsset = {
            id,
            kind: "audio",
            name: file.name,
            objectUrl,
            duration: probed.duration || 30,
          };
          filesByIdRef.current.set(id, file);
          nextMedia.set(id, asset);
          nextProject = addAudioClip(nextProject, asset, 0);
          setSelectedAudioId(
            nextProject.audioClips[nextProject.audioClips.length - 1]?.id ?? null,
          );
          continue;
        }

        if (probed.kind === "audio") {
          await showError(
            "Wrong track",
            "Use Music to add audio files, or pick a photo/video.",
          );
          continue;
        }

        if (nextProject.clips.length >= MAX_CLIPS) {
          await showError("Clip limit", `You can add up to ${MAX_CLIPS} clips.`);
          break;
        }

        if (probed.kind === "video" && file.size > FEED_VIDEO_MAX_BYTES * 2) {
          await showError(
            "File too large",
            "Source video is too large to edit in the browser.",
          );
          continue;
        }

        const id = newId("media");
        const objectUrl = URL.createObjectURL(file);
        objectUrlsRef.current.push(objectUrl);
        const asset: EditorMediaAsset = {
          id,
          kind: probed.kind,
          name: file.name,
          objectUrl,
          duration:
            probed.kind === "image" ? DEFAULT_IMAGE_DURATION : probed.duration,
          width: probed.width,
          height: probed.height,
        };
        filesByIdRef.current.set(id, file);
        nextMedia.set(id, asset);
        nextProject = addClipFromMedia(nextProject, asset);

        if (projectDuration(nextProject) > MAX_PROJECT_DURATION) {
          const last = nextProject.clips[nextProject.clips.length - 1];
          if (last) nextProject = removeClip(nextProject, last.id);
          nextMedia.delete(id);
          filesByIdRef.current.delete(id);
          URL.revokeObjectURL(objectUrl);
          objectUrlsRef.current = objectUrlsRef.current.filter((u) => u !== objectUrl);
          await showError(
            "Too long",
            `Projects are limited to about ${MAX_PROJECT_DURATION} seconds.`,
          );
          break;
        }

        setSelectedClipId(
          nextProject.clips[nextProject.clips.length - 1]?.id ?? null,
        );
      } catch (err) {
        await showError("Could not import", extractErrorMessage(err));
      }
    }

    mediaByIdRef.current = nextMedia;
    projectRef.current = nextProject;
    setMediaById(nextMedia);
    setProject(nextProject);
  }, []);

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!open || initialHandled.current) return;
    if (!initialFiles || initialFiles.length === 0) return;
    initialHandled.current = true;
    const seed = initialFiles;
    const timer = window.setTimeout(() => {
      void importFiles(seed, false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, initialFiles, importFiles]);

  // Playback clock
  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setCurrentTime((t) => {
        const next = t + dt;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, duration]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !exporting) onClose();
      if (e.key === " " && (e.target as HTMLElement)?.tagName !== "INPUT") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, exporting, onClose]);

  const selectedClip =
    project.clips.find((c) => c.id === selectedClipId) ?? null;
  const selectedAudio =
    project.audioClips.find((a) => a.id === selectedAudioId) ?? null;
  const selectedText =
    project.textOverlays.find((t) => t.id === selectedTextId) ?? null;

  function handleSplit() {
    if (!selectedClip) return;
    const segments = buildClipSegments(project, mediaById);
    const seg = segments.find((s) => s.clip.id === selectedClip.id);
    if (!seg) return;
    const local = currentTime - seg.startAt;
    setProject((p) => splitClip(p, selectedClip.id, local));
  }

  function handleDeleteSelected() {
    if (selectedClip) {
      setProject((p) => removeClip(p, selectedClip.id));
      setSelectedClipId(null);
      return;
    }
    if (selectedAudio) {
      setProject((p) => removeAudioClip(p, selectedAudio.id));
      setSelectedAudioId(null);
      return;
    }
    if (selectedText) {
      setProject((p) => removeTextOverlay(p, selectedText.id));
      setSelectedTextId(null);
    }
  }

  async function handleExport() {
    if (project.clips.length === 0) {
      await showError("Nothing to export", "Add at least one photo or video clip.");
      return;
    }
    setExporting(true);
    setPlaying(false);
    setExportProgress({ ratio: 0, message: "Starting export…" });
    try {
      const { exportEditorProject } = await import("@/lib/feed-editor/export");
      const preset = exportPreset;
      let file = await exportEditorProject(project, mediaById, filesByIdRef.current, {
        preset,
        onProgress: setExportProgress,
      });

      let validation = validateFeedFile(file);
      if (validation && preset === "1080p") {
        setExportProgress({ ratio: 0.05, message: "Retrying at 720p…" });
        file = await exportEditorProject(project, mediaById, filesByIdRef.current, {
          preset: "720p",
          onProgress: setExportProgress,
        });
        validation = validateFeedFile(file);
      }
      if (validation) {
        await showError("Export too large", validation);
        return;
      }
      onDone(file);
      onClose();
    } catch (err) {
      await showError("Export failed", extractErrorMessage(err));
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }

  async function handleUseOriginal() {
    if (project.clips.length !== 1 || project.audioClips.length || project.textOverlays.length) {
      await showError(
        "Use original",
        "Use original works with a single unedited clip and no music/text. Export instead, or remove extras.",
      );
      return;
    }
    const clip = project.clips[0]!;
    const file = filesByIdRef.current.get(clip.mediaId);
    if (!file) return;
    const err = validateFeedFile(file);
    if (err) {
      await showError("Unsupported file", err);
      return;
    }
    onDone(file);
    onClose();
  }

  if (!open || typeof document === "undefined") return null;

  const selectedTransitionType =
    selectedClipId != null
      ? (() => {
          const idx = project.clips.findIndex((c) => c.id === selectedClipId);
          if (idx < 0 || idx >= project.clips.length - 1) return "none" as const;
          return (
            project.transitions.find((t) => t.afterClipIndex === idx)?.type ?? "none"
          );
        })()
      : ("none" as const);

  return createPortal(
    <div
      className={`feeds-editor${previewExpanded ? " feeds-editor--expanded" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Edit post"
    >
      <header className="feeds-editor__head">
        <button
          type="button"
          className="feeds-editor__round-btn"
          aria-label="Close editor"
          onClick={onClose}
          disabled={exporting}
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
        <div className="feeds-editor__head-spacer" />
        <button
          type="button"
          className="feeds-editor__quality"
          disabled={exporting}
          onClick={() =>
            setExportPreset((p) => (p === "1080p" ? "720p" : "1080p"))
          }
          aria-label="Export quality"
        >
          {exportPreset === "1080p" ? "AI UHD" : "HD"}
          <i className="fa-solid fa-chevron-down" aria-hidden />
        </button>
        <button
          type="button"
          className="feeds-editor__round-btn feeds-editor__round-btn--accent"
          aria-label="Export"
          onClick={() => void handleExport()}
          disabled={exporting || project.clips.length === 0}
        >
          {exporting ? (
            <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
          ) : (
            <i className="fa-solid fa-arrow-up-from-bracket" aria-hidden="true" />
          )}
        </button>
      </header>

      <EditorPreview
        project={project}
        mediaById={mediaById}
        currentTime={currentTime}
        duration={duration}
        playing={playing}
        muted={clipMuted}
        selectedTextId={selectedTextId}
        onSelectText={(id) => {
          setSelectedTextId(id);
          setSelectedClipId(null);
          setSelectedAudioId(null);
          if (id) setActiveTool("text");
        }}
        onMoveText={(id, x, y) =>
          setProject((p) => updateTextOverlay(p, id, { x, y }))
        }
      />

      <div className="feeds-editor__transport">
        <button
          type="button"
          className="feeds-editor__transport-btn"
          aria-label={previewExpanded ? "Exit full preview" : "Full preview"}
          onClick={() => setPreviewExpanded((v) => !v)}
          disabled={exporting}
        >
          <i
            className={`fa-solid ${previewExpanded ? "fa-compress" : "fa-expand"}`}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          className="feeds-editor__play"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying((p) => !p)}
          disabled={exporting || project.clips.length === 0}
        >
          <i className={`fa-solid ${playing ? "fa-pause" : "fa-play"}`} aria-hidden="true" />
        </button>
        <div className="feeds-editor__transport-spacer" />
      </div>

      <EditorTimeline
        project={project}
        mediaById={mediaById}
        currentTime={currentTime}
        selectedClipId={selectedClipId}
        selectedAudioId={selectedAudioId}
        selectedTextId={selectedTextId}
        clipMuted={clipMuted}
        onSeek={(t) => {
          setPlaying(false);
          setCurrentTime(t);
        }}
        onSelectClip={(id) => {
          setSelectedClipId(id);
          setSelectedAudioId(null);
          setSelectedTextId(null);
        }}
        onSelectAudio={(id) => {
          setSelectedAudioId(id);
          setSelectedClipId(null);
          setSelectedTextId(null);
          setActiveTool("volume");
        }}
        onSelectText={(id) => {
          setSelectedTextId(id);
          setSelectedClipId(null);
          setSelectedAudioId(null);
          setActiveTool("text");
        }}
        onReorderClips={(from, to) =>
          setProject((p) => reorderClips(p, from, to))
        }
        onTrimClip={(clipId, trimStart, trimEnd) => {
          const clip = project.clips.find((c) => c.id === clipId);
          const media = clip ? mediaById.get(clip.mediaId) : null;
          if (!media) return;
          setProject((p) =>
            updateClip(p, clipId, {
              trimStart: clamp(trimStart, 0, media.duration - 0.05),
              trimEnd: clamp(trimEnd, 0.05, media.duration),
            }),
          );
        }}
        onSetTransition={(afterIndex, type: TransitionType) =>
          setProject((p) => setTransition(p, afterIndex, type))
        }
        onToggleMuteClip={() => setClipMuted((m) => !m)}
        onAddMusic={() => {
          setActiveTool("music");
          musicInputRef.current?.click();
        }}
        onAddText={() => {
          setProject((p) => {
            const next = addTextOverlay(p, "Your text", currentTime);
            const last = next.textOverlays[next.textOverlays.length - 1];
            if (last) setSelectedTextId(last.id);
            return next;
          });
          setSelectedClipId(null);
          setSelectedAudioId(null);
          setActiveTool("text");
        }}
      />

      <EditorToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        clipCount={project.clips.length}
        selectedClip={selectedClip}
        selectedAudio={selectedAudio}
        selectedText={selectedText}
        clipMuted={clipMuted}
        exporting={exporting}
        transitionType={selectedTransitionType}
        onAddMedia={() => mediaInputRef.current?.click()}
        onAddMusic={() => musicInputRef.current?.click()}
        onAddText={() => {
          setProject((p) => {
            const next = addTextOverlay(p, "Your text", currentTime);
            const last = next.textOverlays[next.textOverlays.length - 1];
            if (last) setSelectedTextId(last.id);
            return next;
          });
          setSelectedClipId(null);
          setSelectedAudioId(null);
          setActiveTool("text");
        }}
        onSplit={handleSplit}
        onDeleteSelected={handleDeleteSelected}
        onToggleMuteClip={() => setClipMuted((m) => !m)}
        onSetTransition={(type) => {
          const idx = project.clips.findIndex((c) => c.id === selectedClipId);
          if (idx < 0 || idx >= project.clips.length - 1) return;
          setProject((p) => setTransition(p, idx, type));
        }}
        onUpdateText={(patch) => {
          if (!selectedText) return;
          setProject((p) => updateTextOverlay(p, selectedText.id, patch));
        }}
        onUpdateAudio={(patch) => {
          if (!selectedAudio) return;
          setProject((p) => updateAudioClip(p, selectedAudio.id, patch));
        }}
        onUpdateClipTrim={(trimStart, trimEnd) => {
          if (!selectedClip) return;
          const media = mediaById.get(selectedClip.mediaId);
          if (!media) return;
          setProject((p) =>
            updateClip(p, selectedClip.id, {
              trimStart: clamp(trimStart, 0, media.duration - 0.05),
              trimEnd: clamp(trimEnd, 0.05, media.duration),
            }),
          );
        }}
      />

      <div className="feeds-editor__footer-actions">
        <button
          type="button"
          className="feeds-editor__link-btn"
          onClick={() => void handleUseOriginal()}
          disabled={exporting || project.clips.length === 0}
        >
          Use original
        </button>
      </div>

      {exportProgress ? (
        <div className="feeds-editor-export" role="status" aria-live="polite">
          <div className="feeds-editor-export__card">
            <strong>{exportProgress.message}</strong>
            <div className="feeds-editor-export__bar">
              <span style={{ width: `${Math.round(exportProgress.ratio * 100)}%` }} />
            </div>
          </div>
        </div>
      ) : null}

      <input
        ref={mediaInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files, false);
          e.target.value = "";
        }}
      />
      <input
        ref={musicInputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.aac"
        hidden
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files, true);
          e.target.value = "";
        }}
      />
    </div>,
    document.body,
  );
}
