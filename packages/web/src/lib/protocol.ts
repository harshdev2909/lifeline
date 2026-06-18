/**
 * protocol.ts — the wire contract with the local bridge.
 *
 * Mirror of packages/server/src/protocol.ts. Keep the two in sync: this is the
 * browser's view of the same types (no runtime, pure shape).
 */

export type ModelKey = "llama1b" | "medgemma4b" | "medpsy4b" | "vision";
export type Lang = "" | "es" | "fr";

export interface TurnOptions {
  model?: ModelKey;
  grounded?: boolean;
  delegate?: boolean;
  lang?: Lang;
  speak?: boolean;
}

export interface TurnAttachment {
  kind: "image" | "ocr" | "audio";
  id: string;
  name?: string;
}

export interface TurnRequest {
  id: string;
  prompt: string;
  attachments?: TurnAttachment[];
  options?: TurnOptions;
}

// --- generic capability ("tool") runs ---
export type ToolId =
  | "ocr"
  | "translate"
  | "search"
  | "dictate"
  | "speak"
  | "vision"
  | "soap"
  | "corpus"
  | "classify";

export interface ToolUpload {
  role: string;
  id: string;
  name?: string;
}

export interface ToolRunRequest {
  runId: string;
  tool: ToolId;
  uploads?: ToolUpload[];
  params?: Record<string, unknown>;
  options?: TurnOptions;
}

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

export type ToolOutput =
  | { tool: "ocr"; text: string; blocks: { text: string; confidence?: number }[]; injection?: InjectionFlag }
  | { tool: "translate"; text: string; direction: string; srcLang: string; tgtLang: string }
  | { tool: "search"; query: string; hits: SearchHit[] }
  | { tool: "dictate"; text: string; audioSeconds?: number }
  | { tool: "speak"; audioUrl: string; chars: number }
  | { tool: "vision"; findings: string; injection?: InjectionFlag }
  | { tool: "soap"; text: string }
  | { tool: "corpus"; workspace: string; docCount: number; chunkCount: number; embedModel: string; chunks: CorpusChunk[] }
  | { tool: "classify"; mode: "triage" | "screen"; results: { label: string; confidence?: number }[]; reason?: string; note?: string };

export type ClientMessage =
  | { type: "start"; turn: TurnRequest }
  | { type: "cancel"; turnId: string }
  | { type: "tool_run"; run: ToolRunRequest }
  | { type: "tool_cancel"; runId: string }
  | { type: "voice_start"; options?: TurnOptions }
  | { type: "voice_stop" };

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "interrupted";

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
  served?: PeerServedStats;
}

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
    serving: boolean;
    publicKey?: string;
    serveTopic?: string;
    serveModel?: string;
  };
  peers: MeshPeer[];
  internet: boolean;
  lastDecision?: RouteDecision;
}

export interface ServerSettings {
  defaultModel: ModelKey;
  grounded: boolean;
  delegate: boolean;
  lang: Lang;
  speak: boolean;
  corpusLabel: string;
  peers: { label: string; ref: string; key: string; role?: string; model?: string }[];
}

export type ServerEvent =
  | { type: "hello"; device: DeviceInfo; settings: ServerSettings; models: { key: ModelKey; label: string }[]; mesh: MeshSnapshot }
  | { type: "mesh"; mesh: MeshSnapshot }
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
  | { type: "tool_accepted"; runId: string }
  | { type: "tool_stage"; runId: string; stage: string; status: "start" | "done"; detail?: string; ms?: number; progress?: number }
  | { type: "tool_token"; runId: string; delta: string }
  | { type: "tool_telemetry"; runId: string; telemetry: ToolTelemetry }
  | { type: "tool_done"; runId: string; output: ToolOutput; evidence: string }
  | { type: "tool_error"; runId: string; message: string }
  | { type: "voice_state"; state: VoiceState; mode: "live" | "turn-based"; detail?: string }
  | { type: "voice_level"; speaking: boolean; level: number }
  | { type: "voice_user"; turnId: string; text: string }
  | { type: "voice_tts"; turnId: string; status: "start" | "end"; sampleRate?: number; bargedIn?: boolean }
  | { type: "voice_error"; message: string };

/** The subset of ServerEvents that belong to a tool run (routed by runId). */
export type ToolEvent = Extract<
  ServerEvent,
  { type: "tool_accepted" | "tool_stage" | "tool_token" | "tool_telemetry" | "tool_done" | "tool_error" }
>;

export const MODEL_NOTES: Record<ModelKey, string> = {
  medgemma4b: "Medical · direct answers · fast",
  medpsy4b: "Medical · shows its reasoning",
  llama1b: "General · smallest · fastest",
  vision: "Vision · describes images",
};
