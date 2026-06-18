/**
 * bridge.tsx — the single connection to the local bridge and the conversation
 * store. Owns the WebSocket (with auto-reconnect), folds streaming ServerEvents
 * into the conversation model, and exposes actions to start/cancel turns and to
 * refresh settings and the mesh. Every value rendered in the UI ultimately comes
 * from here, which means every metric, citation, peer, and animation is real.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { probeMesh as apiProbeMesh } from "../lib/api";
import type {
  ClientMessage,
  MeshSnapshot,
  ServerEvent,
  ServerSettings,
  TurnRequest,
} from "../lib/protocol";
import {
  emptyAssistant,
  type AssistantMsg,
  type BridgeState,
  type Exchange,
  type UserMsg,
} from "./types";

type Action =
  | { kind: "status"; status: BridgeState["status"] }
  | { kind: "hello"; ev: Extract<ServerEvent, { type: "hello" }> }
  | { kind: "mesh"; mesh: MeshSnapshot }
  | { kind: "settings"; settings: ServerSettings }
  | { kind: "open-turn"; id: string; user: UserMsg }
  | { kind: "event"; ev: ServerEvent };

const initial: BridgeState = {
  status: "connecting",
  settings: null,
  models: [],
  mesh: null,
  exchanges: [],
  meshPulse: 0,
};

function patchAssistant(state: BridgeState, turnId: string, fn: (a: AssistantMsg) => AssistantMsg): BridgeState {
  let changed = false;
  const exchanges = state.exchanges.map((ex) => {
    if (ex.id !== turnId) return ex;
    changed = true;
    return { ...ex, assistant: fn(ex.assistant) };
  });
  return changed ? { ...state, exchanges } : state;
}

function reducer(state: BridgeState, action: Action): BridgeState {
  switch (action.kind) {
    case "status":
      return { ...state, status: action.status };
    case "hello":
      return { ...state, device: action.ev.device, models: action.ev.models, settings: action.ev.settings, mesh: action.ev.mesh };
    case "mesh":
      return { ...state, mesh: action.mesh };
    case "settings":
      return { ...state, settings: action.settings };
    case "open-turn": {
      const ex: Exchange = { id: action.id, user: action.user, assistant: emptyAssistant() };
      return { ...state, exchanges: [...state.exchanges, ex] };
    }
    case "event":
      return applyEvent(state, action.ev);
    default:
      return state;
  }
}

function applyEvent(state: BridgeState, ev: ServerEvent): BridgeState {
  switch (ev.type) {
    case "mesh":
      return { ...state, mesh: ev.mesh };
    case "turn_accepted":
      return patchAssistant(state, ev.turnId, (a) => ({ ...a, status: "streaming" }));
    case "stage":
      return patchAssistant(state, ev.turnId, (a) => ({
        ...a,
        stages: mergeStage(a.stages, ev),
      }));
    case "transcript":
      return {
        ...state,
        exchanges: state.exchanges.map((ex) => (ex.id === ev.turnId ? { ...ex, user: { ...ex.user, transcript: ev.text } } : ex)),
      };
    case "safety":
      return patchAssistant(state, ev.turnId, (a) => ({ ...a, safety: { redFlag: ev.redFlag, terms: ev.terms, grounded: ev.grounded, action: ev.action } }));
    case "injection":
      return patchAssistant(state, ev.turnId, (a) => ({ ...a, injections: [...a.injections, { source: ev.source, patterns: ev.patterns }] }));
    case "emergency":
      return patchAssistant(state, ev.turnId, (a) => ({ ...a, emergency: ev.notice }));
    case "served_by": {
      const next = patchAssistant(state, ev.turnId, (a) => ({
        ...a,
        servedBy: { servedBy: ev.servedBy, peerKey: ev.peerKey, transportMs: ev.transportMs, warm: ev.warm, fallback: ev.fallback, reason: ev.reason },
      }));
      return { ...next, meshPulse: next.meshPulse + 1, lastDelegation: { turnId: ev.turnId, servedBy: ev.servedBy, peerKey: ev.peerKey, fallback: ev.fallback } };
    }
    case "route": {
      const next = patchAssistant(state, ev.turnId, (a) => ({ ...a, route: { candidates: ev.candidates, chosen: ev.chosen, servedBy: ev.servedBy } }));
      return { ...next, meshPulse: next.meshPulse + 1 };
    }
    case "thinking":
      return patchAssistant(state, ev.turnId, (a) => ({ ...a, thinking: a.thinking + ev.delta, thinkingActive: true }));
    case "thinking_done":
      return patchAssistant(state, ev.turnId, (a) => ({ ...a, thinkingActive: false, thinkingMs: ev.ms || a.thinkingMs }));
    case "token":
      return patchAssistant(state, ev.turnId, (a) => ({ ...a, answer: a.answer + ev.delta, thinkingActive: false }));
    case "citations":
      return patchAssistant(state, ev.turnId, (a) => ({ ...a, citations: { sources: ev.sources, cited: ev.cited, attached: ev.attached, hallucinated: ev.hallucinated } }));
    case "telemetry":
      return patchAssistant(state, ev.turnId, (a) => ({ ...a, telemetry: ev.telemetry }));
    case "localized":
      return patchAssistant(state, ev.turnId, (a) => ({ ...a, localized: { lang: ev.lang, text: ev.text } }));
    case "audio":
      return patchAssistant(state, ev.turnId, (a) => ({ ...a, audioUrl: ev.url }));
    case "refusal":
      return patchAssistant(state, ev.turnId, (a) => ({ ...a, status: "refused", refusal: ev.text, disclaimer: ev.disclaimer }));
    case "done":
      return patchAssistant(state, ev.turnId, (a) => ({
        ...a,
        status: a.status === "refused" ? "refused" : "done",
        answer: a.answer || ev.answer,
        disclaimer: ev.disclaimer,
        evidence: ev.evidence,
        thinkingActive: false,
      }));
    case "error":
      return patchAssistant(state, ev.turnId, (a) => ({ ...a, status: "error", error: ev.message, thinkingActive: false }));
    default:
      return state;
  }
}

function mergeStage(stages: import("./types").StageEntry[], ev: Extract<ServerEvent, { type: "stage" }>): import("./types").StageEntry[] {
  const entry = { stage: ev.stage, status: ev.status, detail: ev.detail, ms: ev.ms, servedBy: ev.servedBy };
  const idx = stages.findIndex((s) => s.stage === ev.stage);
  if (idx >= 0) {
    const copy = stages.slice();
    copy[idx] = { ...copy[idx], ...entry };
    return copy;
  }
  return [...stages, entry];
}

interface BridgeContextValue extends BridgeState {
  sendTurn(input: { prompt: string; attachments?: TurnRequest["attachments"]; userAttachments: UserMsg["attachments"]; options: UserMsg["options"] }): void;
  cancel(turnId: string): void;
  applySettings(settings: ServerSettings): void;
  refreshMesh(): Promise<void>;
  busy: boolean;
}

const BridgeContext = createContext<BridgeContextValue | null>(null);

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

export function BridgeProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = useRef(false);

  useEffect(() => {
    closedByUs.current = false;
    let attempts = 0;

    const connect = () => {
      dispatch({ kind: "status", status: "connecting" });
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        dispatch({ kind: "status", status: "open" });
      };
      ws.onmessage = (e) => {
        let ev: ServerEvent;
        try {
          ev = JSON.parse(e.data);
        } catch {
          return;
        }
        if (ev.type === "hello") dispatch({ kind: "hello", ev });
        else dispatch({ kind: "event", ev });
      };
      ws.onclose = () => {
        dispatch({ kind: "status", status: "closed" });
        if (closedByUs.current) return;
        attempts++;
        const delay = Math.min(8000, 500 * 2 ** Math.min(attempts, 4));
        retryRef.current = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closedByUs.current = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const sendTurn = useCallback<BridgeContextValue["sendTurn"]>(
    (input) => {
      const id = crypto.randomUUID();
      const user: UserMsg = { text: input.prompt, attachments: input.userAttachments, options: input.options };
      dispatch({ kind: "open-turn", id, user });
      const turn: TurnRequest = { id, prompt: input.prompt, attachments: input.attachments, options: input.options };
      send({ type: "start", turn });
    },
    [send],
  );

  const cancel = useCallback((turnId: string) => send({ type: "cancel", turnId }), [send]);
  const applySettings = useCallback((settings: ServerSettings) => dispatch({ kind: "settings", settings }), []);
  const refreshMesh = useCallback(async () => {
    const mesh = await apiProbeMesh();
    dispatch({ kind: "mesh", mesh });
  }, []);

  const busy = state.exchanges.some((ex) => ex.assistant.status === "pending" || ex.assistant.status === "streaming");

  const value = useMemo<BridgeContextValue>(
    () => ({ ...state, sendTurn, cancel, applySettings, refreshMesh, busy }),
    [state, sendTurn, cancel, applySettings, refreshMesh, busy],
  );

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}

export function useBridge(): BridgeContextValue {
  const ctx = useContext(BridgeContext);
  if (!ctx) throw new Error("useBridge must be used within BridgeProvider");
  return ctx;
}
