/**
 * protocol.ts — the wire contract between the local bridge and the browser.
 *
 * The browser opens one WebSocket and sends a `start` (a TurnRequest); the
 * bridge streams back a sequence of ServerEvents tagged with the turn id, in
 * roughly this order: turn_accepted → stage(s) → safety → served_by/route →
 * thinking* → token* → citations → telemetry → done. Binary uploads and
 * settings/mesh queries go over the tiny HTTP API instead.
 *
 * These types are mirrored verbatim in packages/web/src/lib/protocol.ts; keep
 * the two in sync. Nothing here imports @qvac/sdk or any runtime — it is pure
 * shape, shared by a Node process and a browser bundle.
 */

export type ModelKey = "llama1b" | "medgemma4b" | "medpsy4b" | "vision";

export type Lang = "" | "es" | "fr";

export interface TurnOptions {
  /** Completion model. Defaults to the server's configured default. */
  model?: ModelKey;
  /** Ground the answer in the corpus (retrieve + cite + safety). Default true. */
  grounded?: boolean;
  /** Offload completion to a mesh peer, falling back to local. Default false. */
  delegate?: boolean;
  /** Non-English round-trip: translate question→EN, answer, EN→this language. */
  lang?: Lang;
  /** Also synthesize the answer to speech (turn-based voice out). */
  speak?: boolean;
}

export interface TurnAttachment {
  /** image = vision describe; ocr = read printed text; audio = transcribe (voice in). */
  kind: "image" | "ocr" | "audio";
  /** Upload id returned by POST /api/upload. */
  id: string;
  /** Original filename, for display. */
  name?: string;
}

export interface TurnRequest {
  id: string;
  prompt: string;
  attachments?: TurnAttachment[];
  options?: TurnOptions;
}

// --- generic capability ("tool") runs ---------------------------------------
// Standalone capabilities the medic invokes on their own (read a label, …),
// separate from a conversation turn. One run streams: tool_accepted → stage(s)
// → telemetry → done | error. Binary uploads still go over POST /api/upload.

/** Tools the workspace can invoke directly. Grows as capabilities are homed. */
export type ToolId =
  | "ocr"
  | "translate"
  | "search"
  | "dictate"
  | "speak"
  | "vision"
  | "soap"
  | "corpus"
  | "classify"
  | "illustrate"
  | "adapt";

export interface ToolUpload {
  /** Role this upload plays for the tool (e.g. "image"). */
  role: string;
  /** Upload id from POST /api/upload. */
  id: string;
  name?: string;
}

export interface ToolRunRequest {
  runId: string;
  tool: ToolId;
  uploads?: ToolUpload[];
  /** Free-form tool parameters (text input, options). */
  params?: Record<string, unknown>;
  options?: TurnOptions;
}

/** One labelled value in a tool's mono telemetry strip. */
export interface ToolMetric {
  label: string;
  value: string;
  hint?: string;
}

export interface ToolTelemetry {
  servedBy?: "local" | "remote";
  backend?: string;
  metrics: ToolMetric[];
}

export interface SearchHit {
  source: string;
  section: string;
  score: number;
  snippet: string;
  content: string;
}
export interface CorpusChunk {
  source: string;
  section: string;
  snippet: string;
}
export interface InjectionFlag {
  detected: boolean;
  patterns: string[];
}

/** Tool result payloads, discriminated by `tool`. */
export type ToolOutput =
  | { tool: "ocr"; text: string; blocks: { text: string; confidence?: number }[]; injection?: InjectionFlag }
  | { tool: "translate"; text: string; direction: string; srcLang: string; tgtLang: string }
  | { tool: "search"; query: string; hits: SearchHit[] }
  | { tool: "dictate"; text: string; audioSeconds?: number }
  | { tool: "speak"; audioUrl: string; chars: number }
  | { tool: "vision"; findings: string; injection?: InjectionFlag }
  | { tool: "soap"; text: string }
  | { tool: "corpus"; workspace: string; docCount: number; chunkCount: number; embedModel: string; chunks: CorpusChunk[] }
  | { tool: "classify"; mode: "triage" | "screen"; results: { label: string; confidence?: number }[]; reason?: string; note?: string }
  | { tool: "illustrate"; dataUrl: string; width: number; height: number; steps: number; seed?: number; prompt: string }
  | {
      tool: "adapt";
      status: string;
      trainLoss?: number;
      valLoss?: number;
      valAccuracy?: number;
      epochs: number;
      steps: number;
      adapterPath?: string;
      testPrompt: string;
      baseAnswer: string;
      adaptedAnswer: string;
      model: string;
    };

export type ClientMessage =
  | { type: "start"; turn: TurnRequest }
  | { type: "cancel"; turnId: string }
  | { type: "tool_run"; run: ToolRunRequest }
  | { type: "tool_cancel"; runId: string }
  | { type: "voice_start"; options?: TurnOptions }
  | { type: "voice_stop" };

/** Live-voice turn-taking states (see the voice surface). */
export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "interrupted";

// --- server → client ---------------------------------------------------------

export type TurnStage =
  | "stt"
  | "translate_in"
  | "vision"
  | "ocr"
  | "retrieval"
  | "load"
  | "translate_out"
  | "tts";

export interface SourceChip {
  tag: string;
  source: string;
  section: string;
  score: number;
  snippet: string;
}

export interface PeerProbeWire {
  peerKey: string;
  label?: string;
  ok: boolean;
  probeMs: number;
  error?: string;
}

