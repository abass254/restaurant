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
import { clamp, formatClock, pxPerSecond } from "@/lib/feed-editor/timeline";

type EditorTimelineProps = {
  project: EditorProject;
  mediaById: Map<string, EditorMediaAsset>;
  currentTime: number;
  selectedClipId: string | null;
  selectedAudioId: string | null;
  selectedTextId: string | null;
  clipMuted: boolean;
  onSeek: (time: number) => void;
  onSelectClip: (id: string | null) => void;
  onSelectAudio: (id: string | null) => void;
  onSelectText: (id: string | null) => void;
  onReorderClips: (from: number, to: number) => void;
  onTrimClip: (clipId: string, trimStart: number, trimEnd: number) => void;
  onSetTransition: (afterIndex: number, type: TransitionType) => void;
  onToggleMuteClip: () => void;
  onAddMusic: () => void;
  onAddText: () => void;
};

function SortableClip({
  id,
  width,
  label,
  selected,
  kind,
  objectUrl,
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
  objectUrl?: string;
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
        onTrim(clamp(baseStart + deltaSec, 0, baseEnd - 0.05), baseEnd);
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
        style={
          kind !== "audio" && objectUrl
            ? {
                backgroundImage: `linear-gradient(90deg, rgba(0,0,0,0.25), rgba(0,0,0,0.1)), url(${objectUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
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
  clipMuted,
  onSeek,
  onSelectClip,
  onSelectAudio,
  onSelectText,
  onReorderClips,
  onTrimClip,
  onSetTransition,
  onToggleMuteClip,
  onAddMusic,
  onAddText,
}: EditorTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const duration = Math.max(1, projectDuration(project));
  const trackWidth = Math.max(360, duration * 72);
  const pps = pxPerSecond(duration, trackWidth);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const clipIds = useMemo(() => project.clips.map((c) => c.id), [project.clips]);

  const rulerMarks = useMemo(() => {
    const step = duration <= 8 ? 1 : duration <= 30 ? 2 : 5;
    const marks: number[] = [];
    for (let t = 0; t <= duration + 0.001; t += step) marks.push(Number(t.toFixed(2)));
    return marks;
  }, [duration]);

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
      <div
        className="feeds-editor-timeline__scroll"
        ref={trackRef}
        onClick={(e) => seekFromClientX(e.clientX)}
      >
        <div className="feeds-editor-timeline__tracks" style={{ width: trackWidth }}>
          <div className="feeds-editor-ruler" aria-hidden="true">
            {rulerMarks.map((t) => (
              <span
                key={t}
                className="feeds-editor-ruler__mark"
                style={{ left: t * pps }}
              >
                {formatClock(t)}
              </span>
            ))}
          </div>

          <div
            className="feeds-editor-playhead"
            style={{ left: currentTime * pps }}
            aria-hidden="true"
          />

          <div className="feeds-editor-track feeds-editor-track--video">
            <div className="feeds-editor-track__lane">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext items={clipIds} strategy={horizontalListSortingStrategy}>
                  {project.clips.map((clip, index) => {
                    const media = mediaById.get(clip.mediaId);
                    const width = Math.max(56, clipDuration(clip) * pps);
                    return (
                      <div key={clip.id} className="feeds-editor-clip-wrap">
                        <SortableClip
                          id={clip.id}
                          width={width}
                          label={media?.name ?? "Clip"}
                          kind={media?.kind ?? "video"}
                          objectUrl={media?.objectUrl}
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

          {selectedClipId ? (
            <div className="feeds-editor-clip-actions">
              <button
                type="button"
                className={`feeds-editor-chip${clipMuted ? " is-active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMuteClip();
                }}
              >
                <i
                  className={`fa-solid ${clipMuted ? "fa-volume-xmark" : "fa-volume-high"}`}
                  aria-hidden
                />
                Mute Clip
              </button>
              <button
                type="button"
                className="feeds-editor-chip"
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek(currentTime);
                }}
                title="Use the current frame as cover"
              >
                <i className="fa-solid fa-image" aria-hidden />
                Cover
              </button>
            </div>
          ) : null}

          <div className="feeds-editor-track feeds-editor-track--overlay">
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
              {project.textOverlays.map((text) => (
                <button
                  key={text.id}
                  type="button"
                  className={`feeds-editor-text-clip${
                    selectedTextId === text.id ? " is-selected" : ""
                  }`}
                  style={{
                    left: text.startAt * pps,
                    width: Math.max(40, text.duration * pps),
                    top: project.audioClips.length ? 34 : 4,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectText(text.id);
                  }}
                >
                  <i className="fa-solid fa-font" aria-hidden="true" />
                  <span>{text.text}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="feeds-editor-add-rows">
        <button type="button" className="feeds-editor-add-row" onClick={onAddMusic}>
          <i className="fa-solid fa-music" aria-hidden />
          Add Sound
        </button>
        <button type="button" className="feeds-editor-add-row" onClick={onAddText}>
          <i className="fa-solid fa-font" aria-hidden />
          Add Text
        </button>
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
