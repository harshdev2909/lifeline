/**
 * Adapt — train a small LoRA adapter on a local first-aid protocol set, run the
 * built-in frozen eval, and see it at inference: the same prompt answered by the
 * base model and by the adapter. The eval is shown BEFORE the adapter is relied
 * on. Contained on laptop hardware (Qwen3-0.6B, short context); real numbers,
 * stated honestly however they land.
 */
import { useState } from "react";

import { GraduationCap } from "lucide-react";

import { Button } from "../ui/Button";
import { DisclaimerNote, ErrorBar, OutputCard, ProgressBar, SegmentedControl } from "../workspace/ToolBits";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";
import { useToolRun } from "../workspace/useToolRun";

export function AdaptTool() {
  const { phase, stage, output, telemetry, evidence, error, run, ready } = useToolRun();
  const [epochs, setEpochs] = useState(2);
  const result = output?.tool === "adapt" ? output : null;

  return (
    <ToolLayout
      title="Adapt the model"
      blurb="Fine-tune a small LoRA adapter on a built-in first-aid protocol set, run a frozen eval, then see the adapter at inference — the same question answered before and after. A contained, real run on this device."
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-fg-muted">
          Trains on a built-in set of short, protocol-faithful first-aid examples (Qwen3-0.6B Instruct). Held-out examples drive
          the validation loss — the frozen eval you check before trusting the adapter.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-muted">Epochs</span>
          <SegmentedControl
            ariaLabel="Epochs"
            value={String(epochs)}
            onChange={(v) => setEpochs(Number(v))}
            disabled={phase === "running"}
            options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
          />
          <Button variant="primary" onClick={() => run({ tool: "adapt", params: { epochs } })} loading={phase === "running"} disabled={!ready}>
            <GraduationCap className="h-4 w-4" aria-hidden /> {phase === "done" ? "Train again" : "Train adapter"}
          </Button>
        </div>

        {phase === "running" && <ProgressBar value={undefined} label={stage || "Training on-device…"} />}
        {phase === "error" && error && <ErrorBar message={error} />}

        {result && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-hairline bg-surface px-4 py-3 font-mono text-2xs text-fg-muted">
              <Stat k="status" v={result.status} />
              <Stat k="train loss" v={result.trainLoss != null ? result.trainLoss.toFixed(3) : "—"} />
              <Stat k="val loss" v={result.valLoss != null ? result.valLoss.toFixed(3) : "—"} />
              {result.valAccuracy != null && <Stat k="val acc" v={result.valAccuracy.toFixed(3)} />}
              <Stat k="steps" v={String(result.steps)} />
            </div>

            <p className="text-2xs text-fg-faint">Test prompt: “{result.testPrompt}”</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <OutputCard title="Base model">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{result.baseAnswer || "—"}</p>
              </OutputCard>
              <OutputCard title="With adapter">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{result.adaptedAnswer || "—"}</p>
              </OutputCard>
            </div>
            {result.adapterPath && <p className="truncate font-mono text-2xs text-fg-faint">adapter: {result.adapterPath}</p>}
          </div>
        )}

        <DisclaimerNote>
          A contained demonstration run on a tiny dataset — the adapter shifts the model's house style, not its medical knowledge.
          The validation loss is the frozen eval to check before relying on any adapter.
        </DisclaimerNote>
        {phase === "done" && <ToolFooter telemetry={telemetry} evidence={evidence} />}
      </div>
    </ToolLayout>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <span>
      <span className="text-fg-faint">{k} </span>
      <span className="text-fg">{v}</span>
    </span>
  );
}
