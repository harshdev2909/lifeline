import { Cpu, FileClock, Radio } from "lucide-react";

import type { ToolTelemetry as TT } from "../../lib/protocol";
import { Tooltip } from "../ui/Tooltip";

/**
 * The shared instrument footer for a capability run: a mono telemetry strip (the
 * tool's own real metrics) on the left, the on-device evidence file on the right
 * — the same vocabulary the conversation uses, so every tool reads identically.
 */
export function ToolFooter({ telemetry, evidence }: { telemetry?: TT; evidence?: string }) {
  if (!telemetry && !evidence) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2.5">
      {telemetry ? <ToolTelemetry t={telemetry} /> : <span />}
      {evidence && (
        <Tooltip content={<span className="font-sans text-xs">Auditable JSONL evidence for this run was written on-device.</span>}>
          <span className="inline-flex items-center gap-1 font-mono text-2xs text-fg-faint">
            <FileClock className="h-3 w-3" aria-hidden /> {evidence.split("/").pop()}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

/** The mono metric strip — every readout in Geist Mono, values are real. */
export function ToolTelemetry({ t }: { t: TT }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-fg-muted">
      {t.servedBy && (
        <Tooltip content={<span className="font-sans text-xs">{t.servedBy === "remote" ? "Computed on a mesh peer." : "Computed on this device."}</span>}>
          <span className={`inline-flex items-center gap-1 ${t.servedBy === "remote" ? "text-remote" : "text-local"}`}>
            {t.servedBy === "remote" ? <Radio className="h-3 w-3" aria-hidden /> : <Cpu className="h-3 w-3" aria-hidden />}
            {t.servedBy === "remote" ? "peer" : "on-device"}
          </span>
        </Tooltip>
      )}
      {t.metrics.map((m) => (
        <Tooltip key={m.label} content={<span className="font-sans text-xs">{m.hint ?? m.label}</span>}>
          <span className="inline-flex cursor-default items-baseline gap-1">
            <span className="text-fg-faint">{m.label}</span>
            <span className="text-fg">{m.value}</span>
          </span>
        </Tooltip>
      ))}
      {t.backend && (
        <Tooltip content={<span className="font-sans text-xs">Compute backend reported by the SDK.</span>}>
          <span className="inline-flex items-baseline gap-1">
            <span className="text-fg-faint">backend</span>
            <span className="text-fg">{t.backend}</span>
          </span>
        </Tooltip>
      )}
    </div>
  );
}
