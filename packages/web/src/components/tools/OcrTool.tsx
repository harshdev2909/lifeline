/**
 * OcrTool — "Read a label or note". Photograph a medication label, handwritten
 * note, or printed sheet; Lifeline recognises the text on-device. The recognised
 * text is treated as untrusted data (a label could carry a planted instruction),
 * so it's surfaced read-only and flagged if it looks like an instruction.
 *
 * Built from the shared tool vocabulary — ImagePicker → run → OutputCard → mono
 * telemetry strip → on-device evidence — so it reads the same as every tool.
 */
import { useState } from "react";

import { ScanText, ShieldCheck, X } from "lucide-react";

import type { UploadResult } from "../../lib/api";
import type { ToolOutput } from "../../lib/protocol";
import { Button } from "../ui/Button";
import { ErrorBar, ImagePicker, NoticeBar, OutputCard, RunningBar } from "../workspace/ToolBits";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";
import { useToolRun } from "../workspace/useToolRun";

type OcrOut = Extract<ToolOutput, { tool: "ocr" }>;

export function OcrTool() {
  const { phase, output, telemetry, evidence, error, run, reset, ready } = useToolRun();
  const [up, setUp] = useState<UploadResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const result = output?.tool === "ocr" ? output : null;

  function clear() {
    if (preview) URL.revokeObjectURL(preview);
    setUp(null);
    setPreview(null);
    reset();
  }

  return (
    <ToolLayout
      title="Read a label or note"
      blurb="Photograph a medication label, handwritten note, or printed sheet — Lifeline reads the text on-device, even with the network off. The extracted text is treated as untrusted data and never run as an instruction."
    >
      {!up ? (
        <ImagePicker
          kind="ocr"
          title="Add a photo of a label or note"
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
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  onClick={() => run({ tool: "ocr", uploads: [{ role: "image", id: up.id, name: up.name }] })}
                  loading={phase === "running"}
                  disabled={!ready}
                >
                  <ScanText className="h-4 w-4" aria-hidden /> {phase === "done" ? "Read again" : "Read text"}
                </Button>
                <Button variant="ghost" onClick={clear} disabled={phase === "running"}>
                  <X className="h-4 w-4" aria-hidden /> Clear
                </Button>
              </div>
            </div>
          </div>

          {phase === "running" && <RunningBar label="Reading the image on-device…" />}
          {phase === "error" && error && <ErrorBar message={error} />}
          {result && <OcrResult out={result} />}
          {phase === "done" && <ToolFooter telemetry={telemetry} evidence={evidence} />}
        </div>
      )}
    </ToolLayout>
  );
}

function OcrResult({ out }: { out: OcrOut }) {
  return (
    <div className="space-y-3">
      {out.injection?.detected && (
        <NoticeBar icon={ShieldCheck}>
          This text contained instruction-like patterns ({out.injection.patterns.join(", ")}). It's shown as data only and was not
          acted on.
        </NoticeBar>
      )}
      <OutputCard title="Recognised text">
        {out.text ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{out.text}</p>
        ) : (
          <p className="text-sm text-fg-muted">No readable text found. Try a sharper, better-lit photo, straight-on to the label.</p>
        )}
      </OutputCard>
    </div>
  );
}
