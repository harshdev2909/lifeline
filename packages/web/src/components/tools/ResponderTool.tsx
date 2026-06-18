/**
 * Responder — turn this node into an unattended triage responder. Incoming
 * questions are auto-answered with the full grounded chain (RAG + MedPsy +
 * safety + citations + disclaimer); heavy work can delegate to a stronger peer.
 * An allowlist (the configured peers) gates who may ask, unless opened.
 *
 * The question/answer envelope is app-layer over the local bridge (heavy
 * inference rides the real QVAC mesh) — so the "incoming" panel below is the
 * field/peer side, and on a two-node setup the same question would arrive over
 * the mesh. See About for how peer transfer works.
 */
import { useEffect, useMemo, useState } from "react";

import { Check, ClipboardList, Cpu, Radio, Send, ShieldCheck } from "lucide-react";

import { createIncident } from "../../lib/api";
import { cn } from "../../lib/cn";
import { ms } from "../../lib/format";
import type { ResponderFeedEntry } from "../../lib/protocol";
import { useBridge } from "../../state/bridge";
import { Button } from "../ui/Button";
import { MetricStrip, NoticeBar, SegmentedControl } from "../workspace/ToolBits";
import { ToolLayout } from "../workspace/ToolLayout";

export function ResponderTool() {
  const { responder, mesh, setResponder, askResponder, status } = useBridge();
  const { state, feed } = responder;
  const livePeers = useMemo(() => (mesh?.peers ?? []).filter((p) => p.status === "live"), [mesh]);

  return (
    <ToolLayout
      title="Responder"
      blurb="Let this device auto-answer triage questions from the mesh — grounded, cited, with the safety layer and the not-a-diagnosis disclaimer. Heavy work can delegate to a stronger peer."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            ariaLabel="Responder"
            value={state.on ? "on" : "off"}
            onChange={(v) => setResponder(v === "on", state.mode)}
            disabled={status !== "open"}
            options={[
              { value: "off", label: "Off" },
              { value: "on", label: "On", tone: "local" },
            ]}
          />
          <span className="text-xs text-fg-muted">Who may ask</span>
          <SegmentedControl
            ariaLabel="Allowlist mode"
            value={state.mode}
            onChange={(v) => setResponder(state.on, v === "open" ? "open" : "allowlist")}
            disabled={status !== "open"}
            options={[
              { value: "allowlist", label: "Allowlist" },
              { value: "open", label: "Open" },
            ]}
          />
          <span className={cn("inline-flex items-center gap-1.5 text-2xs font-medium", state.on ? "text-local" : "text-fg-faint")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", state.on ? "bg-local" : "bg-fg-faint")} />
            {state.on ? "Answering" : "Idle"}
          </span>
        </div>

        <NoticeBar icon={ShieldCheck}>
          {state.mode === "allowlist"
            ? `Allowlist — only your ${livePeers.length ? `${mesh?.peers.length} configured peer(s)` : "configured peers"} may ask. Others are refused.`
            : "Open — any peer may ask. Switch to allowlist to restrict to configured peers."}{" "}
          Red-flag answers lead with “seek emergency care”; ungrounded ones decline rather than guess.
        </NoticeBar>

        {state.on && <MetricStrip items={[{ k: "served", v: String(state.served) }, { k: "peers live", v: String(livePeers.length) }, { k: "last", v: state.lastAt ? new Date(state.lastAt).toLocaleTimeString() : "—" }]} />}

        <IncomingPanel disabled={!state.on || status !== "open"} peers={(mesh?.peers ?? []).map((p) => p.label)} onAsk={askResponder} />

        <div>
          <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-fg-faint">Live feed · questions in, answers out</h2>
          {feed.length === 0 ? (
            <p className="rounded-xl border border-hairline bg-surface px-4 py-6 text-center text-sm text-fg-muted">
              No questions yet. When the responder is on, incoming questions and their grounded answers appear here.
            </p>
          ) : (
            <ul className="space-y-2">
              {feed.map((e) => (
                <FeedRow key={e.id + e.at} entry={e} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </ToolLayout>
  );
}

function IncomingPanel({ disabled, peers, onAsk }: { disabled: boolean; peers: string[]; onAsk: (i: { question: string; from?: string; lang?: "" | "es" | "fr"; delegate?: boolean }) => string }) {
  const [from, setFrom] = useState("");
  const [question, setQuestion] = useState("");

  useEffect(() => {
    if (!from && peers.length) setFrom(peers[0]);
  }, [peers, from]);

  function ask() {
    if (!question.trim() || disabled) return;
    onAsk({ question: question.trim(), from: from.trim() });
    setQuestion("");
  }

  return (
    <div className="rounded-xl border border-hairline bg-surface px-4 py-3">
      <p className="text-xs font-medium text-fg">Incoming question · field side</p>
      <p className="mt-0.5 text-2xs text-fg-faint">Stands in for a peer device asking over the mesh. The responder answers it through the full grounded chain.</p>
      <div className="mt-2 space-y-2">
        <input
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="from (peer label or key)"
          className="w-full rounded-lg border border-hairline bg-base px-2.5 py-2 text-sm text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2"
        />
        <div className="flex flex-wrap items-end gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            placeholder="the peer's first-aid question…"
            className="min-w-0 flex-1 resize-y rounded-lg border border-hairline bg-base px-2.5 py-2 text-sm leading-relaxed text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2"
          />
          <Button variant="primary" onClick={ask} disabled={disabled || !question.trim()}>
            <Send className="h-4 w-4" aria-hidden /> Ask
          </Button>
        </div>
      </div>
    </div>
  );
}

function FeedRow({ entry: e }: { entry: ResponderFeedEntry }) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await createIncident({
        id: `resp-${e.id}`,
        model: e.model || "unknown",
        servedBy: e.servedBy,
        evidence: e.evidence ? [e.evidence] : [],
        entries: [{ question: e.question, guidance: e.answer, redFlag: e.redFlag, redFlagTerms: e.redFlagTerms, lang: e.lang, citations: e.citations }],
      });
      setSaved(true);
    } catch {
      /* surfaced by the disabled state staying off */
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-hairline bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-2xs">
        <span className="font-medium text-fg">{e.from}</span>
        {e.allowed ? (
          <span className={cn("inline-flex items-center gap-1", e.servedBy === "remote" ? "text-remote" : "text-local")}>
            {e.servedBy === "remote" ? <Radio className="h-3 w-3" aria-hidden /> : <Cpu className="h-3 w-3" aria-hidden />}
            {e.servedBy === "remote" ? "peer" : "on-device"}
          </span>
        ) : (
          <span className="rounded-full border border-hairline bg-raised px-1.5 py-0.5 text-fg-muted">refused · {e.reason}</span>
        )}
        {e.redFlag && <span className="rounded-full border border-emergency-line bg-emergency-soft px-1.5 py-0.5 font-medium text-emergency">red flag</span>}
        <span className="ml-auto font-mono text-fg-faint">
          {e.ttftMs != null ? `ttft ${ms(e.ttftMs)}ms · ` : ""}{e.ms}ms{e.tps ? ` · ${e.tps.toFixed(1)} tok/s` : ""}
        </span>
      </div>
      <p className="mt-1.5 text-sm font-medium text-fg">{e.question}</p>
      {e.allowed && (
        <>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">{e.answer || "No grounded guidance — declined below the threshold."}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {e.citations.length > 0 && <span className="font-mono text-2xs text-fg-faint">{e.citations.length} citation{e.citations.length > 1 ? "s" : ""}</span>}
            {saved ? (
              <span className="inline-flex items-center gap-1 text-2xs text-local"><Check className="h-3 w-3" aria-hidden /> Saved to incidents</span>
            ) : (
              <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 text-2xs text-fg-faint hover:text-fg-muted focus-visible:outline focus-visible:outline-2 disabled:opacity-45">
                <ClipboardList className="h-3 w-3" aria-hidden /> Save as incident
              </button>
            )}
          </div>
        </>
      )}
    </li>
  );
}
