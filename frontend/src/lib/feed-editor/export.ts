import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import {
  clipDuration,
  isPhotoOnlyProject,
  transitionBetween,
  type EditorExportPreset,
  type EditorMediaAsset,
  type EditorProject,
  type TransitionType,
} from "./project";

const CORE_VERSION = "0.12.6";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

let ffmpegSingleton: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export type ExportProgress = {
  ratio: number;
  message: string;
};

function xfadeName(type: TransitionType): string | null {
  switch (type) {
    case "fade":
      return "fade";
    case "dissolve":
      return "dissolve";
    case "slideleft":
      return "slideleft";
    case "slideright":
      return "slideright";
    default:
      return null;
  }
}

async function getFfmpeg(
  onProgress?: (p: ExportProgress) => void,
): Promise<FFmpeg> {
  if (ffmpegSingleton?.loaded) return ffmpegSingleton;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    onProgress?.({ ratio: 0.02, message: "Loading editor engine…" });
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", () => {
      /* quiet */
    });
    ffmpeg.on("progress", ({ progress }) => {
      const ratio = Math.min(0.99, Math.max(0, progress || 0));
      onProgress?.({
        ratio: 0.15 + ratio * 0.8,
        message: `Exporting… ${Math.round(ratio * 100)}%`,
      });
    });

    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegSingleton = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    throw err;
  }
}

function outSize(preset: EditorExportPreset): { w: number; h: number } {
  if (preset === "720p") return { w: 720, h: 1280 };
  return { w: 1080, h: 1920 };
}

