/**
 * toolRunner.ts — runs a standalone capability ("tool") and streams the
 * consistent ServerEvents the workspace renders: tool_accepted → stage(s) →
 * telemetry → done | error. The sibling of the conversation orchestrator for
 * capabilities a medic reaches for on their own (read a label, …).
 *
 * Like a turn, a tool run is serialized (it goes through `tracked()` in main.ts)
 * and only ever touches the SDK through @lifeline/core — it never imports
 * @qvac/sdk and never tears down the warm conversation slot (each core helper
 * loads and unloads its own transient model on the shared worker).
 */
import { collectSysInfo, detectInjection, extractText, RunLogger } from "@lifeline/core";

import type { ServerEvent, ToolRunRequest } from "./protocol";
import { getFile } from "./uploads";

export type Emit = (ev: ServerEvent) => void;

/** Dispatch a tool run to its handler. Throws on unknown tools or bad input. */
export async function runTool(req: ToolRunRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  switch (req.tool) {
    case "ocr":
      return runOcr(req, emit, signal);
    default:
      throw new Error(`Unknown tool: ${String((req as { tool: string }).tool)}`);
  }
}

/** Read printed/handwritten text from a photographed label, note, or sheet — on-device. */
async function runOcr(req: ToolRunRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  const runId = req.runId;
  const upload = req.uploads?.find((u) => u.role === "image");
  const file = upload ? getFile(upload.id) : undefined;
  if (!file) throw new Error("Attach a photo of the label or note to read.");

  const logger = new RunLogger();
  logger.session("ui (read tool)", collectSysInfo());

  emit({ type: "tool_stage", runId, stage: "ocr", status: "start", detail: file.name });
  const r = await extractText(file.path);
  if (signal.aborted) return;

  // Photographed text is untrusted (a label could carry a planted instruction).
  // It's surfaced read-only here, but scanned and flagged so the medic knows.
  const inj = detectInjection(r.text);
  logger.injectionGuard({ source: "ocr", detected: inj.detected, patterns: inj.patterns, action: inj.detected ? "flagged" : "scanned" });
  logger.ocr({ model: r.model, image: file.name, block_count: r.block_count, text_chars: r.text.length, ocr_ms: r.ocr_ms });

  emit({ type: "tool_stage", runId, stage: "ocr", status: "done", ms: r.ocr_ms, detail: `${r.block_count} block(s)` });
  emit({
    type: "tool_telemetry",
    runId,
    telemetry: {
      servedBy: "local",
      metrics: [
        { label: "model", value: "OCR Latin", hint: r.model },
        { label: "blocks", value: String(r.block_count), hint: "Text regions the recognizer found." },
        { label: "chars", value: String(r.text.length), hint: "Characters of text extracted." },
        { label: "ocr", value: `${r.ocr_ms}ms`, hint: "On-device recognition time (measured wall-clock)." },
      ],
    },
  });
  emit({
    type: "tool_done",
    runId,
    output: {
      tool: "ocr",
      text: r.text,
      blocks: r.blocks,
      injection: inj.detected ? { detected: true, patterns: inj.patterns } : undefined,
    },
    evidence: logger.path,
  });
}
