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

export type ClientMessage =
  | { type: "start"; turn: TurnRequest }
  | { type: "cancel"; turnId: string };

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
  internet: boolean;
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
  | { type: "served_by"; turnId: string; servedBy: "local" | "remote"; peerKey?: string; transportMs?: number; fallback?: boolean; reason?: string }
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
  | { type: "error"; turnId: string; message: string };

export const MODEL_NOTES: Record<ModelKey, string> = {
  medgemma4b: "Medical · direct answers · fast",
  medpsy4b: "Medical · shows its reasoning",
  llama1b: "General · smallest · fastest",
  vision: "Vision · describes images",
};
