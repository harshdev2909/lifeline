/** Search — semantic search across the loaded manual (local embeddings + vector search). */
import { useState } from "react";

import { Search } from "lucide-react";

import { Button } from "../ui/Button";
import { ErrorBar, RunningBar } from "../workspace/ToolBits";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";
import { useToolRun } from "../workspace/useToolRun";

export function SearchTool() {
  const { phase, stage, output, telemetry, evidence, error, run, ready } = useToolRun();
  const [query, setQuery] = useState("");
  const result = output?.tool === "search" ? output : null;

  function go() {
    if (query.trim() && ready) run({ tool: "search", params: { query, topK: 5 } });
  }

  return (
    <ToolLayout
      title="Search the manual"
      blurb="Find the right passage by meaning, not keywords. Embeddings and vector search run on-device; results show their source, section, and similarity score."
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="e.g. how to treat a deep bleeding wound"
            className="min-w-0 flex-1 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2"
          />
          <Button variant="primary" onClick={go} loading={phase === "running"} disabled={!query.trim() || !ready}>
            <Search className="h-4 w-4" aria-hidden /> Search
          </Button>
        </div>

        {phase === "running" && <RunningBar label={stage || "Searching the manual…"} />}
        {phase === "error" && error && <ErrorBar message={error} />}

        {result && (
          <div className="space-y-2">
            {result.hits.length === 0 ? (
              <div className="rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-fg-muted">No passages matched.</div>
            ) : (
              result.hits.map((h, i) => (
                <div key={i} className="rounded-xl border border-hairline bg-surface px-4 py-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-fg">
                      {h.source} <span className="text-fg-faint">· {h.section}</span>
                    </span>
                    <span className="shrink-0 font-mono text-2xs text-accent">{h.score.toFixed(2)}</span>
                  </div>
                  <p className="text-sm leading-relaxed text-fg-muted">{h.snippet}…</p>
                </div>
              ))
            )}
          </div>
        )}
        {phase === "done" && <ToolFooter telemetry={telemetry} evidence={evidence} />}
      </div>
    </ToolLayout>
  );
}
