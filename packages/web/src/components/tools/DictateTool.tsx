/** Dictate — speak a case note or voice memo and get it transcribed on-device. */
import { useState } from "react";

import { OutputCard, AudioPicker, ErrorBar, RunningBar } from "../workspace/ToolBits";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";
import { useToolRun } from "../workspace/useToolRun";

export function DictateTool() {
  const { phase, output, telemetry, evidence, error, run, ready } = useToolRun();
  const [seconds, setSeconds] = useState<number | undefined>();
  const result = output?.tool === "dictate" ? output : null;

  return (
    <ToolLayout
      title="Dictate a note"
      blurb="Record a case note or voice memo and have it transcribed on-device — hands-free capture when you can't type. Nothing leaves the device."
    >
      <div className="space-y-3">
        <AudioPicker
          onReady={(up, secs) => {
            setSeconds(secs);
            if (ready) run({ tool: "dictate", uploads: [{ role: "audio", id: up.id, name: up.name }] });
          }}
        />
        {seconds != null && <p className="font-mono text-2xs text-fg-faint">captured {seconds.toFixed(1)}s</p>}

        {phase === "running" && <RunningBar label="Transcribing on-device…" />}
        {phase === "error" && error && <ErrorBar message={error} />}
        {result && (
          <OutputCard title="Transcript">
            {result.text ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{result.text}</p>
            ) : (
              <p className="text-sm text-fg-muted">No speech recognised — try recording closer to the mic.</p>
            )}
          </OutputCard>
        )}
        {phase === "done" && <ToolFooter telemetry={telemetry} evidence={evidence} />}
      </div>
    </ToolLayout>
  );
}
