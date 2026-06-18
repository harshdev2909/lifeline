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

export type ClientMessage =
  | { type: "start"; turn: TurnRequest }
  | { type: "cancel"; turnId: string }
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

export interface MeshPeer {
  key: string;
  label: string;
  role?: string;
  model?: string;
  status: MeshNodeStatus;
  probeMs?: number;
  error?: string;
}

export interface MeshSnapshot {
  self: {
    label: string;
    role: string;
    model: string;
    platform: string;
    accel: string;
    online: boolean;
  };
  peers: MeshPeer[];
  /** Whether the host has internet (DHT discovery); offline still serves locally. */
  internet: boolean;
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
  // --- live voice (binary frames carry PCM: mic in, TTS out) ---
  | { type: "voice_state"; state: VoiceState; mode: "live" | "turn-based"; detail?: string }
  | { type: "voice_level"; speaking: boolean; level: number }
  | { type: "voice_user"; turnId: string; text: string }
  | { type: "voice_tts"; turnId: string; status: "start" | "end"; sampleRate?: number; bargedIn?: boolean }
  | { type: "voice_error"; message: string };
