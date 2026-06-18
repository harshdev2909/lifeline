/**
 * Illustrate — generate a simple instructional first-aid diagram on-device
 * (Stable Diffusion). An illustrative teaching aid only: a simplified line
 * drawing, never a real photo, diagnostic image, or medical reference.
 */
import { useState } from "react";

import { Download, Sparkles } from "lucide-react";

import { Button } from "../ui/Button";
import { DisclaimerNote, ErrorBar, OutputCard, ProgressBar } from "../workspace/ToolBits";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";
import { useToolRun } from "../workspace/useToolRun";

const PRESETS = [
  { short: "Recovery position", full: "the recovery position for an unconscious but breathing person" },
  { short: "Pressure dressing", full: "applying a pressure dressing to a bleeding forearm" },
  { short: "CPR hand placement", full: "hand placement for adult CPR chest compressions" },
  { short: "Splint a forearm", full: "immobilizing a forearm with a splint and a sling" },
];

export function IllustrateTool() {
  const { phase, stage, progress, output, telemetry, evidence, error, run, ready } = useToolRun();
  const [prompt, setPrompt] = useState("");
  const result = output?.tool === "illustrate" ? output : null;

  return (
    <ToolLayout
      title="Illustrate a step"
      blurb="Generate a simple instructional first-aid diagram on-device. An illustrative teaching aid only — a simplified drawing, not a real photo, medical reference, or diagnosis."
    >
      <div className="space-y-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="Describe the first-aid step to illustrate…"
          className="w-full resize-y rounded-xl border border-hairline bg-surface px-3 py-2.5 text-sm leading-relaxed text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2"
        />
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.short}
              type="button"
              onClick={() => setPrompt(p.full)}
              className="rounded-full border border-hairline px-2.5 py-1 text-xs text-fg-muted transition-colors hover:bg-raised"
            >
              {p.short}
            </button>
          ))}
        </div>
        <Button variant="primary" onClick={() => run({ tool: "illustrate", params: { prompt } })} loading={phase === "running"} disabled={!prompt.trim() || !ready}>
          <Sparkles className="h-4 w-4" aria-hidden /> {phase === "done" ? "Generate again" : "Generate illustration"}
        </Button>

        {phase === "running" && <ProgressBar value={progress} label={stage || "Generating on-device…"} />}
        {phase === "error" && error && <ErrorBar message={error} />}
        {result && (
          <OutputCard title="Illustration">
            <img src={result.dataUrl} alt={result.prompt} className="mx-auto max-h-[420px] rounded-lg border border-hairline" />
            <div className="mt-2 flex justify-end">
              <a href={result.dataUrl} download="first-aid-illustration.png" className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
                <Download className="h-3.5 w-3.5" aria-hidden /> Download
              </a>
            </div>
          </OutputCard>
        )}
        <DisclaimerNote>
          Illustrative teaching aid generated on-device — a simplified diagram, not a real photo, medical reference, or diagnosis.
          Follow the manual for exact technique.
        </DisclaimerNote>
        {phase === "done" && <ToolFooter telemetry={telemetry} evidence={evidence} />}
      </div>
    </ToolLayout>
  );
}
