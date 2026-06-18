/**
 * Constrained link — answer over a narrow, lossy channel (the LoRa lesson, in
 * software). The model is asked to answer tersely; the reply is byte-budgeted,
 * split into UTF-8-safe chunks that never break a character, and pushed through a
 * simulated ACK/retry channel. A resilience mode, not the default — the readout
 * shows the link budget, bytes, chunks, and retries.
 */
import { useState } from "react";

import { Check, SignalLow } from "lucide-react";

import { Button } from "../ui/Button";
import { Select } from "../ui/Field";
import { DisclaimerNote, ErrorBar, MetricStrip, NoticeBar, OutputCard, RunningBar } from "../workspace/ToolBits";
import { ToolFooter } from "../workspace/ToolFooter";
import { ToolLayout } from "../workspace/ToolLayout";
import { useToolRun } from "../workspace/useToolRun";

const PROFILES = [
  { value: "200", label: "LoRa-class · 200 B/chunk" },
  { value: "140", label: "SMS-class · 140 B/chunk" },
  { value: "64", label: "Very narrow · 64 B/chunk" },
];
const LOSS = [
  { value: "0.1", label: "10% packet loss" },
  { value: "0.25", label: "25% packet loss" },
  { value: "0.5", label: "50% packet loss" },
];
const LANGS = [
  { value: "", label: "English" },
  { value: "es", label: "Spanish (multibyte)" },
  { value: "fr", label: "French (multibyte)" },
];

export function ConstrainedLinkTool() {
  const { phase, stage, output, telemetry, evidence, error, run, ready } = useToolRun();
  const [question, setQuestion] = useState("");
  const [chunkBytes, setChunkBytes] = useState("200");
  const [loss, setLoss] = useState("0.25");
  const [lang, setLang] = useState("");
  const result = output?.tool === "link" ? output : null;

  return (
    <ToolLayout
      title="Constrained link"
      blurb="Answer over a narrow, lossy channel — terse, byte-budgeted guidance split into chunks that survive a noisy link. A resilience mode, not the default."
    >
      <div className="space-y-3">
        <NoticeBar icon={SignalLow}>
          The assistant answers tersely; the reply is capped to the link budget, split into UTF-8-safe chunks (never mid-character), and retried per chunk against simulated loss.
        </NoticeBar>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="A first-aid question to answer over the narrow link…"
          className="w-full resize-y rounded-xl border border-hairline bg-surface px-3 py-2.5 text-sm leading-relaxed text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select ariaLabel="Link budget" value={chunkBytes} onValueChange={setChunkBytes} options={PROFILES} />
          <Select ariaLabel="Packet loss" value={loss} onValueChange={setLoss} options={LOSS} />
          <Select ariaLabel="Answer language" value={lang} onValueChange={setLang} options={LANGS} />
          <Button
            variant="primary"
            onClick={() => run({ tool: "link", params: { question, chunkBytes: Number(chunkBytes), loss: Number(loss), lang } })}
            loading={phase === "running"}
            disabled={!question.trim() || !ready}
          >
            <SignalLow className="h-4 w-4" aria-hidden /> Send over link
          </Button>
        </div>

        {phase === "running" && <RunningBar label={stage || "Answering on-device…"} />}
        {phase === "error" && error && <ErrorBar message={error} />}

        {result && (
          <div className="space-y-3">
            <MetricStrip
              items={[
                { k: "budget", v: `${result.byteBudget}B` },
                { k: "sent", v: result.truncated ? `${result.sentBytes}B ← ${result.fullBytes}B` : `${result.sentBytes}B` },
                { k: "chunks", v: String(result.chunks) },
                { k: "retries", v: String(result.retries) },
                ...(result.dropped ? [{ k: "dropped", v: String(result.dropped) }] : []),
                { k: "loss", v: `${Math.round(result.loss * 100)}%` },
              ]}
            />
            <OutputCard title={`Reassembled answer${result.lang ? ` · ${LANGS.find((l) => l.value === result.lang)?.label ?? result.lang}` : ""}`}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{result.answer || "—"}</p>
              <p className="mt-2 flex items-center gap-1.5 font-mono text-2xs text-local">
                {result.reassembledOk ? (
                  <>
                    <Check className="h-3 w-3" aria-hidden /> reassembled intact · {result.chunks} chunk{result.chunks > 1 ? "s" : ""} · no codepoint split
                  </>
                ) : (
                  <span className="text-emergency">reassembly mismatch</span>
                )}
              </p>
            </OutputCard>
          </div>
        )}

        <DisclaimerNote>
          Terse triage support over a degraded link — not a diagnosis. Confirm against the manual or a clinician when the link allows.
        </DisclaimerNote>
        {phase === "done" && <ToolFooter telemetry={telemetry} evidence={evidence} />}
      </div>
    </ToolLayout>
  );
}
