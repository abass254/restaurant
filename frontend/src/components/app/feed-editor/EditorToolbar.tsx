"use client";

import {
  MAX_CLIPS,
  type AudioClip,
  type TextOverlay,
  type VideoClip,
} from "@/lib/feed-editor/project";

type EditorToolbarProps = {
  clipCount: number;
  selectedClip: VideoClip | null;
  selectedAudio: AudioClip | null;
  selectedText: TextOverlay | null;
  exporting: boolean;
  onAddMedia: () => void;
  onAddMusic: () => void;
  onAddText: () => void;
  onSplit: () => void;
  onDeleteSelected: () => void;
  onUpdateText: (patch: Partial<Omit<TextOverlay, "id">>) => void;
  onUpdateAudio: (patch: Partial<Omit<AudioClip, "id" | "mediaId">>) => void;
};

export function EditorToolbar({
  clipCount,
  selectedClip,
  selectedAudio,
  selectedText,
  exporting,
  onAddMedia,
  onAddMusic,
  onAddText,
  onSplit,
  onDeleteSelected,
  onUpdateText,
  onUpdateAudio,
}: EditorToolbarProps) {
  return (
    <div className="feeds-editor-toolbar">
      <div className="feeds-editor-toolbar__actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onAddMedia}
          disabled={exporting || clipCount >= MAX_CLIPS}
          title={clipCount >= MAX_CLIPS ? `Max ${MAX_CLIPS} clips` : "Add clips"}
        >
          <i className="fa-solid fa-plus" aria-hidden="true" />
          Media
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onAddMusic}
          disabled={exporting}
        >
          <i className="fa-solid fa-music" aria-hidden="true" />
          Music
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onAddText}
          disabled={exporting}
        >
          <i className="fa-solid fa-font" aria-hidden="true" />
          Text
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onSplit}
          disabled={exporting || !selectedClip}
        >
          <i className="fa-solid fa-scissors" aria-hidden="true" />
          Split
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onDeleteSelected}
          disabled={
            exporting || (!selectedClip && !selectedAudio && !selectedText)
          }
        >
          <i className="fa-solid fa-trash" aria-hidden="true" />
          Delete
        </button>
      </div>

      {selectedText ? (
        <div className="feeds-editor-inspector">
          <label>
            <span>Text</span>
            <input
              type="text"
              value={selectedText.text}
              disabled={exporting}
              onChange={(e) => onUpdateText({ text: e.target.value })}
            />
          </label>
          <label>
            <span>Size</span>
            <input
              type="range"
              min={28}
              max={96}
              value={selectedText.fontSize}
              disabled={exporting}
              onChange={(e) =>
                onUpdateText({ fontSize: Number(e.target.value) })
              }
            />
          </label>
          <label>
            <span>Color</span>
            <input
              type="color"
              value={selectedText.color}
              disabled={exporting}
              onChange={(e) => onUpdateText({ color: e.target.value })}
            />
          </label>
          <label>
            <span>Start</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={Number(selectedText.startAt.toFixed(1))}
              disabled={exporting}
              onChange={(e) =>
                onUpdateText({ startAt: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
          <label>
            <span>Duration</span>
            <input
              type="number"
              min={0.5}
              step={0.1}
              value={Number(selectedText.duration.toFixed(1))}
              disabled={exporting}
              onChange={(e) =>
                onUpdateText({
                  duration: Math.max(0.5, Number(e.target.value) || 0.5),
                })
              }
            />
          </label>
        </div>
      ) : null}

      {selectedAudio ? (
        <div className="feeds-editor-inspector">
          <label>
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={selectedAudio.volume}
              disabled={exporting}
              onChange={(e) =>
                onUpdateAudio({ volume: Number(e.target.value) })
              }
            />
          </label>
          <label>
            <span>Start</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={Number(selectedAudio.startAt.toFixed(1))}
              disabled={exporting}
              onChange={(e) =>
                onUpdateAudio({
                  startAt: Math.max(0, Number(e.target.value) || 0),
                })
              }
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
