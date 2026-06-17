/**
 * Lifeline core types — deliberately SDK-agnostic.
 *
 * The CLI (and every future caller) depends ONLY on these types and on the
 * `InferenceEngine` interface. Nothing here imports `@qvac/sdk`, so swapping a
 * local engine for a delegated (P2P) one on Day 2 requires zero caller changes.
 */

export type Role = "system" | "user" | "assistant";

export interface ChatMsg {
  role: Role;
  content: string;
}

/**
 * Where a model's weights come from. Passed straight through to the backend
 * (QVAC `modelSrc`): a built-in descriptor object, a local file path, an
 * http(s) URL, or a `registry://` / `pear://` key. Kept as an opaque union so
 * core does not depend on the SDK's concrete descriptor type.
 */
export type ModelSrc = string | Record<string, unknown>;

/** A model the engine can load, plus metadata for evidence logging. */
export interface ModelRef {
  /** Human-readable label that lands in the evidence log. */
  label: string;
  /** Backend model source (QVAC `modelSrc`). */
  src: ModelSrc;
  /** Backend model type, e.g. "llm". */
  type: string;
  /** Optional backend `modelConfig` (ctx_size, temp, predict, ...). */
  config?: Record<string, unknown>;
  /**
   * True for chain-of-thought models (e.g. MedPsy). Their live token stream
   * includes `<think>` reasoning; the engine instead emits the SDK's clean,
   * thinking-stripped final content for these (a brief pause, then the answer).
   */
  reasoning?: boolean;
}

/**
 * Normalized per-completion stats. `source` records whether the numbers were
 * reported BY THE SDK or MEASURED BY US — the hackathon grading asks for this
 * distinction explicitly.
 */
export interface CompletionStats {
  source: "sdk" | "measured";
  prompt_tokens?: number;
  completion_tokens?: number;
  ttft_ms?: number;
  tokens_per_sec?: number;
  total_ms?: number;
  /** SDK-reported compute backend for this inference: "cpu" | "gpu". */
  backend_device?: string;
}

/** Model download/load progress, surfaced to callers without leaking SDK types. */
export interface ProgressUpdate {
  phase?: string;
  /** 0..1 when the backend reports it. */
  progress?: number;
  [k: string]: unknown;
}

export type EngineKind = "local" | "delegated";

/**
 * Where the most recent operation was actually served, plus P2P transport detail.
 * Engine-neutral so the CLI can log delegation evidence without knowing the engine type.
 */
export interface DelegationInfo {
  served_by: "local" | "remote";
  /** Provider public key (hex) when served remotely. */
  peer_key?: string;
  /** Time to establish/verify the P2P link (ms). */
  transport_setup_ms?: number;
  /** Set when a delegated request fell back to local. */
  fallback_reason?: string;
}

/**
 * The one boundary the whole app is built around.
 *
 * Day 1 ships `LocalEngine` (QVAC-backed, on-device). Day 2 adds
 * `DelegatedEngine` implementing this SAME interface, so the CLI never learns
 * which one it's talking to. See `createEngine()` in `engine.ts` for the single
 * place that decides.
 */
export interface InferenceEngine {
  readonly kind: EngineKind;

  loadModel(opts: { model: ModelRef }): Promise<string /* modelId */>;

  complete(opts: {
    modelId: string;
    messages: ChatMsg[];
    stream?: boolean;
  }): AsyncIterable<string> | Promise<string>;

  unload(modelId: string): Promise<void>;

  // --- optional, engine-neutral evidence surface (callers use if present) ---

  /** SDK-reported stats from the most recent completion, if the engine surfaced them. */
  lastStats?(): CompletionStats | null;
  /** Where the last op was served (local vs remote) + P2P transport detail. */
  delegationInfo?(): DelegationInfo | null;
  /** SDK-reported load/download timing gauges from the most recent loadModel(). */
  loadStats?(): Record<string, number>;
  /** Engine/SDK profiler snapshot to embed in the evidence log. */
  profilerSnapshot?(): unknown;
  /** Release engine resources (SDK worker, profiler listeners, P2P sessions, ...). */
  dispose?(): void | Promise<void>;
}
