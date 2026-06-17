/**
 * engine.ts — the InferenceEngine abstraction + the QVAC-backed LocalEngine.
 *
 * Forward-looking design (the whole point of Day 1):
 *   - Callers depend ONLY on the `InferenceEngine` interface (see types.ts).
 *   - `createEngine()` is the SINGLE place that decides which engine to build.
 *   - Day 2 adds `DelegatedEngine` (P2P) implementing the same interface; it
 *     plugs into the `case "delegated"` branch below. No CLI changes needed.
 *
 * All QVAC specifics (function names, stat field names, profiler) are contained
 * in THIS file so the rest of Lifeline stays SDK-agnostic.
 */
import { performance } from "node:perf_hooks";

import {
  loadModel,
  completion,
  unloadModel,
  close,
  heartbeat,
  profiler,
  LLAMA_3_2_1B_INST_Q4_0,
  MEDGEMMA_4B_IT_Q4_1,
} from "@qvac/sdk";
import type { CompletionStats as QvacStats, LoadModelOptions, ModelProgressUpdate } from "@qvac/sdk";

import type {
  ChatMsg,
  CompletionStats,
  DelegationInfo,
  EngineKind,
  InferenceEngine,
  ModelRef,
  ProgressUpdate,
} from "./types";

/** Models Lifeline knows about (QVAC registry descriptors, or HF/HTTPS GGUF URLs). */
export const MODELS = {
  /** Small, fast default — ~773 MB, downloaded+cached on first run, offline after. */
  llama1b: { label: "Llama 3.2 1B Instruct (Q4_0)", src: LLAMA_3_2_1B_INST_Q4_0, type: "llamacpp-completion" },
  /** MedGemma — medical model from the QVAC registry (baseline for the medical vertical). */
  medgemma4b: { label: "MedGemma 4B IT (Q4_1) — medical", src: MEDGEMMA_4B_IT_Q4_1, type: "llamacpp-completion" },
  /** MedPsy-4B — the medical hero model. Not in the QVAC registry; loaded from HF (GGUF URL).
   *  A chain-of-thought model: we surface the SDK's clean thinking-stripped answer (see
   *  `reasoning`), with a generous `predict` so reasoning + answer both fit. */
  medpsy4b: {
    label: "MedPsy-4B (Q4_K_M) — medical hero",
    src: "https://huggingface.co/qvac/MedPsy-4B-GGUF/resolve/main/medpsy-4b-q4_k_m-imat.gguf",
    type: "llamacpp-completion",
    reasoning: true,
    config: { predict: 768 },
  },
} satisfies Record<string, ModelRef>;

export const DEFAULT_MODEL: ModelRef = MODELS.llama1b;

/** Structural view of a QVAC profiler event (the type isn't re-exported from the SDK root). */
interface ProfRecord {
  ts: number;
  op: string;
  kind: string;
  ms?: number;
  count?: number;
  bytes?: number;
  gauges?: Record<string, number>;
  tags?: Record<string, string>;
}

export interface EngineOptions {
  kind?: EngineKind;
  /** Called with model-download/load progress updates. */
  onProgress?: (p: ProgressUpdate) => void;
  /** Enable the QVAC profiler so SDK-reported timings land in the evidence log. Default true. */
  profile?: boolean;
  // --- delegation (kind === "delegated") ---
  /** Provider public key (hex) to delegate inference to. Required for delegated engines. */
  providerPublicKey?: string;
  /** Delegated request timeout (ms). */
  timeout?: number;
  /** Provider liveness/health-check timeout (ms). */
  healthCheckTimeout?: number;
}

