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
export interface BenchEvent {
  type: "bench";
  ts: string;
  prompt: string;
  topic?: string;
  local: BenchRow;
  delegated: BenchRow;
}

export type EvidenceEvent =
  | SessionEvent
  | ModelLoadEvent
  | InferenceEvent
  | ModelUnloadEvent
  | SdkProfileEvent
  | DelegationEvent
  | FallbackEvent
  | BenchEvent;

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

  bench(args: Omit<BenchEvent, "type" | "ts">): void {
    this.write({ type: "bench", ts: new Date().toISOString(), ...args });
  }

  /** Latest event of a given type, for building the human-readable summary. */
  latest<T extends EvidenceEvent["type"]>(type: T): Extract<EvidenceEvent, { type: T }> | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].type === type) return this.events[i] as Extract<EvidenceEvent, { type: T }>;
    }
    return undefined;
  }
}
