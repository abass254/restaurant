"use client";

import {
  MAX_CLIPS,
  type AudioClip,
  type TextOverlay,
  type TransitionType,
  type VideoClip,
} from "@/lib/feed-editor/project";

export type EditorTool =
  | "trim"
  | "adjust"
  | "text"
  | "sticker"
  | "volume"
  | "music"
  | null;

type EditorToolbarProps = {
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  clipCount: number;
  selectedClip: VideoClip | null;
  selectedAudio: AudioClip | null;
  selectedText: TextOverlay | null;
  clipMuted: boolean;
  exporting: boolean;
  transitionType: TransitionType;
  onAddMedia: () => void;
  onAddMusic: () => void;
  onAddText: () => void;
  onSplit: () => void;
  onDeleteSelected: () => void;
  onToggleMuteClip: () => void;
  onSetTransition: (type: TransitionType) => void;
  onUpdateText: (patch: Partial<Omit<TextOverlay, "id">>) => void;
  onUpdateAudio: (patch: Partial<Omit<AudioClip, "id" | "mediaId">>) => void;
  onUpdateClipTrim: (trimStart: number, trimEnd: number) => void;
};

const TOOLS: Array<{
  id: Exclude<EditorTool, null>;
  label: string;
  icon: string;
}> = [
  { id: "trim", label: "Trim", icon: "fa-scissors" },
  { id: "adjust", label: "Adjust", icon: "fa-sliders" },
  { id: "text", label: "Text", icon: "fa-font" },
  { id: "sticker", label: "Sticker", icon: "fa-face-smile" },
  { id: "volume", label: "Volume", icon: "fa-volume-high" },
  { id: "music", label: "Music", icon: "fa-music" },
];

export function EditorToolbar({
  activeTool,
  onToolChange,
  clipCount,
  selectedClip,
  selectedAudio,
  selectedText,
  clipMuted,
  exporting,
  transitionType,
  onAddMedia,
  onAddMusic,
  onAddText,
  onSplit,
  onDeleteSelected,
  onToggleMuteClip,
  onSetTransition,
  onUpdateText,
  onUpdateAudio,
  onUpdateClipTrim,
}: EditorToolbarProps) {
  function selectTool(tool: Exclude<EditorTool, null>) {
    if (tool === "text") {
      if (!selectedText) onAddText();
      onToolChange("text");
      return;
    }
    if (tool === "music") {
      onToolChange("music");
      return;
    }
    if (tool === "sticker") {
      onToolChange(activeTool === "sticker" ? null : "sticker");
      return;
    }
    onToolChange(activeTool === tool ? null : tool);
  }

  return (
    <div className="feeds-editor-toolbar">
      {activeTool ? (
        <div className="feeds-editor-inspector feeds-editor-inspector--sheet">
          {activeTool === "trim" ? (
            <>
              <div className="feeds-editor-inspector__row">
                <button
                  type="button"
                  className="feeds-editor-chip"
                  onClick={onSplit}
                  disabled={exporting || !selectedClip}
                >
                  <i className="fa-solid fa-scissors" aria-hidden />
                  Split at playhead
                </button>
                <button
                  type="button"
                  className="feeds-editor-chip"
                  onClick={onDeleteSelected}
                  disabled={
                    exporting || (!selectedClip && !selectedAudio && !selectedText)
                  }
                >
                  <i className="fa-solid fa-trash" aria-hidden />
                  Delete
                </button>
              </div>
              {selectedClip ? (
                <div className="feeds-editor-inspector__grid">
                  <label>
                    <span>Start</span>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={Number(selectedClip.trimStart.toFixed(1))}
                      disabled={exporting}
                      onChange={(e) =>
                        onUpdateClipTrim(
                          Math.max(0, Number(e.target.value) || 0),
                          selectedClip.trimEnd,
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>End</span>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={Number(selectedClip.trimEnd.toFixed(1))}
                      disabled={exporting}
                      onChange={(e) =>
                        onUpdateClipTrim(
                          selectedClip.trimStart,
                          Math.max(0.1, Number(e.target.value) || 0.1),
                        )
                      }
                    />
                  </label>
                </div>
              ) : (
                <p className="feeds-editor-inspector__hint">
                  Select a clip on the timeline to trim.
                </p>
              )}
            </>
          ) : null}

          {activeTool === "adjust" ? (
            <>
              <div className="feeds-editor-inspector__row">
                <button
                  type="button"
                  className="feeds-editor-chip"
                  onClick={onAddMedia}
                  disabled={exporting || clipCount >= MAX_CLIPS}
                >
                  <i className="fa-solid fa-plus" aria-hidden />
                  Add clip
                </button>
                <button
                  type="button"
                  className={`feeds-editor-chip${clipMuted ? " is-active" : ""}`}
                  onClick={onToggleMuteClip}
                  disabled={exporting || !selectedClip}
                >
                  <i
                    className={`fa-solid ${clipMuted ? "fa-volume-xmark" : "fa-volume-high"}`}
                    aria-hidden
                  />
                  {clipMuted ? "Unmute clip" : "Mute clip"}
                </button>
              </div>
              <label>
                <span>Transition</span>
                <select
                  value={transitionType}
                  disabled={exporting || clipCount < 2}
                  onChange={(e) =>
                    onSetTransition(e.target.value as TransitionType)
                  }
                >
                  <option value="none">Cut</option>
                  <option value="fade">Fade</option>
                  <option value="dissolve">Dissolve</option>
                  <option value="slideleft">Slide ←</option>
                  <option value="slideright">Slide →</option>
                </select>
              </label>
            </>
          ) : null}

          {activeTool === "text" && selectedText ? (
            <div className="feeds-editor-inspector__grid">
              <label className="feeds-editor-inspector__span">
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
            </div>
          ) : null}

          {activeTool === "sticker" ? (
            <p className="feeds-editor-inspector__hint">
              Stickers are coming soon. Use Text for captions for now.
            </p>
          ) : null}

          {activeTool === "volume" ? (
            selectedAudio ? (
              <label>
                <span>Music volume</span>
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
            ) : (
              <div className="feeds-editor-inspector__row">
                <button
                  type="button"
                  className="feeds-editor-chip"
                  onClick={onAddMusic}
                  disabled={exporting}
                >
                  <i className="fa-solid fa-music" aria-hidden />
                  Add sound to adjust volume
                </button>
              </div>
            )
          ) : null}

          {activeTool === "music" ? (
            <div className="feeds-editor-inspector__row">
              <button
                type="button"
                className="feeds-editor-chip"
                onClick={onAddMusic}
                disabled={exporting}
              >
                <i className="fa-solid fa-plus" aria-hidden />
                Add from device
              </button>
              {selectedAudio ? (
                <button
                  type="button"
                  className="feeds-editor-chip"
                  onClick={onDeleteSelected}
                  disabled={exporting}
                >
                  <i className="fa-solid fa-trash" aria-hidden />
                  Remove sound
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <nav className="feeds-editor-tools" aria-label="Editing tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`feeds-editor-tools__btn${
              activeTool === tool.id ? " is-active" : ""
            }`}
            disabled={exporting}
            onClick={() => selectTool(tool.id)}
          >
            <i className={`fa-solid ${tool.icon}`} aria-hidden />
            <span>{tool.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
