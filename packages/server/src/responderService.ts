/**
 * responderService.ts — unattended triage responder.
 *
 * When a node turns the responder on, incoming questions are auto-answered with
 * the full grounded chain (the same `runTurn` the conversation uses — RAG +
 * MedPsy + safety + citations + disclaimer), optionally delegating the heavy
 * completion to a stronger peer over the real QVAC mesh. An allowlist (the
 * configured peers) gates who may ask, unless the operator opens it.
 *
 * QVAC's verified peer channel carries model inference, not arbitrary question
 * envelopes, so the question/answer envelope is an app-layer protocol over the
 * bridge (the only network the browser uses); on a multi-node deployment it
 * would ride the mesh. Heavy inference still delegates over the real channel.
 *
 * Reliability: every answer runs under the shared lock and an AbortController;
 * turning the responder off aborts all in-flight work; runTurn keeps the worker
 * warm and reconciles it, so nothing is orphaned.
 */
import { performance } from "node:perf_hooks";

import { getSettings, MODEL_REGISTRY } from "./config";
import { runTurn } from "./orchestrator";
import type { ResponderFeedEntry, ResponderMode, ResponderState, ServerEvent, SourceChip, TurnRequest } from "./protocol";
import { tracked } from "./serialize";

/** The turn runner the responder drives — the real grounded chain, or a stub in tests. */
export type TurnRunner = (turn: TurnRequest, emit: (ev: ServerEvent) => void, signal: AbortSignal) => Promise<void>;

const FEED_CAP = 30;

let state: ResponderState = { on: false, mode: "allowlist", served: 0 };
const feed: ResponderFeedEntry[] = [];
const subscribers = new Set<(ev: ServerEvent) => void>();
const inflight = new Set<AbortController>();

function modelLabel(key: string): string {
  return MODEL_REGISTRY.find((m) => m.key === key)?.label ?? key;
}

function broadcast(ev: ServerEvent): void {
  for (const fn of subscribers) {
    try {
      fn(ev);
    } catch {
      /* a dead subscriber shouldn't break the others */
    }
  }
}

/** Operator surfaces subscribe to receive state + feed updates; returns an unsubscribe. */
export function subscribeResponder(fn: (ev: ServerEvent) => void): () => void {
  subscribers.add(fn);
  fn({ type: "responder_state", state, feed });
  return () => subscribers.delete(fn);
}

export function responderSnapshot(): { state: ResponderState; feed: ResponderFeedEntry[] } {
  return { state, feed };
}

export function getResponderState(): ResponderState {
  return state;
}

export function getFeed(): ResponderFeedEntry[] {
  return feed;
}

function abortAll(): void {
  for (const c of inflight) c.abort();
  inflight.clear();
}

export function setResponder(on: boolean, mode: ResponderMode): ResponderState {
  state = { ...state, on, mode };
  if (!on) abortAll();
  broadcast({ type: "responder_state", state, feed });
  return state;
}

function isAllowed(from: string): boolean {
  if (!from) return false;
  const f = from.toLowerCase();
  return getSettings().peers.some((p) => p.key.toLowerCase() === f || p.label.toLowerCase() === f);
}

function pushFeed(entry: ResponderFeedEntry): void {
  feed.unshift(entry);
  if (feed.length > FEED_CAP) feed.length = FEED_CAP;
}

export interface ResponderAskRequest {
  turnId: string;
  question: string;
  from?: string;
  lang?: "" | "es" | "fr";
  delegate?: boolean;
}

/**
 * Answer one incoming question. Forwards the live turn stream to the asker via
 * `emit`, accumulates a feed entry, and broadcasts it to operator surfaces.
 */
export async function responderAsk(
  req: ResponderAskRequest,
  emit: (ev: ServerEvent) => void,
  controller: AbortController,
  runner: TurnRunner = runTurn,
): Promise<void> {
  const { turnId } = req;
  const question = req.question.trim();
  const from = (req.from ?? "").trim();

  if (!state.on) {
    emit({ type: "error", turnId, message: "Responder is off on this device." });
    return;
  }
  if (!question) {
    emit({ type: "error", turnId, message: "Empty question." });
    return;
  }

  const allowed = state.mode === "open" || isAllowed(from);
  if (!allowed) {
    const reason = from ? "peer not on the allowlist" : "no peer identity given";
    const entry: ResponderFeedEntry = baseEntry(turnId, from || "unknown", question);
    entry.allowed = false;
    entry.reason = reason;
    pushFeed(entry);
    broadcast({ type: "responder_feed", entry });
    emit({ type: "error", turnId, message: `Rejected — ${reason}. Add this peer in Settings, or switch the responder to open.` });
    return;
  }

  inflight.add(controller);
  const settings = getSettings();
  const t0 = performance.now();
  let answer = "";
  let citations: SourceChip[] = [];
  let redFlag = false;
  let redFlagTerms: string[] = [];
  let servedBy: "local" | "remote" = "local";
  let evidence: string | undefined;
  let ttftMs: number | undefined;
  let tps: number | undefined;
  let firstAt = 0;

  const turn: TurnRequest = { id: turnId, prompt: question, options: { grounded: true, delegate: req.delegate ?? settings.delegate, lang: req.lang ?? "" } };

  const capture = (ev: ServerEvent): void => {
    emit(ev); // stream the live answer back to the asker
    switch (ev.type) {
      case "token":
        if (!firstAt) {
          firstAt = performance.now();
          ttftMs = Math.round(firstAt - t0);
        }
        answer += ev.delta;
        break;
      case "citations":
        citations = ev.sources;
        break;
      case "safety":
        redFlag = ev.redFlag;
        redFlagTerms = ev.terms;
        break;
      case "served_by":
        servedBy = ev.servedBy;
        break;
      case "telemetry":
        if (ev.telemetry.tokensPerSec != null) tps = ev.telemetry.tokensPerSec;
        if (ev.telemetry.ttftMs != null) ttftMs = Math.round(ev.telemetry.ttftMs);
        break;
      case "done":
        evidence = ev.evidence;
        if (!answer) answer = ev.answer;
        break;
    }
  };

  try {
    await tracked(() => runner(turn, capture, controller.signal));
  } catch (err) {
    emit({ type: "error", turnId, message: err instanceof Error ? err.message : String(err) });
  } finally {
    inflight.delete(controller);
  }

  const entry: ResponderFeedEntry = {
    ...baseEntry(turnId, from || "peer", question),
    allowed: true,
    answer: answer.slice(0, 4000),
    citations,
    redFlag,
    redFlagTerms,
    servedBy,
    model: modelLabel(settings.defaultModel),
    lang: req.lang ?? "",
    evidence,
    ms: Math.round(performance.now() - t0),
    ttftMs,
    tps,
  };
  pushFeed(entry);
  state = { ...state, served: state.served + 1, lastAt: new Date().toISOString() };
  broadcast({ type: "responder_feed", entry });
  broadcast({ type: "responder_state", state, feed });
}

function baseEntry(id: string, from: string, question: string): ResponderFeedEntry {
  return {
    id,
    at: new Date().toISOString(),
    from,
    question,
    answer: "",
    citations: [],
    redFlag: false,
    redFlagTerms: [],
    servedBy: "local",
    model: "",
    lang: "",
    ms: 0,
    allowed: true,
  };
}
