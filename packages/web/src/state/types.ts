/** Client-side conversation model, assembled from the bridge's streaming events. */
import type {
  Lang,
  PeerProbeWire,
  ServerSettings,
  SourceChip,
  TurnAttachment,
  TurnOptions,
  TurnStage,
  TurnTelemetry,
  VoiceState,
} from "../lib/protocol";

export type ConnStatus = "connecting" | "open" | "closed";

export interface VoiceUi {
  active: boolean;
  state: VoiceState;
  /** Live mic input level 0..1 (from the server's VAD). */
  level: number;
  speaking: boolean;
  mode: "live" | "turn-based";
}

export interface StageEntry {
  stage: TurnStage;
  status: "start" | "done";
  detail?: string;
  ms?: number;
  servedBy?: "local" | "remote";
}

export interface UserMsg {
  text: string;
  attachments: { kind: TurnAttachment["kind"]; name: string }[];
  options: TurnOptions;
  /** Filled when voice-in transcription replaced the typed text. */
  transcript?: string;
}

export type AssistantStatus = "pending" | "streaming" | "done" | "refused" | "error";

export interface ServedBy {
  servedBy: "local" | "remote";
  peerKey?: string;
  transportMs?: number;
  warm?: boolean;
  fallback?: boolean;
  reason?: string;
}

export interface AssistantMsg {
  status: AssistantStatus;
  answer: string;
  thinking: string;
  thinkingMs?: number;
  thinkingActive: boolean;
  stages: StageEntry[];
  safety?: { redFlag: boolean; terms: string[]; grounded: boolean; action: string };
  emergency?: string;
  injections: { source: string; patterns: string[] }[];
  servedBy?: ServedBy;
  route?: { candidates: PeerProbeWire[]; chosen?: string; servedBy: "local" | "remote" };
  citations?: { sources: SourceChip[]; cited: string[]; attached?: string; hallucinated: string[] };
  telemetry?: TurnTelemetry;
  localized?: { lang: Lang; text: string };
  audioUrl?: string;
  refusal?: string;
  disclaimer?: string;
  evidence?: string;
  error?: string;
}

export interface Exchange {
  id: string;
  user: UserMsg;
  assistant: AssistantMsg;
}

export function emptyAssistant(): AssistantMsg {
  return {
    status: "pending",
    answer: "",
    thinking: "",
    thinkingActive: false,
    stages: [],
    injections: [],
  };
}

export interface BridgeState {
  status: ConnStatus;
  settings: ServerSettings | null;
  device?: import("../lib/protocol").DeviceInfo;
  models: { key: import("../lib/protocol").ModelKey; label: string }[];
  mesh: import("../lib/protocol").MeshSnapshot | null;
  exchanges: Exchange[];
  /** Bumped whenever a real delegation/fallback/route event arrives, to retrigger mesh animation. */
  meshPulse: number;
  lastDelegation?: { turnId: string; servedBy: "local" | "remote"; peerKey?: string; fallback?: boolean };
  voice: VoiceUi;
}
