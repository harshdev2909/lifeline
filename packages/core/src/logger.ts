/**
 * logger.ts — RunLogger writes one structured, auditable JSONL evidence file
 * per run to `evidence/run-<ISO>.jsonl`, one event per line.
 *
 * Event lines (discriminated by `type`):
 *   session       — sysinfo + engine + runId
 *   model_load    — modelId, source, load_ms (measured) + optional SDK timing
 *   inference     — prompt/completion tokens, TTFT, tokens/sec, total (measured + SDK-reported)
 *   model_unload  — modelId
 *   sdk_profile   — full QVAC profiler.exportJSON() snapshot
 *
 * Every numeric field is labelled as MEASURED (by us, wall-clock) or
 * SDK-REPORTED (from QVAC), per the hackathon grading requirement.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CompletionStats } from "./types";
import type { SysInfo } from "./sysinfo";

export interface MeasuredInference {
  ttft_ms: number;
  total_ms: number;
  tokens_per_sec: number;
  completion_tokens: number;
  /** Time to first ANSWER (content) token — distinct from thinking for reasoning models. */
  ttft_content_ms?: number;
  /** ms spent on reasoning before the answer (0/absent for non-reasoning models). */
  thinking_ms?: number;
  /** Reasoning length (chars), captured as an aside (not shown in the answer). */
  thinking_chars?: number;
}

export interface SessionEvent {
  type: "session";
  ts: string;
  runId: string;
  engine: string;
  sysinfo: SysInfo;
}
export interface ModelLoadEvent {
  type: "model_load";
  ts: string;
  modelId: string;
  source: string;
  label: string;
  /** Wall-clock load time MEASURED by us. */
  load_ms: number;
  measured_by: "wall_clock";
  /** True when a warm (already-loaded) model was reused — load_ms is then ~0. */
  warm?: boolean;
  /** SDK-reported load/download gauges, when the profiler captured them. */
  sdk_load?: Record<string, number>;
}
export interface InferenceEvent {
  type: "inference";
  ts: string;
  modelId: string;
  prompt_chars: number;
  /** MEASURED by us (wall-clock + counted tokens). */
  measured: MeasuredInference;
  /** SDK-REPORTED stats from QVAC's completion `final.stats`, if available. */
  sdk_reported: CompletionStats | null;
  /** Convenience copy of the authoritative compute backend, if SDK reported it. */
  backend_device?: string;
  prompt_tokens?: number;
}
export interface ModelUnloadEvent {
  type: "model_unload";
  ts: string;
  modelId: string;
}
export interface SdkProfileEvent {
  type: "sdk_profile";
  ts: string;
  export: unknown;
}

/** One side of a local-vs-delegated benchmark row. */
export interface BenchRow {
  served_by: "local" | "remote";
  load_ms?: number;
  transport_setup_ms?: number;
  ttft_ms?: number;
  tokens_per_sec?: number;
  completion_tokens?: number;
  total_ms?: number;
  backend_device?: string;
  error?: string;
}

export interface DelegationEvent {
  type: "delegation";
  ts: string;
  topic?: string;
  peer_key: string;
  transport_setup_ms: number;
  /** true if verified in code; otherwise "per-docs" (Holepunch Noise/UDX E2E, DHT for discovery only). */
  e2e_encrypted: boolean | "per-docs";
  served_by: "remote";
  modelId: string;
  ttft_ms?: number;
  tokens_per_sec?: number;
  completion_tokens?: number;
}
export interface FallbackEvent {
  type: "fallback";
  ts: string;
  reason: string;
  from: "remote";
  served_by: "local";
  topic?: string;
  peer_key?: string;
}
/** Mesh-aware routing: which candidate peers were probed and which one won (or local). */
export interface RoutingEvent {
  type: "routing";
  ts: string;
  topic?: string;
  candidates: Array<{ peer_key: string; label?: string; ok: boolean; probe_ms: number; error?: string }>;
  chosen?: string;
  served_by: "remote" | "local";
}
export interface BenchEvent {
  type: "bench";
  ts: string;
  prompt: string;
  topic?: string;
  local: BenchRow;
  delegated: BenchRow;
}

