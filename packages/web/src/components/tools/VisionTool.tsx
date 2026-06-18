/** Image analysis — photo → observed findings (multimodal), grounded and cautious. */
import { useState } from "react";

import { Eye, X } from "lucide-react";

import type { UploadResult } from "../../lib/api";
import { Button } from "../ui/Button";
import { DelegateToggle, DisclaimerNote, ErrorBar, ImagePicker, OutputCard, RunningBar } from "../workspace/ToolBits";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";
import { useToolRun } from "../workspace/useToolRun";

export function VisionTool() {
  const { phase, stream, output, telemetry, evidence, error, run, reset, ready } = useToolRun();
  const [up, setUp] = useState<UploadResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [delegate, setDelegate] = useState(false);
  const result = output?.tool === "vision" ? output : null;
  const text = result?.findings ?? stream;

  function clear() {
    if (preview) URL.revokeObjectURL(preview);
    setUp(null);
    setPreview(null);
    reset();
  }

  return (
    <ToolLayout
      title="Analyze a photo"
      blurb="Photograph a wound, rash, or scene; a multimodal model describes the observable findings on-device. Findings are descriptive support for triage — not a diagnosis."
    >
      <div className="space-y-4">
        {!up ? (
          <ImagePicker
            kind="image"
            onReady={(u, p) => {
              setUp(u);
              setPreview(p);
            }}
          />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row">
              {preview && <img src={preview} alt={up.name} className="h-40 w-full rounded-xl border border-hairline bg-base object-contain sm:w-56" />}
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Optional: what should it focus on?"
                  className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    onClick={() => run({ tool: "vision", uploads: [{ role: "image", id: up.id, name: up.name }], params: { prompt }, options: { delegate } })}
                    loading={phase === "running"}
                    disabled={!ready}
                  >
                    <Eye className="h-4 w-4" aria-hidden /> {phase === "done" ? "Analyze again" : "Analyze"}
                  </Button>
                  <DelegateToggle value={delegate} onChange={setDelegate} disabled={phase === "running"} />
                  <Button variant="ghost" onClick={clear} disabled={phase === "running"}>
                    <X className="h-4 w-4" aria-hidden /> Clear
                  </Button>
                </div>
              </div>
            </div>

            {phase === "error" && error && <ErrorBar message={error} />}
            {(phase === "running" || result) &&
              (text ? (
                <OutputCard title="Observed findings">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{text}</p>
                </OutputCard>
              ) : (
                <RunningBar label="Looking at the image on-device…" />
              ))}
            {result?.injection?.detected && (
              <p className="text-2xs text-remote">Text seen in the image looked like an instruction; it was treated as data, not followed.</p>
            )}
            <DisclaimerNote>
              Descriptive support only — not a diagnosis. Confirm against the manual or a clinician before acting.
            </DisclaimerNote>
            {phase === "done" && <ToolFooter telemetry={telemetry} evidence={evidence} />}
          </div>
        )}
      </div>
    </ToolLayout>
  );
}
