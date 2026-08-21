"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useRef } from "react";
import {
  clipDuration,
  projectDuration,
  transitionBetween,
  type EditorMediaAsset,
  type EditorProject,
  type TransitionType,
} from "@/lib/feed-editor/project";
import { clamp, formatTimecode, pxPerSecond } from "@/lib/feed-editor/timeline";

type EditorTimelineProps = {
  project: EditorProject;
  mediaById: Map<string, EditorMediaAsset>;
  currentTime: number;
  selectedClipId: string | null;
  selectedAudioId: string | null;
  selectedTextId: string | null;
  onSeek: (time: number) => void;
  onSelectClip: (id: string | null) => void;
  onSelectAudio: (id: string | null) => void;
  onSelectText: (id: string | null) => void;
  onReorderClips: (from: number, to: number) => void;
  onTrimClip: (clipId: string, trimStart: number, trimEnd: number) => void;
  onSetTransition: (afterIndex: number, type: TransitionType) => void;
};

function SortableClip({
  id,
  width,
  label,
  selected,
  kind,
  trimStart,
  trimEnd,
  mediaDuration,
  pps,
  onSelect,
  onTrim,
}: {
  id: string;
  width: number;
  label: string;
  selected: boolean;
  kind: string;
  trimStart: number;
  trimEnd: number;
  mediaDuration: number;
  pps: number;
  onSelect: () => void;
  onTrim: (trimStart: number, trimEnd: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: React.CSSProperties = {
    width,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };

  function beginTrim(edge: "left" | "right", clientX: number) {
    const baseStart = trimStart;
    const baseEnd = trimEnd;
    function move(ev: PointerEvent) {
      const deltaSec = (ev.clientX - clientX) / pps;
      if (edge === "left") {
        onTrim(
          clamp(baseStart + deltaSec, 0, baseEnd - 0.05),
          baseEnd,
        );
      } else {
        onTrim(
          baseStart,
          clamp(baseEnd + deltaSec, baseStart + 0.05, mediaDuration),
        );
      }
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`feeds-editor-clip${selected ? " is-selected" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <button
        type="button"
        className="feeds-editor-clip__handle feeds-editor-clip__handle--left"
        aria-label="Trim start"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          beginTrim("left", e.clientX);
        }}
      />
      <button
        type="button"
        className="feeds-editor-clip__body"
        {...attributes}
        {...listeners}
      >
        <i
          className={`fa-solid ${kind === "image" ? "fa-image" : "fa-film"}`}
          aria-hidden="true"
        />
        <span>{label}</span>
      </button>
      <button
        type="button"
        className="feeds-editor-clip__handle feeds-editor-clip__handle--right"
        aria-label="Trim end"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          beginTrim("right", e.clientX);
        }}
      />
    </div>
  );
}

export function EditorTimeline({
  project,
  mediaById,
  currentTime,
  selectedClipId,
  selectedAudioId,
  selectedTextId,
  onSeek,
  onSelectClip,
  onSelectAudio,
  onSelectText,
  onReorderClips,
  onTrimClip,
  onSetTransition,
}: EditorTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const duration = Math.max(1, projectDuration(project));
  const trackWidth = Math.max(320, duration * 64);
  const pps = pxPerSecond(duration, trackWidth);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const clipIds = useMemo(() => project.clips.map((c) => c.id), [project.clips]);

  function seekFromClientX(clientX: number) {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    onSeek(clamp(x / pps, 0, duration));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = project.clips.findIndex((c) => c.id === active.id);
    const to = project.clips.findIndex((c) => c.id === over.id);
    if (from >= 0 && to >= 0) onReorderClips(from, to);
  }

  return (
    <div className="feeds-editor-timeline">
      <div className="feeds-editor-timeline__meta">
        <span>{formatTimecode(currentTime)}</span>
        <span className="app-muted">/ {formatTimecode(duration)}</span>
      </div>

      <div
        className="feeds-editor-timeline__scroll"
        ref={trackRef}
        onClick={(e) => seekFromClientX(e.clientX)}
      >
        <div className="feeds-editor-timeline__tracks" style={{ width: trackWidth }}>
          <div
            className="feeds-editor-playhead"
            style={{ left: currentTime * pps }}
            aria-hidden="true"
          />

          <div className="feeds-editor-track">
            <span className="feeds-editor-track__label">Video</span>
            <div className="feeds-editor-track__lane">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext items={clipIds} strategy={horizontalListSortingStrategy}>
                  {project.clips.map((clip, index) => {
                    const media = mediaById.get(clip.mediaId);
                    const width = Math.max(48, clipDuration(clip) * pps);
                    return (
                      <div key={clip.id} className="feeds-editor-clip-wrap">
                        <SortableClip
                          id={clip.id}
                          width={width}
                          label={media?.name ?? "Clip"}
                          kind={media?.kind ?? "video"}
                          selected={selectedClipId === clip.id}
                          trimStart={clip.trimStart}
                          trimEnd={clip.trimEnd}
                          mediaDuration={media?.duration ?? clip.trimEnd}
                          pps={pps}
                          onSelect={() => onSelectClip(clip.id)}
                          onTrim={(trimStart, trimEnd) =>
                            onTrimClip(clip.id, trimStart, trimEnd)
                          }
                        />
                        {index < project.clips.length - 1 ? (
                          <TransitionChip
                            type={transitionBetween(project, index)?.type ?? "none"}
                            onChange={(type) => onSetTransition(index, type)}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </SortableContext>
              </DndContext>
              {project.clips.length === 0 ? (
                <span className="feeds-editor-track__empty">No clips yet</span>
              ) : null}
            </div>
          </div>

          <div className="feeds-editor-track">
            <span className="feeds-editor-track__label">Audio</span>
            <div className="feeds-editor-track__lane feeds-editor-track__lane--free">
              {project.audioClips.map((audio) => {
                const media = mediaById.get(audio.mediaId);
                const width = Math.max(
                  40,
                  (audio.trimEnd - audio.trimStart) * pps,
                );
                return (
                  <button
                    key={audio.id}
                    type="button"
                    className={`feeds-editor-audio${
                      selectedAudioId === audio.id ? " is-selected" : ""
                    }`}
                    style={{ left: audio.startAt * pps, width }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAudio(audio.id);
                    }}
                  >
                    <i className="fa-solid fa-music" aria-hidden="true" />
                    <span>{media?.name ?? "Music"}</span>
                  </button>
                );
              })}
              {project.audioClips.length === 0 ? (
                <span className="feeds-editor-track__empty">No music</span>
              ) : null}
            </div>
          </div>

          <div className="feeds-editor-track">
            <span className="feeds-editor-track__label">Text</span>
            <div className="feeds-editor-track__lane feeds-editor-track__lane--free">
              {project.textOverlays.map((text) => (
                <button
                  key={text.id}
                  type="button"
                  className={`feeds-editor-text-clip${
                    selectedTextId === text.id ? " is-selected" : ""
                  }`}
                  style={{ left: text.startAt * pps, width: Math.max(40, text.duration * pps) }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectText(text.id);
                  }}
                >
                  <i className="fa-solid fa-font" aria-hidden="true" />
                  <span>{text.text}</span>
                </button>
              ))}
              {project.textOverlays.length === 0 ? (
                <span className="feeds-editor-track__empty">No text</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TransitionChip({
  type,
  onChange,
}: {
  type: TransitionType;
  onChange: (type: TransitionType) => void;
}) {
  return (
    <label className="feeds-editor-transition" onClick={(e) => e.stopPropagation()}>
      <i className="fa-solid fa-right-left" aria-hidden="true" />
      <select
        value={type}
        aria-label="Transition"
        onChange={(e) => onChange(e.target.value as TransitionType)}
      >
        <option value="none">Cut</option>
        <option value="fade">Fade</option>
        <option value="dissolve">Dissolve</option>
        <option value="slideleft">Slide ←</option>
        <option value="slideright">Slide →</option>
      </select>
    </label>
  );
}