export interface RagIngestEvent {
  type: "rag_ingest";
  ts: string;
  workspace: string;
  doc_count: number;
  chunk_count: number;
  embed_model: string;
  ingest_ms: number;
}
export interface RagSearchEvent {
  type: "rag_search";
  ts: string;
  query: string;
  topK: number;
  results: Array<{ source: string; section: string; score: number; chars: number }>;
  search_ms: number;
}
export interface SafetyEvent {
  type: "safety";
  ts: string;
  red_flag: boolean;
  red_flag_terms: string[];
  grounded: boolean;
  action: string;
}
export interface GroundingCheckEvent {
  type: "grounding_check";
  ts: string;
  /** Citation tags the model emitted (e.g. ["S1","S3"]). */
  cited: string[];
  /** Citation tags that were actually retrieved this turn. */
  retrieved: string[];
  /** Cited tags NOT retrieved this turn — hallucinated/invalid citations. */
  hallucinated_cites: string[];
}
export interface InjectionGuardEvent {
  type: "injection_guard";
  ts: string;
  source: "rag" | "ocr" | "vision" | "delegated";
  detected: boolean;
  patterns: string[];
  /** What we did: untrusted text is always fenced; detection adds a flag. */
  action: string;
}
export interface SttEvent {
  type: "stt";
  ts: string;
  model: string;
  audio_seconds?: number;
  transcribe_ms: number;
  text_chars: number;
}
export interface TranslationEvent {
  type: "translation";
  ts: string;
  direction: string;
  src_lang: string;
  tgt_lang: string;
  chars: number;
  ms: number;
}
export interface OcrEvent {
  type: "ocr";
  ts: string;
  model: string;
  image: string;
  block_count: number;
  text_chars: number;
  ocr_ms: number;
}
export interface VisionEvent {
  type: "vision";
  ts: string;
  model: string;
  image: string;
  findings_chars: number;
  ttfc_ms?: number;
  total_ms: number;
  served_by: string;
}
export interface TtsEvent {
  type: "tts";
  ts: string;
  model: string;
  engine?: string;
  chars: number;
  synth_ms: number;
  out_path: string;
  sample_rate?: number;
}

export interface MedbenchRow {
  model: string;
  question: string;
  /** time to first ANSWER token (ms) */
  ttft_content_ms?: number;
  /** answer-only tokens (excludes reasoning) */
  answer_tokens?: number;
  /** reasoning tokens (separate from the answer) */
  thinking_tokens?: number;
  answer_tokens_per_sec?: number;
  total_ms: number;
  backend_device?: string;
  /** grounded-correctness: expected facts matched / total, + which */
  correct?: number;
  expected?: number;
  matched?: string[];
  missed?: string[];
  answer: string;
}
export interface MedbenchEvent {
  type: "medbench";
  ts: string;
  corpus: string;
  embed_model: string;
  note: string;
  rows: MedbenchRow[];
}

export interface VoiceTurnEvent {
  type: "voice_turn";
  ts: string;
  /** Trailing silence (ms) that ended the user's turn (VAD endpoint). */
  endpoint_silence_ms?: number;
  /** Per-stage split, all measured by us (wall-clock). */
  stt_ms?: number;
  llm_ttft_ms?: number;
  llm_ms?: number;
  tts_ms?: number;
  /** True if the assistant was interrupted (barge-in) and what was cancelled. */
  barge_in?: boolean;
  cancelled?: string[];
  served_by: "local" | "remote";
  transcript_chars: number;
  answer_chars: number;
}

export type EvidenceEvent =
  | SessionEvent
  | VoiceTurnEvent
  | ModelLoadEvent
  | InferenceEvent
  | ModelUnloadEvent
  | SdkProfileEvent
  | DelegationEvent
  | FallbackEvent
  | RoutingEvent
  | BenchEvent
  | RagIngestEvent
  | RagSearchEvent
  | SafetyEvent
  | GroundingCheckEvent
  | InjectionGuardEvent
  | SttEvent  | TranslationEvent
  | OcrEvent
  | VisionEvent
  | TtsEvent
  | MedbenchEvent;

function defaultEvidenceDir(): string {
  if (process.env.LIFELINE_EVIDENCE_DIR) return process.env.LIFELINE_EVIDENCE_DIR;
  // this file: <repo>/packages/core/src/logger.ts  ->  <repo>/evidence
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..", "evidence");
}

export class RunLogger {
  readonly runId: string;
  readonly path: string;
  private readonly events: EvidenceEvent[] = [];

  constructor(opts: { dir?: string; runId?: string } = {}) {
    const startedAt = new Date().toISOString();
    this.runId = opts.runId ?? startedAt;
    const dir = opts.dir ?? defaultEvidenceDir();
    mkdirSync(dir, { recursive: true });
    const safe = startedAt.replace(/[:.]/g, "-");
    this.path = join(dir, `run-${safe}.jsonl`);
  }