function scaleCropFilter(w: number, h: number): string {
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p`;
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/\n/g, " ");
}

async function exportPhotoJpeg(
  project: EditorProject,
  mediaById: Map<string, EditorMediaAsset>,
  filesById: Map<string, File>,
  preset: EditorExportPreset,
  onProgress?: (p: ExportProgress) => void,
): Promise<File> {
  const clip = project.clips[0]!;
  const file = filesById.get(clip.mediaId);
  if (!file) throw new Error("Missing image file.");
  const { w, h } = outSize(preset);

  onProgress?.({ ratio: 0.2, message: "Cropping photo…" });
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");

  const scale = Math.max(w / bitmap.width, h / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
  bitmap.close();

  onProgress?.({ ratio: 0.8, message: "Encoding JPEG…" });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("JPEG encode failed."))),
      "image/jpeg",
      0.92,
    );
  });
  onProgress?.({ ratio: 1, message: "Done" });
  return new File([blob], "edited-post.jpg", { type: "image/jpeg" });
}

export async function exportEditorProject(
  project: EditorProject,
  mediaById: Map<string, EditorMediaAsset>,
  filesById: Map<string, File>,
  options?: {
    preset?: EditorExportPreset;
    onProgress?: (p: ExportProgress) => void;
  },
): Promise<File> {
  const onProgress = options?.onProgress;
  const preset = options?.preset ?? "1080p";

  if (project.clips.length === 0) {
    throw new Error("Add at least one clip before exporting.");
  }

  if (isPhotoOnlyProject(project, mediaById)) {
    return exportPhotoJpeg(project, mediaById, filesById, preset, onProgress);
  }

  const ffmpeg = await getFfmpeg(onProgress);
  const { w, h } = outSize(preset);
  const sc = scaleCropFilter(w, h);

  onProgress?.({ ratio: 0.08, message: "Preparing clips…" });

  // Write inputs
  const inputArgs: string[] = [];
  for (let i = 0; i < project.clips.length; i++) {
    const clip = project.clips[i]!;
    const file = filesById.get(clip.mediaId);
    const media = mediaById.get(clip.mediaId);
    if (!file || !media) throw new Error("Missing clip media.");
    const ext = media.kind === "image" ? "jpg" : file.name.split(".").pop() || "mp4";
    const name = `clip${i}.${ext}`;
    await ffmpeg.writeFile(name, await fetchFile(file));
    inputArgs.push("-i", name);
  }

  for (let i = 0; i < project.audioClips.length; i++) {
    const audio = project.audioClips[i]!;
    const file = filesById.get(audio.mediaId);
    if (!file) throw new Error("Missing audio file.");
    const ext = file.name.split(".").pop() || "mp3";
    const name = `music${i}.${ext}`;
    await ffmpeg.writeFile(name, await fetchFile(file));
    inputArgs.push("-i", name);
  }

  // Build per-clip trimmed + scaled labels
  const filterParts: string[] = [];
  const vLabels: string[] = [];
  const aLabels: string[] = [];
  const clipDurations: number[] = [];

  for (let i = 0; i < project.clips.length; i++) {
    const clip = project.clips[i]!;
    const media = mediaById.get(clip.mediaId)!;
    const dur = clipDuration(clip);
    clipDurations.push(dur);
    const vOut = `v${i}`;
    const aOut = `a${i}`;

    if (media.kind === "image") {
      filterParts.push(
        `[${i}:v]loop=loop=-1:size=1:start=0,trim=duration=${dur.toFixed(3)},${sc},setpts=PTS-STARTPTS[${vOut}]`,
      );
      filterParts.push(
        `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS[${aOut}]`,
      );
    } else {
      filterParts.push(
        `[${i}:v]trim=start=${clip.trimStart.toFixed(3)}:end=${clip.trimEnd.toFixed(3)},setpts=PTS-STARTPTS,${sc}[${vOut}]`,
      );
      // Some clips may lack audio — generate silence fallback via amerge later; try stream.
      filterParts.push(
        `[${i}:a]atrim=start=${clip.trimStart.toFixed(3)}:end=${clip.trimEnd.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100[${aOut}]`,
      );
    }
    vLabels.push(vOut);
    aLabels.push(aOut);
  }

  // Chain xfade / acrossfade or concat
  let lastV = vLabels[0]!;
  let lastA = aLabels[0]!;
  let timelineOffset = clipDurations[0]!;

  if (project.clips.length === 1) {
    // nothing to chain
  } else {
    for (let i = 0; i < project.clips.length - 1; i++) {
      const transition = transitionBetween(project, i);
      const nextV = vLabels[i + 1]!;
      const nextA = aLabels[i + 1]!;
      const nextDur = clipDurations[i + 1]!;
      const xname = transition ? xfadeName(transition.type) : null;
      const td =
        xname && transition
          ? Math.min(transition.duration, clipDurations[i]! * 0.45, nextDur * 0.45)
          : 0;

      const outV = `vx${i}`;
      const outA = `ax${i}`;

      if (xname && td > 0.05) {
        const offset = Math.max(0, timelineOffset - td);
        filterParts.push(
          `[${lastV}][${nextV}]xfade=transition=${xname}:duration=${td.toFixed(3)}:offset=${offset.toFixed(3)}[${outV}]`,
        );
        filterParts.push(
          `[${lastA}][${nextA}]acrossfade=d=${td.toFixed(3)}[${outA}]`,
        );
        timelineOffset = offset + nextDur;
      } else {
        filterParts.push(
          `[${lastV}][${nextV}]concat=n=2:v=1:a=0[${outV}]`,
        );
        filterParts.push(
          `[${lastA}][${nextA}]concat=n=2:v=0:a=1[${outA}]`,
        );
        timelineOffset += nextDur;
      }
      lastV = outV;
      lastA = outA;
    }
  }

  // Music mix
  let finalA = lastA;
  const musicStartIndex = project.clips.length;
  for (let i = 0; i < project.audioClips.length; i++) {
    const audio = project.audioClips[i]!;
    const inputIdx = musicStartIndex + i;
    const trimmed = `mtrim${i}`;
    const delayed = `mdelay${i}`;
    const faded = `mfade${i}`;
    const mixed = `amix${i}`;
    const musicDur = Math.max(0.05, audio.trimEnd - audio.trimStart);
    filterParts.push(
      `[${inputIdx}:a]atrim=start=${audio.trimStart.toFixed(3)}:end=${audio.trimEnd.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,volume=${audio.volume.toFixed(2)}[${trimmed}]`,
    );
    const delayMs = Math.round(audio.startAt * 1000);
    filterParts.push(
      `[${trimmed}]adelay=${delayMs}|${delayMs}[${delayed}]`,
    );
    const fadeIn = Math.min(audio.fadeIn, musicDur / 2);
    const fadeOut = Math.min(audio.fadeOut, musicDur / 2);
    const fadeOutStart = Math.max(0, musicDur - fadeOut);
    filterParts.push(
      `[${delayed}]afade=t=in:st=0:d=${fadeIn.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut.toFixed(3)}[${faded}]`,
    );
    filterParts.push(
      `[${finalA}][${faded}]amix=inputs=2:duration=longest:dropout_transition=2[${mixed}]`,
    );
    finalA = mixed;
  }

  // Text overlays via drawtext (use default font)
  let finalV = lastV;
  project.textOverlays.forEach((overlay, i) => {
    const out = `vt${i}`;
    const xExpr = `(w*${overlay.x.toFixed(4)})-(text_w/2)`;
    const yExpr = `(h*${overlay.y.toFixed(4)})-(text_h/2)`;
    const enable = `between(t\\,${overlay.startAt.toFixed(3)}\\,${(overlay.startAt + overlay.duration).toFixed(3)})`;
    const fontSize = Math.round(
      overlay.fontSize * (preset === "720p" ? 720 / 1080 : 1),
    );
    filterParts.push(
      `[${finalV}]drawtext=text='${escapeDrawtext(overlay.text)}':fontsize=${fontSize}:fontcolor=${overlay.color}:borderw=3:bordercolor=black@0.55:x=${xExpr}:y=${yExpr}:enable='${enable}'[${out}]`,
    );
    finalV = out;
  });

  const filterComplex = filterParts.join(";");
  const outName = "output.mp4";

  onProgress?.({ ratio: 0.12, message: "Rendering timeline…" });

  // Video clips may lack audio streams — retry with anullsrc injection if needed.
  try {
    await ffmpeg.exec([
      ...inputArgs,
      "-filter_complex",
      filterComplex,
      "-map",
      `[${finalV}]`,
      "-map",
      `[${finalA}]`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      preset === "720p" ? "28" : "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-shortest",
      outName,
    ]);
  } catch (firstErr) {
    // Rebuild with forced silent audio for every video input that may lack an audio stream.
    const safeFilters: string[] = [];
    const safeV: string[] = [];
    const safeA: string[] = [];
    const durs: number[] = [];

    for (let i = 0; i < project.clips.length; i++) {
      const clip = project.clips[i]!;
      const media = mediaById.get(clip.mediaId)!;
      const dur = clipDuration(clip);
      durs.push(dur);
      const vOut = `sv${i}`;
      const aOut = `sa${i}`;
      if (media.kind === "image") {
        safeFilters.push(
          `[${i}:v]loop=loop=-1:size=1:start=0,trim=duration=${dur.toFixed(3)},${sc},setpts=PTS-STARTPTS[${vOut}]`,
        );
      } else {
        safeFilters.push(
          `[${i}:v]trim=start=${clip.trimStart.toFixed(3)}:end=${clip.trimEnd.toFixed(3)},setpts=PTS-STARTPTS,${sc}[${vOut}]`,
        );
      }
      safeFilters.push(
        `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS[${aOut}]`,
      );
      safeV.push(vOut);
      safeA.push(aOut);
    }

    let lv = safeV[0]!;
    let la = safeA[0]!;
    let offsetCursor = durs[0]!;
    for (let i = 0; i < project.clips.length - 1; i++) {
      const transition = transitionBetween(project, i);
      const xname = transition ? xfadeName(transition.type) : null;
      const td =
        xname && transition
          ? Math.min(transition.duration, durs[i]! * 0.45, durs[i + 1]! * 0.45)
          : 0;
      const outV = `svx${i}`;
      const outA = `sax${i}`;
      if (xname && td > 0.05) {
        const offset = Math.max(0, offsetCursor - td);
        safeFilters.push(
          `[${lv}][${safeV[i + 1]}]xfade=transition=${xname}:duration=${td.toFixed(3)}:offset=${offset.toFixed(3)}[${outV}]`,
        );
        safeFilters.push(
          `[${la}][${safeA[i + 1]}]acrossfade=d=${td.toFixed(3)}[${outA}]`,
        );
        offsetCursor = offset + durs[i + 1]!;
      } else {
        safeFilters.push(`[${lv}][${safeV[i + 1]}]concat=n=2:v=1:a=0[${outV}]`);
        safeFilters.push(`[${la}][${safeA[i + 1]}]concat=n=2:v=0:a=1[${outA}]`);
        offsetCursor += durs[i + 1]!;
      }
      lv = outV;
      la = outA;
    }

    let fa = la;
    for (let i = 0; i < project.audioClips.length; i++) {
      const audio = project.audioClips[i]!;
      const inputIdx = musicStartIndex + i;
      const trimmed = `smtrim${i}`;
      const delayed = `smdelay${i}`;
      const faded = `smfade${i}`;
      const mixed = `samix${i}`;
      const musicDur = Math.max(0.05, audio.trimEnd - audio.trimStart);
      safeFilters.push(
        `[${inputIdx}:a]atrim=start=${audio.trimStart.toFixed(3)}:end=${audio.trimEnd.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,volume=${audio.volume.toFixed(2)}[${trimmed}]`,
      );
      const delayMs = Math.round(audio.startAt * 1000);
      safeFilters.push(`[${trimmed}]adelay=${delayMs}|${delayMs}[${delayed}]`);
      const fadeIn = Math.min(audio.fadeIn, musicDur / 2);
      const fadeOut = Math.min(audio.fadeOut, musicDur / 2);
      const fadeOutStart = Math.max(0, musicDur - fadeOut);
      safeFilters.push(
        `[${delayed}]afade=t=in:st=0:d=${fadeIn.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut.toFixed(3)}[${faded}]`,
      );
      safeFilters.push(
        `[${fa}][${faded}]amix=inputs=2:duration=longest:dropout_transition=2[${mixed}]`,
      );
      fa = mixed;
    }

    let fv = lv;
    project.textOverlays.forEach((overlay, i) => {
      const out = `svt${i}`;
      const xExpr = `(w*${overlay.x.toFixed(4)})-(text_w/2)`;
      const yExpr = `(h*${overlay.y.toFixed(4)})-(text_h/2)`;
      const enable = `between(t\\,${overlay.startAt.toFixed(3)}\\,${(overlay.startAt + overlay.duration).toFixed(3)})`;
      const fontSize = Math.round(
        overlay.fontSize * (preset === "720p" ? 720 / 1080 : 1),
      );
      safeFilters.push(
        `[${fv}]drawtext=text='${escapeDrawtext(overlay.text)}':fontsize=${fontSize}:fontcolor=${overlay.color}:borderw=3:bordercolor=black@0.55:x=${xExpr}:y=${yExpr}:enable='${enable}'[${out}]`,
      );
      fv = out;
    });

    try {
      await ffmpeg.deleteFile(outName);
    } catch {
      /* ignore */
    }

    await ffmpeg.exec([
      ...inputArgs,
      "-filter_complex",
      safeFilters.join(";"),
      "-map",
      `[${fv}]`,
      "-map",
      `[${fa}]`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      preset === "720p" ? "28" : "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-shortest",
      outName,
    ]);
    void firstErr;
  }

  const data = await ffmpeg.readFile(outName);
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data as ArrayBuffer);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: "video/mp4" });

  // Cleanup best-effort
  try {
    await ffmpeg.deleteFile(outName);
  } catch {
    /* ignore */
  }

  onProgress?.({ ratio: 1, message: "Done" });
  return new File([blob], "edited-reel.mp4", { type: "video/mp4" });
}
