/**
 * SaveIncident — offered (never forced) after a completed or red-flag exchange.
 * Assembles a structured Incident Report from data the turn already produced —
 * the question, the grounded answer, its citations, the safety red-flag signal,
 * the model and where it ran — plus a manually-entered location, and saves it to
 * the bridge. It then shows up in the Incident reports tool.
 */
import { useState } from "react";

import { ClipboardList, Check } from "lucide-react";

import { createIncident } from "../../lib/api";
import type { Exchange } from "../../state/types";
import { useBridge } from "../../state/bridge";

export function SaveIncident({ exchange }: { exchange: Exchange }) {
  const { models } = useBridge();
  const a = exchange.assistant;
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  // Offered only once the exchange is a real triage record: answered or refused.
  if (a.status !== "done" && a.status !== "refused") return null;

  async function save() {
    setBusy(true);
    setErr(undefined);
    const u = exchange.user;
    const modelKey = u.options.model;
    const modelLabel = models.find((m) => m.key === modelKey)?.label ?? modelKey ?? "unknown";
    try {
      await createIncident({
        id: exchange.id,
        model: modelLabel,
        servedBy: a.servedBy?.servedBy ?? "local",
        location: location.trim(),
        evidence: a.evidence ? [a.evidence] : [],
        entries: [
          {
            question: u.transcript ?? u.text,
            guidance: a.answer ?? "",
            redFlag: a.safety?.redFlag ?? Boolean(a.emergency),
            redFlagTerms: a.safety?.terms ?? [],
            lang: u.options.lang ?? "",
            citations: (a.citations?.sources ?? []).map((s) => ({ tag: s.tag, source: s.source, section: s.section, score: s.score, snippet: s.snippet })),
          },
        ],
      });
      setSaved(true);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <p className="flex items-center gap-1.5 pl-9 text-2xs text-local">
        <Check className="h-3 w-3" aria-hidden /> Saved to Incident reports.
      </p>
    );
  }

  return (
    <div className="pl-9">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-2xs text-fg-faint transition-colors hover:text-fg-muted focus-visible:outline focus-visible:outline-2"
        >
          <ClipboardList className="h-3 w-3" aria-hidden /> Save incident report
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2">
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="location (optional, manual)"
            className="min-w-0 flex-1 rounded-md border border-hairline bg-base px-2 py-1 text-xs text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2"
            aria-label="Location"
          />
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-45"
          >
            <ClipboardList className="h-3.5 w-3.5" aria-hidden /> Save report
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-2xs text-fg-faint hover:text-fg-muted">
            Cancel
          </button>
          {err && <p className="w-full text-2xs text-emergency">{err}</p>}
        </div>
      )}
    </div>
  );
}
