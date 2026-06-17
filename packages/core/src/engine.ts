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
  cancel,
  heartbeat,
  profiler,
  LLAMA_3_2_1B_INST_Q4_0,
  MEDGEMMA_4B_IT_Q4_1,
  SMOLVLM2_500M_MULTIMODAL_Q8_0,
  MMPROJ_SMOLVLM2_500M_MULTIMODAL_Q8_0,
} from "@qvac/sdk";
import type { CompletionStats as QvacStats, LoadModelOptions, ModelProgressUpdate } from "@qvac/sdk";

import type {
  ChatMsg,
  CompletionStats,
  CompletionTiming,
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
  medgemma4b: { label: "MedGemma 4B IT (Q4_1) — medical", src: MEDGEMMA_4B_IT_Q4_1, type: "llamacpp-completion", config: { ctx_size: 8192 } },
  /** MedPsy-4B — the medical hero model. Not in the QVAC registry; loaded from HF (GGUF URL).
   *  A chain-of-thought model: we surface the SDK's clean thinking-stripped answer (see
   *  `reasoning`), with a generous `predict` so reasoning + answer both fit. */
  medpsy4b: {
    label: "MedPsy-4B (Q4_K_M) — medical hero",
    src: "https://huggingface.co/qvac/MedPsy-4B-GGUF/resolve/main/medpsy-4b-q4_k_m-imat.gguf",
    type: "llamacpp-completion",
    reasoning: true,
    config: { predict: 768, ctx_size: 8192 },
  },
  /** SmolVLM2-500M multimodal — describes images (vision). Light enough to delegate to a peer. */
  vision: {
    label: "SmolVLM2-500M (multimodal)",
    src: SMOLVLM2_500M_MULTIMODAL_Q8_0,
    type: "llamacpp-completion",
    projection: MMPROJ_SMOLVLM2_500M_MULTIMODAL_Q8_0,
    config: { ctx_size: 1024 },
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
  /** Watchdog: max ms to wait for the FIRST delegated event before falling back. */
  firstEventMs?: number;
  /** Watchdog: max ms of mid-stream silence before declaring the provider stalled. */
  streamStallMs?: number;
  /** TEST/fault-injection: force the delegated stream to stall, to exercise fallback. */
  simulateStall?: boolean;
}

/** Thrown by the delegated watchdog when the remote stream goes silent. */
class StallError extends Error {
  constructor(readonly reason: "no_first_token" | "stream_stalled") {
    super(reason);
    this.name = "StallError";
  }
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

/** Build the QVAC `modelConfig`, folding in a multimodal projection model if present. */
function modelConfigFor(model: ModelRef): Record<string, unknown> | undefined {
  const cfg: Record<string, unknown> = { ...(model.config ?? {}) };
  if (model.projection) cfg.projectionModelSrc = model.projection;
  return Object.keys(cfg).length ? cfg : undefined;
}

/** Start a QVAC completion. Shared by Local and Delegated engines (same call shape; the
 *  `delegate` is attached at loadModel time, so completion() is identical for both). */
function startCompletion(modelId: string, messages: ChatMsg[], stream: boolean) {
  const history = messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.attachments && m.attachments.length ? { attachments: m.attachments } : {}),
  }));
  // captureThinking routes any reasoning to thinkingDelta events so `contentDelta`
  // (what we stream) stays clean even on reasoning models.
  return completion({ modelId, history, stream, captureThinking: true } as Parameters<typeof completion>[0]);
}

interface StreamOut {
  thinking_ms: number;
  ttft_content_ms: number;
  content_tokens: number;
  thinking_tokens: number;
  thinkingText: string;
  stats: CompletionStats | null;
}

/**
 * Consume `run.events` (the canonical API): yield ANSWER tokens (`contentDelta`)
 * live, route reasoning (`thinkingDelta`) to `onThinking` (kept out of the answer),
 * and record the thinking-vs-content timing split + final stats into `out`.
 * Works identically for reasoning models (MedPsy → captureThinking routes its
 * `<think>` to thinkingDelta) and non-reasoning models (all contentDelta).
 */
async function* runEvents(
  run: ReturnType<typeof completion>,
  onThinking: ((d: string) => void) | undefined,
  out: StreamOut,
): AsyncGenerator<string> {
  const t0 = performance.now();
  let firstThinkAt = 0;
  let firstContentAt = 0;
  for await (const ev of run.events) {
    if (ev.type === "thinkingDelta") {
      if (!firstThinkAt) firstThinkAt = performance.now();
      out.thinking_tokens++;
      onThinking?.(ev.text);
    } else if (ev.type === "contentDelta") {
      if (!firstContentAt) firstContentAt = performance.now();
      out.content_tokens++;
      yield ev.text;
    }
  }
  const final = await run.final.catch(() => undefined);
  out.stats = fromQvacStats(final?.stats);
  out.thinkingText = final?.thinkingText ?? "";
  out.ttft_content_ms = firstContentAt ? Math.round(firstContentAt - t0) : 0;
  out.thinking_ms = firstThinkAt ? Math.round((firstContentAt || performance.now()) - firstThinkAt) : 0;
}

