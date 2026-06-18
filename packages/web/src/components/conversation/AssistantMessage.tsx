import { motion } from "framer-motion";
import { AlertCircle, FileClock, ShieldCheck, Volume2 } from "lucide-react";

import { LogoMark } from "../brand/Logo";
import { AnswerText } from "./CitationChip";
import { EmergencyBanner, RefusalBlock } from "./SafetyBanner";
import { ReasoningAside } from "./ReasoningAside";
import { ServedByBadge } from "./ServedByBadge";
import { SourcesList } from "./SourcesList";
import { StageTrail } from "./StageTrail";
import { TelemetryReadout } from "./TelemetryReadout";
import { Tooltip } from "../ui/Tooltip";
import type { AssistantMsg } from "../../state/types";

export function AssistantMessage({ a }: { a: AssistantMsg }) {
  const streaming = a.status === "streaming" || a.status === "pending";
  const working = streaming && !a.answer && a.status !== "refused";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="flex gap-3"
    >
      <div className="mt-0.5 shrink-0 text-fg-muted">
        <LogoMark size={22} />
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        {/* Where it ran + guards. */}
        <div className="flex flex-wrap items-center gap-2">
          {a.servedBy && <ServedByBadge served={a.servedBy} />}
          {a.injections.length > 0 && (
            <Tooltip content={<span>Untrusted text from {a.injections.map((i) => i.source).join(", ")} was fenced as data; planted instructions ({a.injections.flatMap((i) => i.patterns).join(", ")}) were ignored.</span>}>
              <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-raised px-2 py-0.5 text-2xs text-fg-muted">
                <ShieldCheck className="h-3 w-3" aria-hidden /> injection fenced
              </span>
            </Tooltip>
          )}
        </div>

        {/* Emergency lead, surfaced first. */}
        {a.emergency && a.safety && <EmergencyBanner notice={a.emergency} terms={a.safety.terms} />}

        {/* Working state: the live on-device pipeline. */}
        {working && (
          <div className="space-y-3 rounded-xl border border-hairline bg-surface px-4 py-3">
            <StageTrail stages={a.stages} />
            {(a.thinking || a.thinkingActive) && <ReasoningAside text={a.thinking} active={a.thinkingActive} durationMs={a.thinkingMs} />}
          </div>
        )}

        {/* Reasoning aside (after content has started). */}
        {!working && (a.thinking || a.thinkingActive) && (
          <ReasoningAside text={a.thinking} active={a.thinkingActive} durationMs={a.thinkingMs} />
        )}

        {/* Refusal treatment (shown once, in place of an answer). */}
        {a.status === "refused" && a.refusal && <RefusalBlock text={a.refusal} />}

        {/* The answer. */}
        {a.answer && a.status !== "refused" && (
          <div className="text-[0.95rem] leading-[1.65] text-fg">
            <AnswerText text={a.answer} sources={a.citations?.sources} streaming={streaming} />
          </div>
        )}

        {/* Localized answer. */}
        {a.localized && (
          <div className="rounded-lg border border-hairline bg-raised px-3 py-2.5">
            <div className="mb-1 font-mono text-2xs uppercase tracking-wide text-fg-faint">{a.localized.lang}</div>
            <p className="whitespace-pre-wrap text-[0.95rem] leading-[1.6] text-fg">{a.localized.text}</p>
          </div>
        )}

        {/* Spoken answer. */}
        {a.audioUrl && (
          <div className="flex items-center gap-2 rounded-lg border border-hairline bg-raised px-3 py-2">
            <Volume2 className="h-4 w-4 text-accent" aria-hidden />
            <audio controls src={a.audioUrl} className="h-8 w-full max-w-xs" aria-label="Spoken answer" />
          </div>
        )}

        {/* Sources. */}
        {a.citations && a.citations.sources.length > 0 && (
          <SourcesList sources={a.citations.sources} cited={a.citations.cited} hallucinated={a.citations.hallucinated} />
        )}

        {/* Error. */}
        {a.status === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-emergency-line bg-emergency-soft px-3 py-2 text-sm text-emergency">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{a.error}</span>
          </div>
        )}

        {/* Instrument footer: telemetry + evidence. */}
        {(a.telemetry || a.evidence) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2.5">
            {a.telemetry ? <TelemetryReadout t={a.telemetry} /> : <span />}
            {a.evidence && (
              <Tooltip content={<span className="font-sans text-xs">Auditable JSONL evidence for this turn was written on-device.</span>}>
                <span className="inline-flex items-center gap-1 font-mono text-2xs text-fg-faint">
                  <FileClock className="h-3 w-3" aria-hidden />
                  {a.evidence.split("/").pop()}
                </span>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