function fromQvacStats(s: QvacStats | undefined): CompletionStats | null {
  if (!s) return null;
  return {
    source: "sdk",
    prompt_tokens: s.promptTokens,
    completion_tokens: s.generatedTokens,
    ttft_ms: s.timeToFirstToken,
    tokens_per_sec: s.tokensPerSecond,
    backend_device: s.backendDevice,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Start a QVAC completion. Shared by Local and Delegated engines (same call shape; the
 *  `delegate` is attached at loadModel time, so completion() is identical for both). */
function startCompletion(modelId: string, messages: ChatMsg[], stream: boolean) {
  const history = messages.map((m) => ({ role: m.role, content: m.content }));
  // captureThinking routes any reasoning to thinkingDelta events so `contentDelta`
  // (what we stream) stays clean even on reasoning models.
  return completion({ modelId, history, stream, captureThinking: true } as Parameters<typeof completion>[0]);
}

/**
 * Stream only the VISIBLE answer content. Reasoning models (e.g. MedPsy) emit
 * chain-of-thought as separate `thinkingDelta` events; we surface `contentDelta`
 * only so callers get the clean answer, not the raw `<think>` reasoning.
 * (For non-reasoning models, all output arrives as contentDelta.)
 */
async function* streamContent(run: ReturnType<typeof completion>): AsyncGenerator<string> {
  for await (const ev of run.events) {
    if (ev.type === "contentDelta") yield ev.text;
  }
}

export class LocalEngine implements InferenceEngine {
  readonly kind = "local" as const;

  private readonly progressCb?: (p: ProgressUpdate) => void;
  private readonly records: ProfRecord[] = [];
  private unsubscribe?: () => void;
  private lastCompletionStats: CompletionStats | null = null;
  private lastLoadGauges: Record<string, number> = {};
  private reasoning = false;

  constructor(opts: EngineOptions = {}) {
    this.progressCb = opts.onProgress;
    if (opts.profile !== false) {
      profiler.enable({ mode: "verbose" });
      this.unsubscribe = profiler.onRecord((e) => {
        this.records.push(e as ProfRecord);
      });
    }
  }

  async loadModel({ model }: { model: ModelRef }): Promise<string> {
    this.reasoning = model.reasoning ?? false;
    const before = this.records.length;
    // SDK boundary: core uses generic ModelRef types; QVAC wants narrower
    // literals (e.g. modelType "llm"). This single cast is where they meet.
    const opts = {
      modelSrc: model.src,
      modelType: model.type,
      ...(model.config ? { modelConfig: model.config } : {}),
      onProgress: (p: ModelProgressUpdate) => this.progressCb?.(p),
    } as unknown as LoadModelOptions;

    const modelId = await loadModel(opts);
    this.lastLoadGauges = this.extractLoadGauges(this.records.slice(before));
    return modelId;
  }

  complete(opts: {
    modelId: string;
    messages: ChatMsg[];
    stream?: boolean;
  }): AsyncIterable<string> | Promise<string> {
    return opts.stream === false ? this.completeOnce(opts) : this.completeStream(opts);
  }

  private async *completeStream(opts: { modelId: string; messages: ChatMsg[] }): AsyncGenerator<string> {
    const run = startCompletion(opts.modelId, opts.messages, true);
    if (this.reasoning) {
      // Reasoning model: contentDelta leaks <think>; emit the SDK's clean final content instead.
      const final = await run.final;
      this.lastCompletionStats = fromQvacStats(final.stats);
      yield final.contentText;
      return;
    }
    yield* streamContent(run);
    const final = await run.final.catch(() => undefined);
    this.lastCompletionStats = fromQvacStats(final?.stats);
  }

  private async completeOnce(opts: { modelId: string; messages: ChatMsg[] }): Promise<string> {
    const run = startCompletion(opts.modelId, opts.messages, false);
    const final = await run.final;
    this.lastCompletionStats = fromQvacStats(final.stats);
    return final.contentText;
  }

  async unload(modelId: string): Promise<void> {
    await unloadModel({ modelId });
  }

  lastStats(): CompletionStats | null {
    return this.lastCompletionStats;
  }

  delegationInfo(): DelegationInfo {
    return { served_by: "local" };
  }

  /** SDK-reported load/download gauges captured by the profiler during the last loadModel(). */
  loadStats(): Record<string, number> {
    return this.lastLoadGauges;
  }

  /** Full QVAC profiler snapshot for the evidence log, or null if profiling is off. */
  profilerSnapshot(): unknown {
    return profiler.isEnabled() ? profiler.exportJSON({ includeRecentEvents: true }) : null;
  }

  /** Detach the profiler listener, stop profiling, and shut down the QVAC worker. */
  async dispose(): Promise<void> {
    this.unsubscribe?.();
    profiler.disable();
    // Terminate the SDK's background worker so it can't outlive this process
    // and hold the model-registry lock (which would block the next run).
    await close().catch(() => {});
  }

  private extractLoadGauges(records: ProfRecord[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of records) {
      // QVAC reports load timing on the loadModel handler event (kind "handler"),
      // plus any dedicated load/download-kind events.
      const isLoad = r.op === "loadModel" || r.kind === "load" || r.kind === "download";
      if (!isLoad) continue;
      if (typeof r.ms === "number") out[`${r.op}_ms`] = r.ms;
      if (r.gauges) for (const [k, v] of Object.entries(r.gauges)) out[k] = v;
    }
    return out;
  }
}

/**
 * DelegatedEngine — runs inference on a remote QVAC provider over Holepunch P2P,
 * with transparent fallback to a local engine when the provider is unreachable.
 *
 * Same `InferenceEngine` interface as LocalEngine, so the CLI can't tell them
 * apart. We manage fallback explicitly (heartbeat probe → local) rather than
 * relying solely on the SDK's `delegate.fallbackToLocal`, so the evidence log
 * records exactly where each request was served.
 */
export class DelegatedEngine implements InferenceEngine {
  readonly kind = "delegated" as const;

  private readonly providerPublicKey: string;
  private readonly timeout?: number;
  private readonly healthCheckTimeout: number;
  private readonly progressCb?: (p: ProgressUpdate) => void;
  private readonly enableProfile: boolean;

  private remoteModelId?: string;
  private local?: LocalEngine; // created only on fallback
  private servedBy: "remote" | "local" = "remote";
  private transportSetupMs = 0;
  private fallbackReason?: string;
  private lastCompletionStats: CompletionStats | null = null;
  private reasoning = false;

  constructor(opts: EngineOptions) {
    if (!opts.providerPublicKey) {
      throw new Error("DelegatedEngine requires opts.providerPublicKey (provider's hex public key).");
    }
    this.providerPublicKey = opts.providerPublicKey;
    this.timeout = opts.timeout;
    // First DHT holepunch to a fresh peer can take several seconds; be generous
    // so we actually delegate instead of prematurely falling back to local.
    this.healthCheckTimeout = opts.healthCheckTimeout ?? 20000;
    this.progressCb = opts.onProgress;
    this.enableProfile = opts.profile !== false;
    if (this.enableProfile) profiler.enable({ mode: "verbose" });
  }

  async loadModel({ model }: { model: ModelRef }): Promise<string> {
    this.reasoning = model.reasoning ?? false;
    // 1) Liveness probe — also establishes/warms the P2P link. Time it as transport setup.
    const t0 = performance.now();
    let online = false;
    try {
      await heartbeat({ delegate: { providerPublicKey: this.providerPublicKey, timeout: this.healthCheckTimeout } });
      online = true;
    } catch (err) {
      this.fallbackReason = `provider heartbeat failed: ${errMsg(err)}`;
    }
    this.transportSetupMs = performance.now() - t0;

    if (!online) return this.fallbackLoad(model);

    // 2) Delegated load — the provider loads/serves the model.
    try {
      const opts = {
        modelSrc: model.src,
        modelType: model.type,
        ...(model.config ? { modelConfig: model.config } : {}),
        delegate: {
          providerPublicKey: this.providerPublicKey,
          ...(this.timeout ? { timeout: this.timeout } : {}),
          healthCheckTimeout: this.healthCheckTimeout,
          // We manage fallback ourselves (below) for accurate evidence.
          fallbackToLocal: false,
        },
        onProgress: (p: ModelProgressUpdate) => this.progressCb?.(p),
      } as unknown as LoadModelOptions;
      this.remoteModelId = await loadModel(opts);
      this.servedBy = "remote";
      return this.remoteModelId;
    } catch (err) {
      this.fallbackReason = `delegated loadModel failed: ${errMsg(err)}`;
      return this.fallbackLoad(model);
    }
  }

  private async fallbackLoad(model: ModelRef): Promise<string> {
    this.servedBy = "local";
    // Reuse the already-enabled global profiler; don't double-subscribe.
    this.local = new LocalEngine({ onProgress: this.progressCb, profile: false });
    return this.local.loadModel({ model });
  }

  complete(opts: {
    modelId: string;
    messages: ChatMsg[];
    stream?: boolean;
  }): AsyncIterable<string> | Promise<string> {
    if (this.servedBy === "local" && this.local) return this.local.complete(opts);
    return opts.stream === false ? this.completeOnce(opts) : this.completeStream(opts);
  }

  private async *completeStream(opts: { modelId: string; messages: ChatMsg[] }): AsyncGenerator<string> {
    const run = startCompletion(opts.modelId, opts.messages, true);
    if (this.reasoning) {
      const final = await run.final;
      this.lastCompletionStats = fromQvacStats(final.stats);
      yield final.contentText;
      return;
    }
    yield* streamContent(run);
    const final = await run.final.catch(() => undefined);
    this.lastCompletionStats = fromQvacStats(final?.stats);
  }

  private async completeOnce(opts: { modelId: string; messages: ChatMsg[] }): Promise<string> {
    const run = startCompletion(opts.modelId, opts.messages, false);
    const final = await run.final;
    this.lastCompletionStats = fromQvacStats(final.stats);
    return final.contentText;
  }

  async unload(modelId: string): Promise<void> {
    if (this.servedBy === "local" && this.local) return this.local.unload(modelId);
    await unloadModel({ modelId });
  }

  lastStats(): CompletionStats | null {
    if (this.servedBy === "local" && this.local) return this.local.lastStats?.() ?? null;
    return this.lastCompletionStats;
  }

  delegationInfo(): DelegationInfo {
    return {
      served_by: this.servedBy,
      peer_key: this.providerPublicKey,
      transport_setup_ms: this.transportSetupMs,
      ...(this.fallbackReason ? { fallback_reason: this.fallbackReason } : {}),
    };
  }

  loadStats(): Record<string, number> {
    // Remote load gauges live on the provider; locally we only see them on fallback.
    if (this.servedBy === "local" && this.local) return this.local.loadStats?.() ?? {};
    return {};
  }

  profilerSnapshot(): unknown {
    return this.enableProfile && profiler.isEnabled()
      ? profiler.exportJSON({ includeRecentEvents: true })
      : null;
  }

  async dispose(): Promise<void> {
    try {
      profiler.disable();
    } catch {
      /* ignore */
    }
    // Same process/worker whether we delegated or fell back, so one close() suffices.
    await close().catch(() => {});
  }
}

/**
 * The ONE place that chooses an engine. The CLI calls only this + the interface.
 */
export function createEngine(opts: EngineOptions = {}): InferenceEngine {
  const kind = opts.kind ?? "local";
  switch (kind) {
    case "local":
      return new LocalEngine(opts);
    case "delegated":
      return new DelegatedEngine(opts);
    default:
      throw new Error(`Unknown engine kind: ${String(kind)}`);
  }
}
