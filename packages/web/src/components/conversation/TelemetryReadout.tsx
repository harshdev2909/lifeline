import { Tooltip } from "../ui/Tooltip";
import { int, ms, toks } from "../../lib/format";
import type { TurnTelemetry } from "../../lib/protocol";

/**
 * The per-turn instrument readout — every number in Geist Mono with tabular
 * figures. Values are real: TTFT and tokens/sec come from the SDK when it
 * reports them (labelled), otherwise from our wall-clock. Reasoning time is
 * shown separately from time-to-first-answer for chain-of-thought models.
 */
export function TelemetryReadout({ t }: { t: TurnTelemetry }) {
  const source = t.statsSource === "sdk" ? "SDK-reported" : "measured (wall-clock)";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-fg-muted">
      <Metric label="TTFT" value={`${ms(t.ttftMs)}ms`} hint={`Time to first token — ${source}.`} />
      {t.ttftContentMs != null && t.thinkingMs ? (
        <Metric label="reason" value={`${ms(t.thinkingMs)}ms`} hint="Time spent reasoning before the answer began (kept out of the answer)." />
      ) : null}
      <Metric label="tok/s" value={toks(t.tokensPerSec)} hint={`Throughput — ${source}.`} />
      <Metric label="out" value={`${int(t.completionTokens)} tok`} hint="Answer tokens generated." />
      {t.promptTokens != null && <Metric label="in" value={`${int(t.promptTokens)} tok`} hint="Prompt tokens (SDK-reported)." />}
      <Metric label="load" value={`${ms(t.loadMs)}ms`} hint="Model load time (measured)." />
      {t.backendDevice && <Metric label="backend" value={t.backendDevice} hint="Compute backend reported by the SDK for this inference." />}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Tooltip content={<span className="font-sans text-xs">{hint}</span>}>
      <span className="inline-flex items-baseline gap-1 cursor-default">
        <span className="text-fg-faint">{label}</span>
        <span className="text-fg">{value}</span>
      </span>
    </Tooltip>
  );
}
