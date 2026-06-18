/** Clinical note — case notes → SOAP summary (clinician) or plain-language explainer (patient). */
import { useState } from "react";

import { FileText } from "lucide-react";

import { Button } from "../ui/Button";
import { DelegateToggle, DisclaimerNote, ErrorBar, OutputCard, RunningBar, SegmentedControl } from "../workspace/ToolBits";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";
import { useToolRun } from "../workspace/useToolRun";

type Audience = "clinician" | "patient";

export function SoapTool() {
  const { phase, stream, output, telemetry, evidence, error, run, ready } = useToolRun();
  const [notes, setNotes] = useState("");
  const [audience, setAudience] = useState<Audience>("clinician");
  const [delegate, setDelegate] = useState(false);
  const result = output?.tool === "soap" ? output : null;
  const text = result?.text ?? stream;

  return (
    <ToolLayout
      title="Clinical note"
      blurb="Turn rough case notes into a structured SOAP summary, or a plain-language explainer for the patient — generated on-device from only what you wrote."
    >
      <div className="space-y-3">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          placeholder="Jot the case: who, what happened, vitals, what you observed and did…"
          className="w-full resize-y rounded-xl border border-hairline bg-surface px-3 py-2.5 text-sm leading-relaxed text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2"
        />
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            ariaLabel="Output style"
            value={audience}
            onChange={(v) => setAudience(v as Audience)}
            disabled={phase === "running"}
            options={[
              { value: "clinician", label: "SOAP note" },
              { value: "patient", label: "For the patient" },
            ]}
          />
          <Button variant="primary" onClick={() => run({ tool: "soap", params: { text: notes, audience }, options: { delegate } })} loading={phase === "running"} disabled={!notes.trim() || !ready}>
            <FileText className="h-4 w-4" aria-hidden /> {phase === "done" ? "Regenerate" : "Generate"}
          </Button>
          <DelegateToggle value={delegate} onChange={setDelegate} disabled={phase === "running"} />
        </div>

        {phase === "error" && error && <ErrorBar message={error} />}
        {(phase === "running" || result) &&
          (text ? (
            <OutputCard title={audience === "clinician" ? "SOAP note" : "Plain-language explainer"}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{text}</p>
            </OutputCard>
          ) : (
            <RunningBar label="Writing on-device…" />
          ))}
        <DisclaimerNote>Decision support drafted from your notes only — not a diagnosis. Review before it informs care.</DisclaimerNote>
        {phase === "done" && <ToolFooter telemetry={telemetry} evidence={evidence} />}
      </div>
    </ToolLayout>
  );
}
