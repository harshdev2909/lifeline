import assert from "node:assert/strict";
import { test } from "node:test";

import { getFeed, getResponderState, responderAsk, setResponder, subscribeResponder, type TurnRunner } from "../src/responderService";
import type { ServerEvent } from "../src/protocol";

function collect() {
  const events: ServerEvent[] = [];
  return { events, emit: (ev: ServerEvent) => events.push(ev) };
}

// A stub grounded runner: emits a canned safety→token→citations→done stream.
const happyRunner: TurnRunner = async (turn, emit) => {
  emit({ type: "served_by", turnId: turn.id, servedBy: "local" });
  emit({ type: "safety", turnId: turn.id, redFlag: true, terms: ["not breathing"], grounded: true, action: "answer" });
  emit({ type: "token", turnId: turn.id, delta: "Start CPR" });
  emit({ type: "token", turnId: turn.id, delta: " now [S1]." });
  emit({ type: "citations", turnId: turn.id, sources: [{ tag: "S1", source: "WHO field manual", section: "CPR", score: 0.9, snippet: "30 compressions" }], cited: ["S1"], hallucinated: [] });
  emit({ type: "done", turnId: turn.id, answer: "Start CPR now [S1].", disclaimer: "d", evidence: "/e/run.jsonl" });
};

test("subscribing yields an immediate responder_state snapshot", () => {
  let got: ServerEvent | undefined;
  const unsub = subscribeResponder((ev) => (got = ev));
  assert.equal(got?.type, "responder_state");
  unsub();
});

test("a question is refused when the responder is off, and the runner never runs", async () => {
  setResponder(false, "allowlist");
  let ran = false;
  const stub: TurnRunner = async () => {
    ran = true;
  };
  const { events } = collect();
  await responderAsk({ turnId: "q-off", question: "help" }, (ev) => events.push(ev), new AbortController(), stub);
  assert.equal(ran, false);
  assert.ok(events.some((e) => e.type === "error" && /off/i.test(e.message)));
});

test("the allowlist firewall refuses an unknown peer (no inference)", async () => {
  setResponder(true, "allowlist");
  let ran = false;
  const stub: TurnRunner = async () => {
    ran = true;
  };
  const { events } = collect();
  await responderAsk({ turnId: "q-deny", question: "help", from: "stranger" }, (ev) => events.push(ev), new AbortController(), stub);
  assert.equal(ran, false);
  const entry = getFeed().find((e) => e.id === "q-deny");
  assert.ok(entry && entry.allowed === false);
  assert.match(entry!.reason ?? "", /allowlist/);
});

test("open mode answers end-to-end and records a grounded feed entry", async () => {
  setResponder(true, "open");
  const before = getResponderState().served;
  const { events } = collect();
  await responderAsk({ turnId: "q-ok", question: "Someone isn't breathing", from: "Field 1" }, (ev) => events.push(ev), new AbortController(), happyRunner);
  // The asker received the live stream.
  assert.ok(events.some((e) => e.type === "token"));
  assert.ok(events.some((e) => e.type === "done"));
  const entry = getFeed().find((e) => e.id === "q-ok");
  assert.ok(entry);
  assert.equal(entry!.allowed, true);
  assert.equal(entry!.answer, "Start CPR now [S1].");
  assert.equal(entry!.citations.length, 1);
  assert.equal(entry!.redFlag, true);
  assert.equal(entry!.servedBy, "local");
  assert.equal(entry!.evidence, "/e/run.jsonl");
  assert.equal(getResponderState().served, before + 1);
});

test("a crashing runner is contained — error surfaced, feed recorded, nothing left in flight", async () => {
  setResponder(true, "open");
  const crash: TurnRunner = async () => {
    throw new Error("WORKER_CRASHED");
  };
  const { events } = collect();
  await responderAsk({ turnId: "q-crash", question: "help", from: "Field 1" }, (ev) => events.push(ev), new AbortController(), crash);
  assert.ok(events.some((e) => e.type === "error" && /WORKER_CRASHED/.test(e.message)));
  assert.ok(getFeed().some((e) => e.id === "q-crash"));
  // Turning the responder off must not hang on a stuck in-flight controller.
  setResponder(false, "open");
  assert.equal(getResponderState().on, false);
});