export interface TurnTelemetry {
  ttftMs?: number;
  ttftContentMs?: number;
  thinkingMs?: number;
  tokensPerSec?: number;
  completionTokens?: number;
  promptTokens?: number;
  totalMs?: number;
  loadMs?: number;
  backendDevice?: string;
  /** Whether the headline numbers came from the SDK or our wall-clock. */
  statsSource?: "sdk" | "measured";
}

export interface DeviceInfo {
  label: string;
  platform: string;
  arch: string;
  cpu: string;
  cores: number;
  ramGb: number;
  accel: string;
  runtime: string;
  nodeVersion: string;
}

export type MeshNodeStatus = "live" | "down" | "unknown" | "active";

export interface PeerServedStats {
  turns: number;
  lastTtftMs?: number;
  lastTps?: number;
  lastAt?: number;
}

export interface MeshPeer {
  key: string;
  label: string;
  role?: string;
  model?: string;
  status: MeshNodeStatus;
  probeMs?: number;
  error?: string;
  /** Real served-turn history for this peer (only set once it has served a turn). */
  served?: PeerServedStats;
}

/** Why the last turn routed where it did (real probe results → winner / fallback). */
export interface RouteDecision {
  candidates: PeerProbeWire[];
  chosen?: string;
  servedBy: "local" | "remote";
  fallbackReason?: string;
  at: number;
}

export interface MeshSnapshot {
  self: {
    label: string;
    role: string;
    model: string;
    platform: string;
    accel: string;
    online: boolean;
    /** True when this device is serving a model to peers (provider mode). */
    serving: boolean;
    /** Advertised provider key (hex) when serving. */
    publicKey?: string;
    serveTopic?: string;
    serveModel?: string;
  };
  peers: MeshPeer[];
  /** Whether the host has internet (DHT discovery); offline still serves locally. */
  internet: boolean;
  /** Configured blind-relay keys — relay-assist for delegated links across strict NAT/firewalls. */
  relays: { count: number; keys: string[] };
  /** The most recent routing decision, for the explainable readout. */
  lastDecision?: RouteDecision;
}

export interface ServerSettings {
  defaultModel: ModelKey;
  grounded: boolean;
  delegate: boolean;
  lang: Lang;
  speak: boolean;
  corpusLabel: string;
  /** Mesh peers as "[label@]topic-or-key", preference-ordered. */
  peers: { label: string; ref: string; key: string; role?: string; model?: string }[];
  /** Blind-relay public keys (64-hex). Applied to the SDK config on bridge start. */
  relays: string[];
}

export type ServerEvent =
  // connection-level (no turnId)
  | { type: "hello"; device: DeviceInfo; settings: ServerSettings; models: { key: ModelKey; label: string }[]; mesh: MeshSnapshot }
  | { type: "mesh"; mesh: MeshSnapshot }
  // turn-level
  | { type: "turn_accepted"; turnId: string }
  | { type: "stage"; turnId: string; stage: TurnStage; status: "start" | "done"; detail?: string; ms?: number; progress?: number; servedBy?: "local" | "remote" }
  | { type: "transcript"; turnId: string; text: string }
  | { type: "safety"; turnId: string; redFlag: boolean; terms: string[]; grounded: boolean; action: string }
  | { type: "injection"; turnId: string; source: string; detected: boolean; patterns: string[] }
  | { type: "emergency"; turnId: string; notice: string }
  | { type: "served_by"; turnId: string; servedBy: "local" | "remote"; peerKey?: string; transportMs?: number; warm?: boolean; fallback?: boolean; reason?: string }
  | { type: "route"; turnId: string; candidates: PeerProbeWire[]; chosen?: string; servedBy: "local" | "remote" }
  | { type: "thinking"; turnId: string; delta: string }
  | { type: "thinking_done"; turnId: string; ms: number; chars: number }
  | { type: "token"; turnId: string; delta: string }
  | { type: "citations"; turnId: string; sources: SourceChip[]; cited: string[]; attached?: string; hallucinated: string[] }
  | { type: "telemetry"; turnId: string; telemetry: TurnTelemetry }
  | { type: "localized"; turnId: string; lang: Lang; text: string }
  | { type: "audio"; turnId: string; url: string }
  | { type: "refusal"; turnId: string; text: string; disclaimer: string }
  | { type: "done"; turnId: string; answer: string; disclaimer: string; evidence: string }
  | { type: "error"; turnId: string; message: string }
  // --- capability ("tool") runs ---
  | { type: "tool_accepted"; runId: string }
  | { type: "tool_stage"; runId: string; stage: string; status: "start" | "done"; detail?: string; ms?: number; progress?: number }
  | { type: "tool_token"; runId: string; delta: string }
  | { type: "tool_telemetry"; runId: string; telemetry: ToolTelemetry }
  | { type: "tool_done"; runId: string; output: ToolOutput; evidence: string }
  | { type: "tool_error"; runId: string; message: string }
  // --- live voice (binary frames carry PCM: mic in, TTS out) ---
  | { type: "voice_state"; state: VoiceState; mode: "live" | "turn-based"; detail?: string }
  | { type: "voice_level"; speaking: boolean; level: number }
  | { type: "voice_user"; turnId: string; text: string }
  | { type: "voice_tts"; turnId: string; status: "start" | "end"; sampleRate?: number; bargedIn?: boolean }
  | { type: "voice_error"; message: string };
