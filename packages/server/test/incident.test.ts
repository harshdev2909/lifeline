import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Isolate the store to a temp evidence dir before it resolves the path (lazy).
process.env.LIFELINE_EVIDENCE_DIR = mkdtempSync(join(tmpdir(), "lifeline-inc-"));

const { createIncident, getIncident, handoffIncident, listIncidents, handoffSummary } = await import("../src/incidentStore");

function entry(over: Record<string, unknown> = {}) {
  return {
    question: "How do I treat a minor burn?",
    guidance: "Cool under running water for 20 minutes [S1].",
    citations: [{ tag: "S1", source: "WHO field manual", section: "Burns", score: 0.86, snippet: "Cool the burn" }],
    redFlag: false,
    redFlagTerms: [],
    lang: "",
    ...over,
  };
}

test("createIncident persists a report, lists it, and severity comes from safety", () => {
  const r = createIncident({ id: "t-urgent", createdAt: "2026-06-18T10:00:00.000Z", model: "MedGemma 4B", servedBy: "local", entries: [entry()] });
  assert.equal(r.severity, "urgent");
  assert.ok(r.disclaimer.length > 0);
  assert.equal(getIncident("t-urgent")?.id, "t-urgent");
  assert.ok(listIncidents().some((s) => s.id === "t-urgent"));

  const rf = createIncident({ id: "t-emergency", createdAt: "2026-06-18T10:05:00.000Z", model: "MedGemma 4B", entries: [entry({ redFlag: true, redFlagTerms: ["not breathing"] })] });
  assert.equal(rf.severity, "emergency");
});

test("handoff marks the report and shows in the handoff summary", () => {
  const r = handoffIncident("t-urgent", "Clinic Pi");
  assert.equal(r?.handoffTo, "Clinic Pi");
  assert.ok(r?.handoffAt);
  const s = handoffSummary();
  assert.equal(s.count, 1);
  assert.equal(s.lastTo, "Clinic Pi");
});

test("handoff of a missing incident returns undefined", () => {
  assert.equal(handoffIncident("nope", "x"), undefined);
});
