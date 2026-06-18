/**
 * Lifeline core types — deliberately SDK-agnostic.
 *
 * The CLI (and every other caller) depends only on these types and on the
 * `InferenceEngine` interface. Nothing here imports `@qvac/sdk`, so a local
 * engine and a delegated (P2P) one are interchangeable to callers.
 */

export type Role = "system" | "user" | "assistant";

/** An image (or other media) attached to a chat turn for multimodal models. */
export interface Attachment {
  path: string;
}

export interface ChatMsg {
  role: Role;
  content: string;
  /** Image attachments for multimodal turns (QVAC `history[].attachments`). */
  attachments?: Attachment[];
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
  /** Multimodal projection model (QVAC `modelConfig.projectionModelSrc`) for vision models. */
  projection?: ModelSrc;
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

/** Timing split for a completion, distinguishing reasoning from answer latency. */
export interface CompletionTiming {
  /** ms spent emitting reasoning before the first answer token (0 if no reasoning). */
  thinking_ms: number;
  /** ms from request start to the first ANSWER (content) token. */
  ttft_content_ms: number;
  /** Answer-only token count (contentDelta events) — excludes reasoning. */
  content_tokens: number;
  /** Reasoning token count (thinkingDelta events). */
  thinking_tokens: number;
}

/**
 * Where the most recent operation was actually served, plus P2P transport detail.
 * Engine-neutral so the CLI can log delegation evidence without knowing the engine type.
 */
/** One peer's liveness-probe result during mesh routing. */
export interface PeerProbe {
  peer_key: string;
  label?: string;
  ok: boolean;
  probe_ms: number;
  error?: string;
}

export interface DelegationInfo {
  served_by: "local" | "remote";
  /** Provider public key (hex) when served remotely. */
  peer_key?: string;
  /** Time to establish/verify the P2P link (ms). */
  transport_setup_ms?: number;
  /** Set when a delegated request fell back to local. */
  fallback_reason?: string;
  /** Mesh routing: candidate peers probed (in preference order) and which one won. */
  route?: { candidates: PeerProbe[]; chosen?: string };
}

/**
 * The one boundary the whole app is built around.
 *
 * `LocalEngine` (on-device) and `DelegatedEngine` (P2P) both implement this
 * interface, so the CLI never learns which one it's talking to. See
 * `createEngine()` in `engine.ts` for the single place that decides.
 */
export interface InferenceEngine {
  readonly kind: EngineKind;

  loadModel(opts: { model: ModelRef }): Promise<string /* modelId */>;

  complete(opts: {
    modelId: string;
    messages: ChatMsg[];
    stream?: boolean;
    /**
     * KV-cache policy for this completion. `false` (the default) makes the turn
     * STATELESS — the model processes only the given history, so a long-lived
     * (warm) model can serve independent turns back-to-back without context
     * bleed or CONTEXT_OVERFLOW, and without a worker teardown between turns.
     * `true` reuses an auto-keyed cache; a string pins an explicit cache key.
     */
    kvCache?: boolean | string;
    /** Called with reasoning deltas (kept OUT of the streamed answer) for reasoning models. */
    onThinking?: (delta: string) => void;
  }): AsyncIterable<string> | Promise<string>;

  unload(modelId: string): Promise<void>;

  // --- optional, engine-neutral evidence surface (callers use if present) ---

  /** SDK-reported stats from the most recent completion, if the engine surfaced them. */
  lastStats?(): CompletionStats | null;
  /** Thinking-vs-content timing split for the most recent completion. */
  lastTiming?(): CompletionTiming | null;
  /** Reasoning text (aside) from the most recent completion, if any. */
  lastThinking?(): string;
  /** Where the last op was served (local vs remote) + P2P transport detail. */
  delegationInfo?(): DelegationInfo | null;
  /** SDK-reported load/download timing gauges from the most recent loadModel(). */
  loadStats?(): Record<string, number>;
  /** Engine/SDK profiler snapshot to embed in the evidence log. */
  profilerSnapshot?(): unknown;
  /** Release engine resources (SDK worker, profiler listeners, P2P sessions, ...). */
  dispose?(): void | Promise<void>;
}
