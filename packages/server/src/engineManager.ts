/**
 * engineManager.ts — keeps the model worker WARM across turns.
 *
 * The first version of the bridge ran a full engine lifecycle per turn (load →
 * complete → unload → close worker), so every turn re-paid worker init and, when
 * delegating, the DHT holepunch. That makes a low-latency voice loop impossible.
 *
 * This manager holds one engine + (for grounded turns) one open KnowledgeBase
 * for the current configuration, loads them once, and reuses them for every
 * subsequent turn with the same config. Independent turns stay isolated via
 * `kvCache:false` at completion time (see core), so there is no context bleed and
 * no CONTEXT_OVERFLOW without tearing the worker down. Switching model / peers /
 * grounding tears the slot down and re-warms; a delegated turn that falls back to
 * local drops the slot so the next turn re-attempts the peer. Disposed on shutdown.
 *
 * Turns and mesh probes are serialized (see serialize.ts), so this is only ever
 * touched by one caller at a time.
 */
import { performance } from "node:perf_hooks";

import {
  createEngine,
  KnowledgeBase,
  type DelegationInfo,
  type EngineOptions,
  type IngestStats,
  type InferenceEngine,
  type ModelRef,
  type ProgressUpdate,
} from "@lifeline/core";

import { DEFAULT_CORPUS } from "./config";

export interface PrepareOpts {
  model: ModelRef;
  modelKey: string;
  grounded: boolean;
  delegate: boolean;
  peerKeys: string[];
  peerLabels: Record<string, string>;
  onProgress?: (p: ProgressUpdate) => void;
}

export interface Prepared {
  engine: InferenceEngine;
  modelId: string;
  kb?: KnowledgeBase;
  di: DelegationInfo;
  /** True when the model+KB were reused (no load cost paid this turn). */
  warm: boolean;
  /** Wall-clock model load time (0 when warm). */
  loadMs: number;
  /** Ingest stats — present only on the cold turn that built the KB. */
  ingest?: IngestStats;
}

interface Slot {
  sig: string;
  delegate: boolean;
  engine: InferenceEngine;
  modelId: string;
  di: DelegationInfo;
  kb?: KnowledgeBase;
}

class EngineManager {
  private slot: Slot | null = null;

  private sigOf(o: PrepareOpts): string {
    return JSON.stringify({ m: o.modelKey, g: o.grounded, d: o.delegate, p: o.delegate ? o.peerKeys : [] });
  }

  /** Whether the current warm slot serves a given config (for UI/status). */
  isWarm(o: PrepareOpts): boolean {
    return this.slot?.sig === this.sigOf(o);
  }

  /** Get a ready engine (+ KB for grounded turns), loading once and reusing after. */
  async prepare(o: PrepareOpts): Promise<Prepared> {
    const sig = this.sigOf(o);
    if (this.slot && this.slot.sig === sig) {
      return {
        engine: this.slot.engine,
        modelId: this.slot.modelId,
        kb: this.slot.kb,
        di: this.slot.engine.delegationInfo?.() ?? this.slot.di,
        warm: true,
        loadMs: 0,
      };
    }

    await this.teardown();

    const engineOpts: EngineOptions =
      o.delegate && o.peerKeys.length
        ? { kind: "delegated", providerKeys: o.peerKeys, peerLabels: o.peerLabels, onProgress: o.onProgress }
        : { kind: "local", onProgress: o.onProgress };
    const engine = createEngine(engineOpts);

    let kb: KnowledgeBase | undefined;
    let ingest: IngestStats | undefined;
    if (o.grounded) {
      kb = new KnowledgeBase();
      await kb.open();
      ingest = await kb.ingest(DEFAULT_CORPUS);
    }

    const t0 = performance.now();
    const modelId = await engine.loadModel({ model: o.model });
    const loadMs = performance.now() - t0;
    const di = engine.delegationInfo?.() ?? { served_by: "local" };

    this.slot = { sig, delegate: o.delegate, engine, modelId, di, kb };
    return { engine, modelId, kb, di, warm: false, loadMs, ingest };
  }

  /**
   * Call after a turn. If a delegated slot ended up served locally (the peer
   * dropped and we fell back), discard it so the next turn re-attempts the peer
   * — a lazy re-warm that keeps the warm benefit while a peer is healthy.
   */
  reconcile(): void {
    if (!this.slot) return;
    if (this.slot.delegate && this.slot.engine.delegationInfo?.()?.served_by === "local") {
      void this.teardown();
    }
  }

  /** Drop the warm slot (e.g. on a settings change or before a mesh probe closes the worker). */
  invalidate(): void {
    void this.teardown();
  }

  async dispose(): Promise<void> {
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    const slot = this.slot;
    this.slot = null;
    if (!slot) return;
    // Close the KB (unloads the embedding model) BEFORE disposing the engine,
    // since engine.dispose() closes the shared worker the KB also uses.
    try {
      if (slot.kb) await slot.kb.close();
    } catch {
      /* ignore */
    }
    try {
      await slot.engine.dispose?.();
    } catch {
      /* ignore */
    }
  }
}

/** One warm slot per bridge process. */
export const engineManager = new EngineManager();
