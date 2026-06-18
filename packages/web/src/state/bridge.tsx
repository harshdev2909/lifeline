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
  Lang,
  MeshSnapshot,
  ResponderMode,
  ServerEvent,
  ServerSettings,
  ToolEvent,
  ToolId,
  ToolUpload,
  TurnOptions,
  TurnRequest,
} from "../lib/protocol";
import { PcmPlayer, startMic, type MicStream } from "../lib/voiceAudio";
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
  | { kind: "voice-active"; active: boolean }
  | { kind: "event"; ev: ServerEvent };

const initial: BridgeState = {
  status: "connecting",
  settings: null,
  models: [],
  mesh: null,
  exchanges: [],
  meshPulse: 0,
  voice: { active: false, state: "idle", level: 0, speaking: false, mode: "live" },
  responder: { state: { on: false, mode: "allowlist", served: 0 }, feed: [] },
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
    case "voice-active":
      return { ...state, voice: { ...state.voice, active: action.active, state: action.active ? state.voice.state : "idle", level: 0, speaking: false } };
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
    case "responder_state":
      return { ...state, responder: { state: ev.state, feed: ev.feed } };
    case "responder_feed": {
      const rest = state.responder.feed.filter((e) => e.id !== ev.entry.id);
      return { ...state, responder: { ...state.responder, feed: [ev.entry, ...rest].slice(0, 30) } };
    }
    case "voice_state":
      return { ...state, voice: { ...state.voice, state: ev.state, mode: ev.mode } };
    case "voice_level":
      return { ...state, voice: { ...state.voice, level: ev.level, speaking: ev.speaking } };
    case "voice_user": {
      // A spoken turn becomes a normal exchange so it renders like a typed one.
      const ex: Exchange = {
        id: ev.turnId,
        user: { text: ev.text, transcript: ev.text, attachments: [], options: {} },
        assistant: { ...emptyAssistant(), status: "streaming" },
      };
      return { ...state, exchanges: [...state.exchanges, ex] };
    }
    case "voice_tts":
    case "voice_error":
      return state; // audio + errors handled as side effects in the socket handler
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
  /** Run a standalone capability; events stream to `onEvent`. Returns a cancel handle. */
  runTool(
    req: { tool: ToolId; uploads?: ToolUpload[]; params?: Record<string, unknown>; options?: TurnOptions },
    onEvent: (ev: ToolEvent) => void,
  ): { runId: string; cancel: () => void };
  applySettings(settings: ServerSettings): void;
  refreshMesh(): Promise<void>;
  startVoice(options: TurnOptions): Promise<void>;
  stopVoice(): void;
  /** Unattended responder: toggle on/off + allowlist vs open. */
  setResponder(on: boolean, mode: ResponderMode): void;
  /** Submit a question to this node's responder (the field/peer side). Returns the turn id. */
  askResponder(input: { question: string; from?: string; lang?: Lang; delegate?: boolean }): string;
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
  const playerRef = useRef<PcmPlayer | null>(null);
  const micRef = useRef<MicStream | null>(null);
  // Per-run handlers for tool (capability) events, keyed by runId. Kept off the
  // conversation reducer so capability tools own their own local state.
  const toolRunsRef = useRef<Map<string, (ev: ToolEvent) => void>>(new Map());

  useEffect(() => {
    closedByUs.current = false;
    let attempts = 0;

    const connect = () => {
      dispatch({ kind: "status", status: "connecting" });
      const ws = new WebSocket(wsUrl());
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        dispatch({ kind: "status", status: "open" });
      };
      ws.onmessage = (e) => {
        // Binary frames are streamed TTS PCM — feed the player directly.
        if (e.data instanceof ArrayBuffer) {
          playerRef.current?.enqueue(e.data);
          return;
        }
        let ev: ServerEvent;
        try {
          ev = JSON.parse(e.data);
        } catch {
          return;
        }
        if (ev.type === "hello") {
          dispatch({ kind: "hello", ev });
          return;
        }
        // Tool (capability) events route to the run that started them, not the
        // conversation store.
        if (ev.type.startsWith("tool_")) {
          toolRunsRef.current.get((ev as ToolEvent).runId)?.(ev as ToolEvent);
          return;
        }
        // Stop playback promptly on barge-in / session end.
        if (ev.type === "voice_state" && (ev.state === "interrupted" || ev.state === "idle")) playerRef.current?.stop();
        if (ev.type === "voice_tts" && ev.status === "end" && ev.bargedIn) playerRef.current?.stop();
        dispatch({ kind: "event", ev });
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
      micRef.current?.stop();
      micRef.current = null;
      playerRef.current?.dispose();
      playerRef.current = null;
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

  const runTool = useCallback<BridgeContextValue["runTool"]>(
    (req, onEvent) => {
      const runId = crypto.randomUUID();
      toolRunsRef.current.set(runId, (ev) => {
        onEvent(ev);
        if (ev.type === "tool_done" || ev.type === "tool_error") toolRunsRef.current.delete(runId);
      });
      send({ type: "tool_run", run: { ...req, runId } });
      return {
        runId,
        cancel: () => {
          send({ type: "tool_cancel", runId });
          toolRunsRef.current.delete(runId);
        },
      };
    },
    [send],
  );

  const startVoice = useCallback(
    async (options: TurnOptions) => {
      if (micRef.current) return;
      if (!playerRef.current) playerRef.current = new PcmPlayer(44100);
      try {
        // Capture the mic FIRST (this prompts for permission); stream each frame up.
        micRef.current = await startMic((frame) => {
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame);
        });
      } catch {
        dispatch({ kind: "event", ev: { type: "voice_error", message: "Microphone unavailable — check permissions." } });
        return;
      }
      send({ type: "voice_start", options });
      dispatch({ kind: "voice-active", active: true });
    },
    [send],
  );

  const stopVoice = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    playerRef.current?.stop();
    send({ type: "voice_stop" });
    dispatch({ kind: "voice-active", active: false });
  }, [send]);

  const setResponder = useCallback<BridgeContextValue["setResponder"]>((on, mode) => send({ type: "responder_set", on, mode }), [send]);

  const askResponder = useCallback<BridgeContextValue["askResponder"]>(
    (input) => {
      const turnId = crypto.randomUUID();
      send({ type: "responder_ask", turnId, question: input.question, from: input.from, lang: input.lang, delegate: input.delegate });
      return turnId;
    },
    [send],
  );

  const applySettings = useCallback((settings: ServerSettings) => dispatch({ kind: "settings", settings }), []);
  const refreshMesh = useCallback(async () => {
    const mesh = await apiProbeMesh();
    dispatch({ kind: "mesh", mesh });
  }, []);

  const busy = state.exchanges.some((ex) => ex.assistant.status === "pending" || ex.assistant.status === "streaming");

  const value = useMemo<BridgeContextValue>(
    () => ({ ...state, sendTurn, cancel, runTool, applySettings, refreshMesh, startVoice, stopVoice, setResponder, askResponder, busy }),
    [state, sendTurn, cancel, runTool, applySettings, refreshMesh, startVoice, stopVoice, setResponder, askResponder, busy],
  );

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}

export function useBridge(): BridgeContextValue {
  const ctx = useContext(BridgeContext);
  if (!ctx) throw new Error("useBridge must be used within BridgeProvider");
  return ctx;
}
