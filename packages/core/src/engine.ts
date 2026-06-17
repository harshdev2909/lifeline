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
import {
  loadModel,
  completion,
  unloadModel,
  close,
  profiler,
  LLAMA_3_2_1B_INST_Q4_0,
  MEDGEMMA_4B_IT_Q4_1,
} from "@qvac/sdk";
import type { CompletionStats as QvacStats, LoadModelOptions, ModelProgressUpdate } from "@qvac/sdk";

import type {
  ChatMsg,
  CompletionStats,
  EngineKind,
  InferenceEngine,
  ModelRef,
  ProgressUpdate,
} from "./types";

/** Built-in QVAC registry models Lifeline knows about. */
export const MODELS = {
  /** Small, fast default — ~773 MB, downloaded+cached on first run, offline after. */
  llama1b: { label: "Llama 3.2 1B Instruct (Q4_0)", src: LLAMA_3_2_1B_INST_Q4_0, type: "llamacpp-completion" },
  /** Medical model from the QVAC registry — the Day 3 medical-vertical candidate. */
  medgemma4b: { label: "MedGemma 4B IT (Q4_1) — medical", src: MEDGEMMA_4B_IT_Q4_1, type: "llamacpp-completion" },
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

export class LocalEngine implements InferenceEngine {
  readonly kind = "local" as const;

  private readonly progressCb?: (p: ProgressUpdate) => void;
  private readonly records: ProfRecord[] = [];
  private unsubscribe?: () => void;
  private lastCompletionStats: CompletionStats | null = null;
  private lastLoadGauges: Record<string, number> = {};

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
    const history = opts.messages.map((m) => ({ role: m.role, content: m.content }));
    const run = completion({ modelId: opts.modelId, history, stream: true });
    for await (const token of run.tokenStream) {
      yield token;
    }
    const final = await run.final.catch(() => undefined);
    this.lastCompletionStats = fromQvacStats(final?.stats);
  }

  private async completeOnce(opts: { modelId: string; messages: ChatMsg[] }): Promise<string> {
    const history = opts.messages.map((m) => ({ role: m.role, content: m.content }));
    const run = completion({ modelId: opts.modelId, history, stream: false });
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
 * The ONE place that chooses an engine. Day 2's DelegatedEngine slots in here.
 */
export function createEngine(opts: EngineOptions = {}): InferenceEngine {
  const kind = opts.kind ?? "local";
  switch (kind) {
    case "local":
      return new LocalEngine(opts);
    case "delegated":
      // ── DAY 2 PLUGS IN HERE ──────────────────────────────────────────────
      // return new DelegatedEngine(opts);
      // Same InferenceEngine interface; internally uses QVAC's
      //   loadModel({ ..., delegate })  +  startQVACProvider({ topic })
      // with fallbackToLocal. The CLI below needs ZERO changes.
      throw new Error(
        "DelegatedEngine arrives on Day 2 (P2P delegated inference). Plug it into createEngine() in engine.ts.",
      );
    default:
      throw new Error(`Unknown engine kind: ${String(kind)}`);
  }
}