const emptyOut = (): StreamOut => ({
  thinking_ms: 0,
  ttft_content_ms: 0,
  content_tokens: 0,
  thinking_tokens: 0,
  thinkingText: "",
  stats: null,
});

export class LocalEngine implements InferenceEngine {
  readonly kind = "local" as const;

  private readonly progressCb?: (p: ProgressUpdate) => void;
  private readonly records: ProfRecord[] = [];
  private unsubscribe?: () => void;
  private lastCompletionStats: CompletionStats | null = null;
  private lastLoadGauges: Record<string, number> = {};
  private lastTimingVal: CompletionTiming | null = null;
  private lastThinkingText = "";

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
    const before = this.records.length;
    // SDK boundary: core uses generic ModelRef types; QVAC wants narrower
    // literals (e.g. modelType "llm"). This single cast is where they meet.
    const opts = {
      modelSrc: model.src,
      modelType: model.type,
      ...(modelConfigFor(model) ? { modelConfig: modelConfigFor(model) } : {}),
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
    onThinking?: (delta: string) => void;
  }): AsyncIterable<string> | Promise<string> {
    return opts.stream === false ? this.completeOnce(opts) : this.completeStream(opts);
  }

  private async *completeStream(opts: {
    modelId: string;
    messages: ChatMsg[];
    onThinking?: (delta: string) => void;
  }): AsyncGenerator<string> {
    const run = startCompletion(opts.modelId, opts.messages, true);
    const out = emptyOut();
    yield* runEvents(run, opts.onThinking, out);
    this.lastCompletionStats = out.stats;
    this.lastThinkingText = out.thinkingText;
    this.lastTimingVal = {
      thinking_ms: out.thinking_ms,
      ttft_content_ms: out.ttft_content_ms,
      content_tokens: out.content_tokens,
      thinking_tokens: out.thinking_tokens,
    };
  }

  private async completeOnce(opts: { modelId: string; messages: ChatMsg[] }): Promise<string> {
    const run = startCompletion(opts.modelId, opts.messages, false);
    const final = await run.final;
    this.lastCompletionStats = fromQvacStats(final.stats);
    this.lastThinkingText = final.thinkingText ?? "";
    return final.contentText;
  }

  async unload(modelId: string): Promise<void> {
    await unloadModel({ modelId });
  }

  lastStats(): CompletionStats | null {
    return this.lastCompletionStats;
  }

  lastTiming(): CompletionTiming | null {
    return this.lastTimingVal;
  }

  lastThinking(): string {
    return this.lastThinkingText;
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
  private readonly firstEventMs: number;
  private readonly streamStallMs: number;
  private readonly simulateStall: boolean;
  private readonly progressCb?: (p: ProgressUpdate) => void;
  private readonly enableProfile: boolean;

  private remoteModelId?: string;
  private local?: LocalEngine; // created only on fallback
  private localModelId?: string;
  private lastModel?: ModelRef;
  private lastReqId?: string;
  private servedBy: "remote" | "local" = "remote";
  private transportSetupMs = 0;
  private fallbackReason?: string;
  private lastCompletionStats: CompletionStats | null = null;
  private lastTimingVal: CompletionTiming | null = null;
  private lastThinkingText = "";

  constructor(opts: EngineOptions) {
    if (!opts.providerPublicKey) {
      throw new Error("DelegatedEngine requires opts.providerPublicKey (provider's hex public key).");
    }
    this.providerPublicKey = opts.providerPublicKey;
    this.timeout = opts.timeout;
    // First DHT holepunch to a fresh peer can take several seconds; be generous
    // so we actually delegate instead of prematurely falling back to local.
    this.healthCheckTimeout = opts.healthCheckTimeout ?? 20000;
    this.firstEventMs = opts.firstEventMs ?? 25000;
    this.streamStallMs = opts.streamStallMs ?? 8000;
    this.simulateStall = opts.simulateStall ?? false;
    this.progressCb = opts.onProgress;
    this.enableProfile = opts.profile !== false;
    if (this.enableProfile) profiler.enable({ mode: "verbose" });
  }

  async loadModel({ model }: { model: ModelRef }): Promise<string> {
    this.lastModel = model;
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
        ...(modelConfigFor(model) ? { modelConfig: modelConfigFor(model) } : {}),
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
    this.localModelId = await this.local.loadModel({ model });
    return this.localModelId;
  }

  complete(opts: {
    modelId: string;
    messages: ChatMsg[];
    stream?: boolean;
    onThinking?: (delta: string) => void;
  }): AsyncIterable<string> | Promise<string> {
    if (this.servedBy === "local" && this.local) return this.local.complete(opts);
    return opts.stream === false ? this.completeOnce(opts) : this.completeStream(opts);
  }

  private async *completeStream(opts: {
    modelId: string;
    messages: ChatMsg[];
    onThinking?: (delta: string) => void;
  }): AsyncGenerator<string> {
    const run = startCompletion(opts.modelId, opts.messages, true);
    this.lastReqId = run.requestId;
    const t0 = performance.now();
    let firstThinkAt = 0;
    let firstContentAt = 0;
    let contentTokens = 0;
    let thinkingTokens = 0;
    let sawEvent = false;
    let yieldedContent = false;
    const it = run.events[Symbol.asyncIterator]();

    try {
      // Fault injection: deterministically exercise the stall→fallback path
      // (a real network stall hits the same code, but localhost is too fast to interrupt).
      if (this.simulateStall) throw new StallError("stream_stalled");
      for (;;) {
        // Watchdog: bound the wait for the next event. Before any event, allow a
        // generous first-event budget; once events flow, fail fast on silence.
        const budget = sawEvent ? this.streamStallMs : this.firstEventMs;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stall = new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new StallError(sawEvent ? "stream_stalled" : "no_first_token")), budget);
        });
        let res: IteratorResult<{ type: string; text?: string }>;
        try {
          res = (await Promise.race([it.next(), stall])) as IteratorResult<{ type: string; text?: string }>;
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (res.done) break;
        sawEvent = true;
        const ev = res.value;
        if (ev.type === "thinkingDelta") {
          if (!firstThinkAt) firstThinkAt = performance.now();
          thinkingTokens++;
          opts.onThinking?.(ev.text ?? "");
        } else if (ev.type === "contentDelta") {
          if (!firstContentAt) firstContentAt = performance.now();
          contentTokens++;
          yieldedContent = true;
          yield ev.text ?? "";
        }
      }
    } catch (err) {
      // Watchdog stall OR a mid-stream transport error (e.g. provider connection
      // dropped because it was killed). Either way: cancel + fall back to local.
      const reason = err instanceof StallError ? err.reason : "stream_error";
      await cancel({ requestId: this.lastReqId }).catch(() => {});
      this.servedBy = "local";
      this.fallbackReason = `delegated ${reason}: ${errMsg(err)}`;
      if (yieldedContent) {
        // Some answer already streamed; don't duplicate it — stop and flag fallback.
        this.fallbackReason += " (after partial output)";
        return;
      }
      // Nothing emitted yet → transparently re-run on a local engine.
      this.local = new LocalEngine({ onProgress: this.progressCb, profile: false });
      this.localModelId = await this.local.loadModel({ model: this.lastModel as ModelRef });
      yield* this.localStream(opts);
      return;
    }

    const final = await run.final.catch(() => undefined);
    this.servedBy = "remote";
    this.lastCompletionStats = fromQvacStats(final?.stats);
    this.lastThinkingText = final?.thinkingText ?? "";
    this.lastTimingVal = {
      ttft_content_ms: firstContentAt ? Math.round(firstContentAt - t0) : 0,
      thinking_ms: firstThinkAt ? Math.round((firstContentAt || performance.now()) - firstThinkAt) : 0,
      content_tokens: contentTokens,
      thinking_tokens: thinkingTokens,
    };
  }

  /** Stream from the local fallback engine and mirror its stats/timing. */
  private async *localStream(opts: { messages: ChatMsg[]; onThinking?: (d: string) => void }): AsyncGenerator<string> {
    const local = this.local as LocalEngine;
    const id = this.localModelId as string;
    yield* local.complete({ modelId: id, messages: opts.messages, stream: true, onThinking: opts.onThinking }) as AsyncGenerator<string>;
    this.lastCompletionStats = local.lastStats?.() ?? null;
    this.lastTimingVal = local.lastTiming?.() ?? null;
    this.lastThinkingText = local.lastThinking?.() ?? "";
  }

  private async completeOnce(opts: { modelId: string; messages: ChatMsg[] }): Promise<string> {
    const run = startCompletion(opts.modelId, opts.messages, false);
    const final = await run.final;
    this.lastCompletionStats = fromQvacStats(final.stats);
    this.lastThinkingText = final.thinkingText ?? "";
    return final.contentText;
  }

  async unload(modelId: string): Promise<void> {
    if (this.servedBy === "local" && this.local) return this.local.unload(this.localModelId ?? modelId);
    await unloadModel({ modelId });
  }

  private fellBack(): boolean {
    return this.servedBy === "local" && this.local !== undefined;
  }

  lastStats(): CompletionStats | null {
    return this.fellBack() ? (this.local!.lastStats?.() ?? null) : this.lastCompletionStats;
  }

  lastTiming(): CompletionTiming | null {
    return this.fellBack() ? (this.local!.lastTiming?.() ?? null) : this.lastTimingVal;
  }

  lastThinking(): string {
    return this.fellBack() ? (this.local!.lastThinking?.() ?? "") : this.lastThinkingText;
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
