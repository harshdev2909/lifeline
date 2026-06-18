/**
 * Classify — a rapid screening aid, two honest modes:
 *  - Capture triage: the bundled on-device classifier (real confidence) decides
 *    whether a photo is a document/label (→ route to Read text), food, or other.
 *  - Medical screening: the multimodal model constrained to a fixed label set
 *    (burn severity, wound type…). A descriptive screening label, never a
 *    diagnosis, with no fabricated probability.
 */
import { useState } from "react";

import { ScanSearch, X } from "lucide-react";

import type { UploadResult } from "../../lib/api";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { DelegateToggle, DisclaimerNote, ErrorBar, ImagePicker, OutputCard, RunningBar } from "../workspace/ToolBits";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";
import { useToolRun } from "../workspace/useToolRun";

type Mode = "triage" | "screen";
const LABEL_SETS = [
  { id: "burn", label: "Burn severity" },
  { id: "wound", label: "Wound type" },
  { id: "rash", label: "Skin finding" },
];

export function ClassifyTool() {
  const { phase, output, telemetry, evidence, error, run, reset, ready } = useToolRun();
  const [mode, setMode] = useState<Mode>("triage");
  const [labelSet, setLabelSet] = useState("burn");
  const [delegate, setDelegate] = useState(false);
  const [up, setUp] = useState<UploadResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const result = output?.tool === "classify" ? output : null;

  function clear() {
    if (preview) URL.revokeObjectURL(preview);
    setUp(null);
    setPreview(null);
    reset();
  }

  function go() {
    if (!up || !ready) return;
    run({
      tool: "classify",
      uploads: [{ role: "image", id: up.id, name: up.name }],
      params: { mode, labelSet },
      options: { delegate },
    });
  }

  return (
    <ToolLayout
      title="Screening aid"
      blurb="A fast classification aid. Capture-triage routes a photographed document to the reader; medical screening assigns a cautious category from a fixed label set. Screening is support for triage — never a diagnosis."
    >
      <div className="space-y-4">
        <div className="inline-flex overflow-hidden rounded-lg border border-hairline" role="group" aria-label="Mode">
          {(["triage", "screen"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cn("px-3 py-1.5 text-xs transition-colors", mode === m ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-raised")}
            >
              {m === "triage" ? "Capture triage" : "Medical screening"}
            </button>
          ))}
        </div>

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
                {mode === "screen" && (
                  <select
                    value={labelSet}
                    onChange={(e) => setLabelSet(e.target.value)}
                    className="rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-sm text-fg focus-visible:outline focus-visible:outline-2"
                    aria-label="Screening label set"
                  >
                    {LABEL_SETS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={go} loading={phase === "running"} disabled={!ready}>
                    <ScanSearch className="h-4 w-4" aria-hidden /> {phase === "done" ? "Screen again" : "Screen"}
                  </Button>
                  {mode === "screen" && <DelegateToggle value={delegate} onChange={setDelegate} disabled={phase === "running"} />}
                  <Button variant="ghost" onClick={clear} disabled={phase === "running"}>
                    <X className="h-4 w-4" aria-hidden /> Clear
                  </Button>
                </div>
              </div>
            </div>

            {phase === "running" && <RunningBar label={mode === "triage" ? "Classifying on-device…" : "Screening on-device…"} />}
            {phase === "error" && error && <ErrorBar message={error} />}

            {result && result.mode === "triage" && (
              <OutputCard title="Classification">
                <div className="space-y-2">
                  {result.results.map((r, i) => (
                    <div key={i}>
                      <div className="mb-0.5 flex items-center justify-between text-xs">
                        <span className="text-fg">{r.label}</span>
                        <span className="font-mono text-2xs text-fg-muted">{r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : "—"}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((r.confidence ?? 0) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                {result.note && <p className="mt-3 text-xs text-local">{result.note}</p>}
              </OutputCard>
            )}

            {result && result.mode === "screen" && (
              <OutputCard title="Screening assessment">
                <div className="text-base font-medium text-fg">{result.results[0]?.label ?? "unclear"}</div>
                {result.reason && <p className="mt-1 text-sm leading-relaxed text-fg-muted">{result.reason}</p>}
              </OutputCard>
            )}

            {mode === "screen" && (
              <DisclaimerNote>
                Screening support from a general vision model constrained to a fixed label set — not a calibrated probability and not a
                diagnosis. Confirm against the manual or a clinician.
              </DisclaimerNote>
            )}
            {phase === "done" && <ToolFooter telemetry={telemetry} evidence={evidence} />}
          </div>
        )}
      </div>
    </ToolLayout>
  );
}
