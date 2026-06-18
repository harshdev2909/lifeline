/**
 * OcrTool — "Read a label or note". Photograph a medication label, handwritten
 * note, or printed sheet; Lifeline recognises the text on-device. The recognised
 * text is treated as untrusted data (a label could carry a planted instruction),
 * so it's surfaced read-only and flagged if it looks like an instruction.
 *
 * Demonstrates the shared tool vocabulary end-to-end: input → run → typed output
 * → mono telemetry strip → on-device evidence.
 */
import { useRef, useState } from "react";

import { AlertCircle, FileText, ImageUp, Loader2, ScanText, ShieldAlert, X } from "lucide-react";

import { uploadFile } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { ToolOutput, ToolTelemetry } from "../../lib/protocol";
import { useBridge } from "../../state/bridge";
import { Button } from "../ui/Button";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";

type OcrOut = Extract<ToolOutput, { tool: "ocr" }>;
type Phase = "empty" | "ready" | "running" | "done" | "error";

export function OcrTool() {
  const { runTool, status } = useBridge();
  const [phase, setPhase] = useState<Phase>("empty");
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [out, setOut] = useState<OcrOut | null>(null);
  const [tel, setTel] = useState<ToolTelemetry | undefined>();
  const [evidence, setEvidence] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

  function resetResult() {
    setOut(null);
    setTel(undefined);
    setEvidence(undefined);
    setError(undefined);
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    resetResult();
    setFileName(file.name);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setUploadId(null);
    setPhase("ready");
    try {
      const up = await uploadFile("ocr", file, file.name);
      setUploadId(up.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  function run() {
    if (!uploadId || status !== "open") return;
    resetResult();
    setPhase("running");
    setStage("Loading the recognizer…");
    runTool({ tool: "ocr", uploads: [{ role: "image", id: uploadId }] }, (ev) => {
      if (ev.type === "tool_stage") setStage(ev.status === "done" ? "Reading…" : "Reading the image on-device…");
      else if (ev.type === "tool_telemetry") setTel(ev.telemetry);
      else if (ev.type === "tool_done") {
        setOut(ev.output as OcrOut);
        setEvidence(ev.evidence);
        setPhase("done");
      } else if (ev.type === "tool_error") {
        setError(ev.message);
        setPhase("error");
      }
    });
  }

  function clear() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFileName("");
    setUploadId(null);
    resetResult();
    setPhase("empty");
  }

  return (
    <ToolLayout
      title="Read a label or note"
      blurb="Photograph a medication label, handwritten note, or printed sheet — Lifeline reads the text on-device, even with the network off. The extracted text is treated as untrusted data and never run as an instruction."
    >
      {phase === "empty" ? (
        <Dropzone onPick={() => inputRef.current?.click()} onDrop={(f) => void choose(f)} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            {preview && (
              <img
                src={preview}
                alt={fileName || "Selected image"}
                className="h-40 w-full rounded-xl border border-hairline object-contain bg-base sm:w-56"
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-fg-muted">
                <ImageUp className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden />
                <span className="truncate">{fileName}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={run} loading={phase === "running"} disabled={!uploadId || status !== "open"}>
                  <ScanText className="h-4 w-4" aria-hidden />
                  {phase === "done" ? "Read again" : "Read text"}
                </Button>
                <Button variant="ghost" onClick={clear} disabled={phase === "running"}>
                  <X className="h-4 w-4" aria-hidden /> Clear
                </Button>
              </div>
              {status !== "open" && <p className="text-2xs text-fg-faint">Waiting for the local bridge…</p>}
            </div>
          </div>

          {phase === "running" && (
            <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
              {stage}
            </div>
          )}

          {phase === "error" && error && (
            <div className="flex items-start gap-2 rounded-lg border border-emergency-line bg-emergency-soft px-3 py-2 text-sm text-emergency">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          {phase === "done" && out && <OcrResult out={out} />}

          {phase === "done" && <ToolFooter telemetry={tel} evidence={evidence} />}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="hidden"
        onChange={(e) => void choose(e.target.files?.[0])}
      />
    </ToolLayout>
  );
}

function OcrResult({ out }: { out: OcrOut }) {
  return (
    <div className="space-y-3">
      {out.injection?.detected && (
        <div className="flex items-start gap-2 rounded-lg border border-remote-line bg-remote-soft px-3 py-2 text-sm text-remote">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            This text contained instruction-like patterns ({out.injection.patterns.join(", ")}). It's shown as data only and was
            not acted on.
          </span>
        </div>
      )}
      {out.text ? (
        <div className="rounded-xl border border-hairline bg-surface">
          <div className="flex items-center gap-2 border-b border-hairline px-4 py-2 text-2xs uppercase tracking-wide text-fg-faint">
            <FileText className="h-3.5 w-3.5" aria-hidden /> Recognised text
          </div>
          <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-fg">{out.text}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-fg-muted">
          No readable text found. Try a sharper, better-lit photo, straight-on to the label.
        </div>
      )}
    </div>
  );
}

function Dropzone({ onPick, onDrop }: { onPick: () => void; onDrop: (f: File | undefined) => void }) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={onPick}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop(e.dataTransfer.files?.[0]);
      }}
      className={cn(
        "flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        over ? "border-accent-line bg-accent-soft" : "border-hairline-strong bg-surface hover:bg-raised",
      )}
    >
      <ImageUp className={cn("h-8 w-8", over ? "text-accent" : "text-fg-faint")} aria-hidden />
      <div>
        <div className="text-sm font-medium text-fg">Add a photo of a label or note</div>
        <div className="mt-1 text-xs text-fg-muted">Click to choose, or drop an image here · PNG or JPEG</div>
      </div>
    </button>
  );
}
