/**
 * incidentStore.ts — persist Incident Reports and track clinician handoffs.
 *
 * Reports are built by core's pure `buildIncident` from real run data the client
 * folds in, saved as one JSON file each under the evidence directory (so they
 * survive a restart and sit beside the run logs), and each create/handoff
 * appends an `incident` evidence event to a shared JSONL. The handoff is an
 * app-layer marking: QVAC's verified peer channel carries model inference, not
 * arbitrary artifacts, so a field→reviewer handoff is brokered by this bridge
 * (and shown in the mesh readout) rather than faked over the DHT.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildIncident, evidenceDir, incidentSummary, RunLogger, type IncidentInput, type IncidentReport, type IncidentSummary } from "@lifeline/core";

function dir(): string {
  return join(evidenceDir(), "incidents");
}

function safeId(id: string): string {
  return (id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)) || "incident";
}

let cache: Map<string, IncidentReport> | null = null;
let evLog: RunLogger | null = null;

function log(): RunLogger {
  return (evLog ??= new RunLogger());
}

function store(): Map<string, IncidentReport> {
  if (cache) return cache;
  cache = new Map();
  try {
    mkdirSync(dir(), { recursive: true });
    for (const f of readdirSync(dir())) {
      if (!f.endsWith(".json")) continue;
      try {
        const r = JSON.parse(readFileSync(join(dir(), f), "utf8")) as IncidentReport;
        if (r?.id) cache.set(r.id, r);
      } catch {
        /* skip a corrupt file rather than fail the whole store */
      }
    }
  } catch {
    /* an unreadable dir just means an empty store */
  }
  return cache;
}

function persist(r: IncidentReport): void {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(join(dir(), `${safeId(r.id)}.json`), JSON.stringify(r, null, 2), "utf8");
}

export function createIncident(input: IncidentInput): IncidentReport {
  const r = buildIncident(input);
  store().set(r.id, r);
  persist(r);
  log().incident({ incident_id: r.id, severity: r.severity, entry_count: r.entries.length, model: r.model, served_by: r.servedBy, location: Boolean(r.location) });
  return r;
}

export function listIncidents(): IncidentSummary[] {
  return [...store().values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(incidentSummary);
}

export function getIncident(id: string): IncidentReport | undefined {
  return store().get(id);
}

export function handoffIncident(id: string, to: string): IncidentReport | undefined {
  const r = store().get(id);
  if (!r) return undefined;
  r.handoffTo = to.trim() || "reviewer";
  r.handoffAt = new Date().toISOString();
  persist(r);
  log().incident({ incident_id: r.id, severity: r.severity, entry_count: r.entries.length, model: r.model, served_by: r.servedBy, location: Boolean(r.location), handoff_to: r.handoffTo });
  return r;
}

/** Handoff tally for the mesh readout (how many cases were handed to a reviewer). */
export function handoffSummary(): { count: number; lastAt?: string; lastTo?: string } {
  const handed = [...store().values()].filter((r) => r.handoffTo).sort((a, b) => ((a.handoffAt ?? "") < (b.handoffAt ?? "") ? 1 : -1));
  return { count: handed.length, lastAt: handed[0]?.handoffAt, lastTo: handed[0]?.handoffTo };
}
