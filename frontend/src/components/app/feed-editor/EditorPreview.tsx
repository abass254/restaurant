"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  type EditorMediaAsset,
  type EditorProject,
  type TextOverlay,
} from "@/lib/feed-editor/project";
import {
  buildClipSegments,
  findActiveSegment,
  mediaTimeAt,
} from "@/lib/feed-editor/timeline";

type EditorPreviewProps = {
  project: EditorProject;
  mediaById: Map<string, EditorMediaAsset>;
  currentTime: number;
  playing: boolean;
  selectedTextId: string | null;
  onSelectText: (id: string | null) => void;
  onMoveText: (id: string, x: number, y: number) => void;
};

export function EditorPreview({
  project,
  mediaById,
  currentTime,
  playing,
  selectedTextId,
  onSelectText,
  onMoveText,
}: EditorPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const segments = useMemo(
    () => buildClipSegments(project, mediaById),
    [project, mediaById],
  );
  const active = findActiveSegment(segments, currentTime);
  const activeOverlays = project.textOverlays.filter(
    (t) => currentTime >= t.startAt && currentTime < t.startAt + t.duration,
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active || active.media.kind !== "video") return;
    const target = mediaTimeAt(active, currentTime);
    if (Math.abs(video.currentTime - target) > 0.12) {
      try {
        video.currentTime = target;
      } catch {
        /* ignore seek */
      }
    }
    if (playing) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [active, currentTime, playing]);

  function handleTextPointerDown(
    event: React.PointerEvent,
    overlay: TextOverlay,
  ) {
    event.preventDefault();
    event.stopPropagation();
    onSelectText(overlay.id);
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();

    function onMove(ev: PointerEvent) {
      const x = Math.min(0.95, Math.max(0.05, (ev.clientX - rect.left) / rect.width));
      const y = Math.min(0.95, Math.max(0.05, (ev.clientY - rect.top) / rect.height));
      onMoveText(overlay.id, x, y);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div className="feeds-editor-preview">
      <div
        ref={stageRef}
        className="feeds-editor-preview__stage"
        onClick={() => onSelectText(null)}
      >
        {active?.media.kind === "video" ? (
          <video
            key={active.clip.id}
            ref={videoRef}
            src={active.media.objectUrl}
            playsInline
            muted
            preload="auto"
            className="feeds-editor-preview__media"
          />
        ) : active?.media.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={active.media.objectUrl}
            alt=""
            className="feeds-editor-preview__media"
          />
        ) : (
          <div className="feeds-editor-preview__empty">
            <i className="fa-solid fa-clapperboard" aria-hidden="true" />
            <span>Add clips to preview</span>
          </div>
        )}

        {activeOverlays.map((overlay) => (
          <div
            key={overlay.id}
            className={`feeds-editor-preview__text${
              selectedTextId === overlay.id ? " is-selected" : ""
            }`}
            style={{
              left: `${overlay.x * 100}%`,
              top: `${overlay.y * 100}%`,
              color: overlay.color,
              fontSize: `calc(${overlay.fontSize} * 0.045cqw)`,
            }}
            onPointerDown={(e) => handleTextPointerDown(e, overlay)}
          >
            {overlay.text}
          </div>
        ))}
      </div>
    </div>
  );
}
