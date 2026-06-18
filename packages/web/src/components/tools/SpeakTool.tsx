/** Speak — read guidance aloud with on-device text-to-speech. */
import { useState } from "react";

import { Volume2 } from "lucide-react";

import { Button } from "../ui/Button";
import { ErrorBar, OutputCard, RunningBar } from "../workspace/ToolBits";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";
import { useToolRun } from "../workspace/useToolRun";

export function SpeakTool() {
  const { phase, output, telemetry, evidence, error, run, ready } = useToolRun();
  const [text, setText] = useState("");
  const result = output?.tool === "speak" ? output : null;

  return (
    <ToolLayout
      title="Read aloud"
      blurb="Turn written guidance into speech on-device — useful hands-free, or for someone who can't read the screen. Audio is generated locally and played back here."
    >
      <div className="space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Paste the guidance to read aloud…"
          className="w-full resize-y rounded-xl border border-hairline bg-surface px-3 py-2.5 text-sm leading-relaxed text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2"
        />
        <Button variant="primary" onClick={() => run({ tool: "speak", params: { text } })} loading={phase === "running"} disabled={!text.trim() || !ready}>
          <Volume2 className="h-4 w-4" aria-hidden /> Read aloud
        </Button>

        {phase === "running" && <RunningBar label="Synthesizing speech on-device…" />}
        {phase === "error" && error && <ErrorBar message={error} />}
        {result && (
          <OutputCard title="Spoken guidance">
            <audio controls autoPlay src={result.audioUrl} className="h-9 w-full" aria-label="Spoken guidance" />
          </OutputCard>
        )}
        {phase === "done" && <ToolFooter telemetry={telemetry} evidence={evidence} />}
      </div>
    </ToolLayout>
  );
}
