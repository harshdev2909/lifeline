/**
 * incident.ts — the emergency artifact. A structured, exportable record of a
 * triage interaction, built only from data the run already produced (citations,
 * the safety layer's red-flag signals, the model and where it ran) plus a
 * manually-entered location. No GPS, no invented fields.
 *
 * Pure and SDK-free, so it can be assembled on either side of the bridge and
 * serialized to clean Markdown or JSON for a clinician to read or archive.
 */
import { MEDICAL_DISCLAIMER } from "./safety";

export type IncidentSeverity = "emergency" | "urgent" | "routine";

export interface IncidentCitation {
  tag: string;
  source: string;
  section: string;
  score: number;
  snippet: string;
}

/** One triage exchange folded into the report. */
export interface IncidentEntry {
  question: string;
  guidance: string;
  citations: IncidentCitation[];
  redFlag: boolean;
  redFlagTerms: string[];
  /** "" | "es" | "fr" — the language the exchange was conducted in. */
  lang: string;
}

export interface IncidentReport {
  id: string;
  /** ISO timestamp, supplied by the caller (no clock in this pure module). */
  createdAt: string;
  /** Manually entered — there is no GPS or location hardware. "" if not given. */
  location: string;
  severity: IncidentSeverity;
  /** Completion model label used for the guidance. */
  model: string;
  servedBy: "local" | "remote";
  entries: IncidentEntry[];
  /** Evidence (JSONL) files the folded-in exchanges wrote, for audit. */
  evidence: string[];
  disclaimer: string;
  /** Set once handed off to a reviewer device. */
  handoffTo?: string;
  handoffAt?: string;
}

export interface IncidentInput {
  id: string;
  createdAt: string;
  location?: string;
  model: string;
  servedBy?: "local" | "remote";
  entries: IncidentEntry[];
  evidence?: string[];
}

export interface IncidentSummary {
  id: string;
  createdAt: string;
  severity: IncidentSeverity;
  title: string;
  entryCount: number;
  handoffTo?: string;
}

const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  emergency: "Emergency",
  urgent: "Urgent",
  routine: "Routine",
};

const LANG_LABEL: Record<string, string> = { "": "English", es: "Spanish", fr: "French" };

/**
 * Severity straight from the safety layer's signals: any red flag → emergency;
 * an exchange that gave no guidance (declined below the grounding threshold) →
 * routine; a real answered triage → urgent. Never inferred from the text.
 */
export function severityOf(entries: IncidentEntry[]): IncidentSeverity {
  if (entries.some((e) => e.redFlag)) return "emergency";
  if (entries.length > 0 && entries.every((e) => e.guidance.trim() === "")) return "routine";
  return "urgent";
}

export function buildIncident(input: IncidentInput): IncidentReport {
  return {
    id: input.id,
    createdAt: input.createdAt,
    location: (input.location ?? "").trim(),
    severity: severityOf(input.entries),
    model: input.model,
    servedBy: input.servedBy ?? "local",
    entries: input.entries,
    evidence: input.evidence ?? [],
    disclaimer: MEDICAL_DISCLAIMER,
  };
}

export function incidentSummary(r: IncidentReport): IncidentSummary {
  return {
    id: r.id,
    createdAt: r.createdAt,
    severity: r.severity,
    title: r.entries[0]?.question?.trim() || "Incident",
    entryCount: r.entries.length,
    handoffTo: r.handoffTo,
  };
}

export function incidentToMarkdown(r: IncidentReport): string {
  const out: string[] = [];
  out.push("# Incident report", "");
  out.push(`- **When:** ${r.createdAt}`);
  out.push(`- **Location:** ${r.location || "—"}`);
  out.push(`- **Severity:** ${SEVERITY_LABEL[r.severity]}`);
  out.push(`- **Model:** ${r.model}`);
  out.push(`- **Computed:** ${r.servedBy === "remote" ? "delegated to a peer" : "on this device"}`);
  if (r.handoffTo) out.push(`- **Handed off to:** ${r.handoffTo}${r.handoffAt ? ` (${r.handoffAt})` : ""}`);
  out.push("");
  r.entries.forEach((e, i) => {
    out.push(`## ${i + 1}. ${e.question.trim()}`);
    if (e.redFlag) out.push(`> **Red flag — seek emergency care.** Detected: ${e.redFlagTerms.join(", ") || "—"}`);
    out.push("");
    out.push(e.guidance.trim() || "_No grounded guidance was given — the assistant declined below the grounding threshold._");
    if (e.citations.length) {
      out.push("", "**Sources**");
      for (const c of e.citations) out.push(`- [${c.tag}] ${c.source} § ${c.section} (score ${c.score.toFixed(2)}) — “${c.snippet}…”`);
    }
    if (e.lang) out.push("", `_Language: ${LANG_LABEL[e.lang] ?? e.lang}_`);
    out.push("");
  });
  if (r.evidence.length) {
    out.push("## Evidence", "");
    for (const p of r.evidence) out.push(`- \`${p}\``);
    out.push("");
  }
  out.push("---", r.disclaimer);
  return out.join("\n");
}

export function incidentToJson(r: IncidentReport): string {
  return JSON.stringify(r, null, 2);
}
