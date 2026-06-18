/**
 * Incidents — the emergency artifact. A designed list + detail view over the
 * structured Incident Reports a triage exchange can produce: real fields only,
 * the grounded guidance with its citations, the safety severity, and the
 * not-a-diagnosis disclaimer. Export as Markdown/JSON, or hand a case off to a
 * reviewer device (app-layer, brokered by the local bridge — see About).
 */
import { useCallback, useEffect, useState } from "react";

import { ArrowLeft, ClipboardList, Download, Send, ShieldPlus } from "lucide-react";

import { getIncident, handoffIncident, incidentExportUrl, listIncidents } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { IncidentReport, IncidentSeverity, IncidentSummary } from "../../lib/protocol";
import { Button } from "../ui/Button";
import { ErrorBar, OutputCard } from "../workspace/ToolBits";
import { ToolLayout } from "../workspace/ToolLayout";

const SEVERITY: Record<IncidentSeverity, { label: string; cls: string }> = {
  emergency: { label: "Emergency", cls: "border-emergency-line bg-emergency-soft text-emergency" },
  urgent: { label: "Urgent", cls: "border-hairline-strong bg-raised text-fg" },
  routine: { label: "Routine", cls: "border-hairline bg-raised text-fg-muted" },
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function SeverityChip({ severity }: { severity: IncidentSeverity }) {
  const s = SEVERITY[severity];
  return <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-2xs font-medium", s.cls)}>{s.label}</span>;
}

export function IncidentsTool() {
  const [list, setList] = useState<IncidentSummary[] | null>(null);
  const [selected, setSelected] = useState<IncidentReport | null>(null);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      setList(await listIncidents());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function open(id: string) {
    setError(undefined);
    try {
      setSelected(await getIncident(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <ToolLayout
      title="Incident reports"
      blurb="A structured record of a triage interaction — the question, the grounded guidance with its citations, severity, and the not-a-diagnosis disclaimer. Save one from any conversation, export it, or hand it to a reviewer."
    >
      {error && <ErrorBar message={error} />}
      {selected ? (
        <IncidentDetail
          report={selected}
          onBack={() => {
            setSelected(null);
            void refresh();
          }}
          onHandoff={(r) => setSelected(r)}
        />
      ) : (
        <IncidentList list={list} onOpen={open} />
      )}
    </ToolLayout>
  );
}

function IncidentList({ list, onOpen }: { list: IncidentSummary[] | null; onOpen: (id: string) => void }) {
  if (list === null) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (list.length === 0) {
    return (
      <div className="rounded-xl border border-hairline bg-surface px-4 py-8 text-center">
        <ClipboardList className="mx-auto h-7 w-7 text-fg-faint" aria-hidden />
        <p className="mt-2 text-sm text-fg-muted">No reports yet. After a triage exchange, choose “Save incident report” to keep a record here.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {list.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onOpen(s.id)}
            className="flex w-full items-start gap-3 rounded-xl border border-hairline bg-surface px-4 py-3 text-left transition-colors hover:border-hairline-strong hover:bg-raised focus-visible:outline focus-visible:outline-2"
          >
            <SeverityChip severity={s.severity} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-fg">{s.title}</span>
              <span className="mt-0.5 block font-mono text-2xs text-fg-faint">
                {when(s.createdAt)} · {s.entryCount} exchange{s.entryCount > 1 ? "s" : ""}
                {s.handoffTo ? ` · handed to ${s.handoffTo}` : ""}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function IncidentDetail({ report, onBack, onHandoff }: { report: IncidentReport; onBack: () => void; onHandoff: (r: IncidentReport) => void }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  async function hand() {
    setBusy(true);
    setErr(undefined);
    try {
      onHandoff(await handoffIncident(report.id, to.trim()));
      setTo("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg focus-visible:outline focus-visible:outline-2">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All reports
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <SeverityChip severity={report.severity} />
        <span className="font-mono text-2xs text-fg-faint">{when(report.createdAt)}</span>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-hairline bg-surface px-4 py-3 font-mono text-2xs text-fg-muted">
        <span><span className="text-fg-faint">location </span><span className="text-fg">{report.location || "—"}</span></span>
        <span><span className="text-fg-faint">model </span><span className="text-fg">{report.model}</span></span>
        <span><span className="text-fg-faint">computed </span><span className={report.servedBy === "remote" ? "text-remote" : "text-local"}>{report.servedBy === "remote" ? "peer" : "on-device"}</span></span>
        {report.handoffTo && <span><span className="text-fg-faint">handed to </span><span className="text-fg">{report.handoffTo}</span></span>}
      </div>

      {report.entries.map((e, i) => (
        <OutputCard key={i} title={`Exchange ${i + 1}`}>
          <p className="text-sm font-medium text-fg">{e.question}</p>
          {e.redFlag && (
            <p className="mt-1.5 text-xs font-medium text-emergency">Red flag — seek emergency care.{e.redFlagTerms.length ? ` Detected: ${e.redFlagTerms.join(", ")}` : ""}</p>
          )}
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
            {e.guidance.trim() || "No grounded guidance — the assistant declined below the grounding threshold."}
          </p>
          {e.citations.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-hairline pt-2.5">
              {e.citations.map((c) => (
                <li key={c.tag} className="text-xs">
                  <span className="font-mono text-accent">[{c.tag}]</span> <span className="text-fg">{c.source}</span> <span className="text-fg-faint">§ {c.section}</span>
                  <span className="ml-1 font-mono text-2xs text-fg-faint">score {c.score.toFixed(2)}</span>
                  <p className="mt-0.5 border-l-2 border-hairline-strong pl-2.5 leading-relaxed text-fg-muted">“{c.snippet}…”</p>
                </li>
              ))}
            </ul>
          )}
        </OutputCard>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <a href={incidentExportUrl(report.id, "md")} download className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-fg hover:border-hairline-strong hover:bg-raised">
          <Download className="h-4 w-4" aria-hidden /> Markdown
        </a>
        <a href={incidentExportUrl(report.id, "json")} download className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-fg hover:border-hairline-strong hover:bg-raised">
          <Download className="h-4 w-4" aria-hidden /> JSON
        </a>
      </div>

      <div className="rounded-xl border border-hairline bg-surface px-4 py-3">
        <p className="text-xs font-medium text-fg">Hand off to a reviewer</p>
        <p className="mt-0.5 text-2xs text-fg-faint">
          Marks the case for a clinician peer and records it in the mesh readout. Brokered by the local bridge — see About for how peer transfer works.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={to}
            onChange={(ev) => setTo(ev.target.value)}
            placeholder="reviewer label (e.g. Clinic Pi)"
            className="min-w-0 flex-1 rounded-lg border border-hairline bg-base px-2.5 py-2 text-sm text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2"
          />
          <Button variant="primary" onClick={hand} loading={busy} disabled={busy}>
            <Send className="h-4 w-4" aria-hidden /> Hand off
          </Button>
        </div>
        {err && <p className="mt-1.5 text-2xs text-emergency">{err}</p>}
        {report.handoffTo && !err && <p className="mt-1.5 text-2xs text-local">Handed to {report.handoffTo}{report.handoffAt ? ` · ${when(report.handoffAt)}` : ""}.</p>}
      </div>

      <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-fg-faint">
        <ShieldPlus className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        <span>{report.disclaimer}</span>
      </p>
    </div>
  );
}