  private write(ev: EvidenceEvent): void {
    this.events.push(ev);
    appendFileSync(this.path, JSON.stringify(ev) + "\n", "utf8");
  }

  session(engine: string, sysinfo: SysInfo): void {
    this.write({ type: "session", ts: new Date().toISOString(), runId: this.runId, engine, sysinfo });
  }

  modelLoad(args: {
    modelId: string;
    source: string;
    label: string;
    load_ms: number;
    warm?: boolean;
    sdk_load?: Record<string, number>;
  }): void {
    this.write({
      type: "model_load",
      ts: new Date().toISOString(),
      measured_by: "wall_clock",
      ...args,
    });
  }

  inference(args: {
    modelId: string;
    prompt_chars: number;
    prompt_tokens?: number;
    measured: MeasuredInference;
    sdk_reported: CompletionStats | null;
  }): void {
    this.write({
      type: "inference",
      ts: new Date().toISOString(),
      backend_device: args.sdk_reported?.backend_device,
      ...args,
    });
  }

  modelUnload(modelId: string): void {
    this.write({ type: "model_unload", ts: new Date().toISOString(), modelId });
  }

  sdkProfile(profileExport: unknown): void {
    if (!profileExport) return;
    this.write({ type: "sdk_profile", ts: new Date().toISOString(), export: profileExport });
  }

  delegation(args: Omit<DelegationEvent, "type" | "ts" | "served_by">): void {
    this.write({ type: "delegation", ts: new Date().toISOString(), served_by: "remote", ...args });
  }

  fallback(args: Omit<FallbackEvent, "type" | "ts" | "from" | "served_by">): void {
    this.write({ type: "fallback", ts: new Date().toISOString(), from: "remote", served_by: "local", ...args });
  }

  routing(args: Omit<RoutingEvent, "type" | "ts">): void {
    this.write({ type: "routing", ts: new Date().toISOString(), ...args });
  }

  bench(args: Omit<BenchEvent, "type" | "ts">): void {
    this.write({ type: "bench", ts: new Date().toISOString(), ...args });
  }

  ragIngest(args: Omit<RagIngestEvent, "type" | "ts">): void {
    this.write({ type: "rag_ingest", ts: new Date().toISOString(), ...args });
  }

  ragSearch(args: Omit<RagSearchEvent, "type" | "ts">): void {
    this.write({ type: "rag_search", ts: new Date().toISOString(), ...args });
  }

  safety(args: Omit<SafetyEvent, "type" | "ts">): void {
    this.write({ type: "safety", ts: new Date().toISOString(), ...args });
  }

  groundingCheck(args: Omit<GroundingCheckEvent, "type" | "ts">): void {
    this.write({ type: "grounding_check", ts: new Date().toISOString(), ...args });
  }

  injectionGuard(args: Omit<InjectionGuardEvent, "type" | "ts">): void {
    this.write({ type: "injection_guard", ts: new Date().toISOString(), ...args });
  }

  stt(args: Omit<SttEvent, "type" | "ts">): void {
    this.write({ type: "stt", ts: new Date().toISOString(), ...args });
  }

  vision(args: Omit<VisionEvent, "type" | "ts">): void {
    this.write({ type: "vision", ts: new Date().toISOString(), ...args });
  }

  translation(args: Omit<TranslationEvent, "type" | "ts">): void {
    this.write({ type: "translation", ts: new Date().toISOString(), ...args });
  }

  ocr(args: Omit<OcrEvent, "type" | "ts">): void {
    this.write({ type: "ocr", ts: new Date().toISOString(), ...args });
  }

  tts(args: Omit<TtsEvent, "type" | "ts">): void {
    this.write({ type: "tts", ts: new Date().toISOString(), ...args });
  }

  medbench(args: Omit<MedbenchEvent, "type" | "ts">): void {
    this.write({ type: "medbench", ts: new Date().toISOString(), ...args });
  }

  voiceTurn(args: Omit<VoiceTurnEvent, "type" | "ts">): void {
    this.write({ type: "voice_turn", ts: new Date().toISOString(), ...args });
  }

  /** Latest event of a given type, for building the human-readable summary. */
  latest<T extends EvidenceEvent["type"]>(type: T): Extract<EvidenceEvent, { type: T }> | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].type === type) return this.events[i] as Extract<EvidenceEvent, { type: T }>;
    }
    return undefined;
  }
}
