import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildIncident,
  incidentSummary,
  incidentToJson,
  incidentToMarkdown,
  severityOf,
  type IncidentEntry,
} from "../src/incident";

function entry(over: Partial<IncidentEntry> = {}): IncidentEntry {
  return {
    question: "How do I treat a minor burn?",
    guidance: "Cool under running water for 20 minutes [S1].",
    citations: [{ tag: "S1", source: "WHO field manual", section: "Burns", score: 0.86, snippet: "Cool the burn under running water" }],
    redFlag: false,
    redFlagTerms: [],
    lang: "",
    ...over,
  };
}

test("severity comes from the safety signals, not the prose", () => {
  assert.equal(severityOf([entry({ redFlag: true, redFlagTerms: ["not breathing"] })]), "emergency");
  assert.equal(severityOf([entry()]), "urgent");
  assert.equal(severityOf([entry({ guidance: "" })]), "routine");
  // A red flag wins even alongside an answered exchange.
  assert.equal(severityOf([entry(), entry({ redFlag: true })]), "emergency");
});

test("buildIncident keeps only real fields, attaches the disclaimer, trims location", () => {
  const r = buildIncident({ id: "inc1", createdAt: "2026-06-18T10:00:00.000Z", location: "  Tent 3  ", model: "MedGemma 4B", servedBy: "remote", entries: [entry()], evidence: ["/e/run-1.jsonl"] });
  assert.equal(r.location, "Tent 3");
  assert.equal(r.severity, "urgent");
  assert.equal(r.servedBy, "remote");
  assert.ok(r.disclaimer.length > 0);
  assert.equal(r.evidence[0], "/e/run-1.jsonl");
});

test("markdown carries the disclaimer, citations, and the red-flag lead", () => {
  const r = buildIncident({ id: "inc2", createdAt: "2026-06-18T10:00:00.000Z", model: "MedGemma 4B", entries: [entry({ redFlag: true, redFlagTerms: ["not breathing"] })] });
  const md = incidentToMarkdown(r);
  assert.match(md, /# Incident report/);
  assert.match(md, /Red flag — seek emergency care/);
  assert.match(md, /\[S1\] WHO field manual § Burns/);
  assert.ok(md.includes(r.disclaimer));
});

test("an unanswered (declined) exchange renders honestly and is routine", () => {
  const r = buildIncident({ id: "inc3", createdAt: "2026-06-18T10:00:00.000Z", model: "MedGemma 4B", entries: [entry({ guidance: "", citations: [] })] });
  assert.equal(r.severity, "routine");
  assert.match(incidentToMarkdown(r), /declined below the grounding threshold/);
});

test("json round-trips and the summary picks the first question", () => {
  const r = buildIncident({ id: "inc4", createdAt: "2026-06-18T10:00:00.000Z", model: "MedGemma 4B", entries: [entry(), entry({ question: "second" })] });
  assert.deepEqual(JSON.parse(incidentToJson(r)), r);
  const s = incidentSummary(r);
  assert.equal(s.title, "How do I treat a minor burn?");
  assert.equal(s.entryCount, 2);
});
