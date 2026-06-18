/**
 * Video — generate a short instructional first-aid motion clip on-device
 * (Wan 2.1 T2V). Heavy and slow by nature: ~14.5 GB of models and minutes per
 * clip, stated up front. Illustrative teaching aid only. Without ffmpeg the
 * output is an AVI offered for download (browsers don't play AVI inline).
 */
import { useState } from "react";

import { Clapperboard, Download } from "lucide-react";

import { Button } from "../ui/Button";
import { DisclaimerNote, ErrorBar, OutputCard, ProgressBar } from "../workspace/ToolBits";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";
import { useToolRun } from "../workspace/useToolRun";

const PRESETS = [
  { short: "Recovery position", full: "rolling a person into the recovery position" },
  { short: "Chest compressions", full: "the up-and-down rhythm of CPR chest compressions" },
  { short: "Wrap a bandage", full: "wrapping a pressure bandage around a forearm" },
];

export function VideoTool() {
  const { phase, stage, progress, output, telemetry, evidence, error, run, ready } = useToolRun();
  const [prompt, setPrompt] = useState("");
  const [frames, setFrames] = useState(17);
  const result = output?.tool === "video" ? output : null;

  return (
    <ToolLayout
      title="Animate a step"
      blurb="Generate a short instructional first-aid motion clip on-device. An illustrative teaching aid only — not real footage or a diagnosis."
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-xl border border-remote-line bg-remote-soft px-4 py-3 text-sm text-remote">
          <Clapperboard className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>This is heavy: ~14.5 GB of models and several minutes per clip. The first run also downloads the models.</span>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="Describe the first-aid action to animate…"
          className="w-full resize-y rounded-xl border border-hairline bg-surface px-3 py-2.5 text-sm leading-relaxed text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.short} type="button" onClick={() => setPrompt(p.full)} className="rounded-full border border-hairline px-2.5 py-1 text-xs text-fg-muted transition-colors hover:bg-raised">
              {p.short}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-muted">Length</span>
          <select
            value={frames}
            onChange={(e) => setFrames(Number(e.target.value))}
            className="rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-sm text-fg focus-visible:outline focus-visible:outline-2"
            aria-label="Clip length"
          >
            <option value={17}>~1s · 17 frames (fastest)</option>
            <option value={33}>~2s · 33 frames</option>
            <option value={49}>~3s · 49 frames</option>
            <option value={65}>~4s · 65 frames</option>
            <option value={81}>~5s · 81 frames (best motion, slowest)</option>
          </select>
          <Button variant="primary" onClick={() => run({ tool: "video", params: { prompt, frames } })} loading={phase === "running"} disabled={!prompt.trim() || !ready}>
            <Clapperboard className="h-4 w-4" aria-hidden /> {phase === "done" ? "Generate again" : "Generate clip"}
          </Button>
        </div>
        <p className="text-2xs text-fg-faint">
          Generation time scales with length — roughly a few minutes per second of video on laptop-class hardware. 81 frames is Wan
          1.3B's native length (best motion); going longer would exceed the model and degrade quality.
        </p>

        {phase === "running" && <ProgressBar value={progress} label={stage || "Generating on-device (this takes minutes)…"} />}
        {phase === "error" && error && <ErrorBar message={error} />}
        {result && (
          <OutputCard title="Clip">
            {result.playable ? (
              <video controls src={result.url} className="mx-auto max-h-[420px] rounded-lg border border-hairline" />
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-fg-muted">
                  {result.width}×{result.height} · {result.frames} frames @ {result.fps}fps · AVI
                </span>
                <a href={result.url} download="first-aid-clip.avi" className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
                  <Download className="h-3.5 w-3.5" aria-hidden /> Download
                </a>
              </div>
            )}
            {!result.playable && <p className="mt-2 text-2xs text-fg-faint">AVI clip — open in QuickTime or VLC. (Inline playback needs ffmpeg for an mp4 transcode, which isn't installed here.)</p>}
          </OutputCard>
        )}
        <DisclaimerNote>
          Illustrative teaching aid generated on-device — a simplified animation, not real footage, a medical reference, or a diagnosis.
        </DisclaimerNote>
        {phase === "done" && <ToolFooter telemetry={telemetry} evidence={evidence} />}
      </div>
    </ToolLayout>
  );
}
