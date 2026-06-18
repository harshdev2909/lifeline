/** Corpus manager — ingest the field manual and inspect its chunks/sources. */
import { Database, Layers } from "lucide-react";

import { Button } from "../ui/Button";
import { ErrorBar, RunningBar } from "../workspace/ToolBits";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";
import { useToolRun } from "../workspace/useToolRun";

export function CorpusTool() {
  const { phase, stage, output, telemetry, evidence, error, run, ready } = useToolRun();
  const result = output?.tool === "corpus" ? output : null;

  return (
    <ToolLayout
      title="Knowledge base"
      blurb="See what grounds the answers. Re-index the field manual on-device and inspect every chunk, its source, and section — the same passages retrieval draws on."
    >
      <div className="space-y-3">
        <Button variant="primary" onClick={() => run({ tool: "corpus" })} loading={phase === "running"} disabled={!ready}>
          <Database className="h-4 w-4" aria-hidden /> Re-index the manual
        </Button>

        {phase === "running" && <RunningBar label={stage || "Embedding the manual…"} />}
        {phase === "error" && error && <ErrorBar message={error} />}

        {result && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-hairline bg-surface px-4 py-3 font-mono text-2xs text-fg-muted">
              <span>
                <span className="text-fg-faint">docs </span>
                <span className="text-fg">{result.docCount}</span>
              </span>
              <span>
                <span className="text-fg-faint">chunks </span>
                <span className="text-fg">{result.chunkCount}</span>
              </span>
              <span>
                <span className="text-fg-faint">embed </span>
                <span className="text-fg">{result.embedModel}</span>
              </span>
            </div>
            <div className="space-y-1.5">
              {result.chunks.map((c, i) => (
                <div key={i} className="rounded-lg border border-hairline bg-surface px-3 py-2">
                  <div className="mb-0.5 flex items-center gap-1.5 text-2xs text-fg-faint">
                    <Layers className="h-3 w-3" aria-hidden />
                    {c.source} · {c.section}
                  </div>
                  <p className="text-xs leading-relaxed text-fg-muted">{c.snippet}…</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {phase === "done" && <ToolFooter telemetry={telemetry} evidence={evidence} />}
      </div>
    </ToolLayout>
  );
}
