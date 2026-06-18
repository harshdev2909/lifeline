/**
 * finetune.ts — LoRA fine-tuning ("Adapt"), end-to-end and contained.
 *
 * Trains a small LoRA adapter on a local dataset, runs the built-in validation
 * (the honest frozen eval), then demonstrates the adapter at inference by
 * answering the SAME test prompt with the base model and again with the adapter
 * applied (modelConfig.lora) — a real before/after. Uses the smallest registry
 * model (Qwen3-0.6B) at a short context so a real run stays contained on laptop
 * hardware; report the numbers honestly whatever they are.
 */
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { loadModel, unloadModel, completion, finetune, QWEN3_600M_INST_Q4 } from "@qvac/sdk";
import type { LoadModelOptions } from "@qvac/sdk";

import type { ProgressUpdate } from "./types";

export interface AdaptPair {
  q: string;
  a: string;
}

/** A tiny first-aid "house style" set: terse, protocol-faithful answers. */
export const DEFAULT_ADAPT_PAIRS: AdaptPair[] = [
  { q: "How long should I cool a minor burn?", a: "Cool it under cool running water for 20 minutes. Do not use ice, butter, or toothpaste." },
  { q: "Someone is choking and can't speak. What do I do?", a: "Give up to 5 back blows between the shoulder blades, then up to 5 abdominal thrusts. Repeat until it clears or they go unconscious." },
  { q: "How do I control heavy bleeding?", a: "Apply firm direct pressure with a clean dressing, add more on top if it soaks through, and keep pressing. Call emergency services." },
  { q: "What's the recovery position for?", a: "It keeps an unconscious but breathing person's airway open and lets fluids drain. Roll them onto their side, head tilted back." },
  { q: "How do I treat a sprained ankle?", a: "Use RICE: Rest, Ice 20 minutes wrapped in cloth, Compression with a bandage, and Elevation above heart level." },
  { q: "What should I do for a nosebleed?", a: "Sit upright, lean slightly forward, and pinch the soft part of the nose for 10 minutes. Seek help if it won't stop." },
];

const DEFAULT_EVAL_PAIRS: AdaptPair[] = [
  { q: "How do I help a conscious choking adult?", a: "Alternate up to 5 back blows and up to 5 abdominal thrusts until the obstruction clears." },
  { q: "How should I cool a small burn?", a: "Hold it under cool running water for 20 minutes; avoid ice and home remedies." },
];

export interface AdaptProgress {
  isTrain: boolean;
  loss: number | null;
  step: number;
  epoch: number;
  etaMs: number;
}

export interface AdaptResult {
  status: string;
  trainLoss?: number;
  valLoss?: number;
  valAccuracy?: number;
  epochs: number;
  steps: number;
  adapterPath?: string;
  testPrompt: string;
  baseAnswer: string;
  adaptedAnswer: string;
  model: string;
  train_ms: number;
}

export interface AdaptOptions {
  pairs?: AdaptPair[];
  epochs?: number;
  testPrompt?: string;
  onProgress?: (p: AdaptProgress) => void;
  onLoad?: (p: ProgressUpdate) => void;
}

function toJsonl(pairs: AdaptPair[]): string {
  return pairs.map((p) => JSON.stringify({ messages: [{ role: "user", content: p.q }, { role: "assistant", content: p.a }] })).join("\n") + "\n";
}

/** Newest adapter file written under the output dir (gguf/safetensors/bin). */
function newestAdapter(dir: string): string | undefined {
  let best: { path: string; mtime: number } | undefined;
  const walk = (d: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(gguf|safetensors|bin)$/i.test(name) && (!best || st.mtimeMs > best.mtime)) best = { path: p, mtime: st.mtimeMs };
    }
  };
  walk(dir);
  return best?.path;
}

/** One single-turn completion, optionally with a LoRA adapter applied. */
async function answerOnce(loraPath: string | undefined, prompt: string): Promise<string> {
  const modelId = await loadModel({
    modelSrc: QWEN3_600M_INST_Q4,
    modelConfig: { device: "gpu", ctx_size: 512, ...(loraPath ? { lora: loraPath } : {}) },
  } as unknown as LoadModelOptions);
  try {
    const run = completion({ modelId, history: [{ role: "user", content: prompt }], stream: false } as unknown as Parameters<typeof completion>[0]);
    const final = await run.final;
    return (final.contentText ?? "").trim();
  } finally {
    await unloadModel({ modelId }).catch(() => {});
  }
}

/**
 * Train an adapter, capture the frozen eval, and answer a test prompt with and
 * without the adapter. Throws on training failure (the caller surfaces it).
 */
export async function runAdaptation(opts: AdaptOptions = {}): Promise<AdaptResult> {
  const pairs = opts.pairs?.length ? opts.pairs : DEFAULT_ADAPT_PAIRS;
  const epochs = opts.epochs ?? 2;
  const testPrompt = opts.testPrompt ?? "A patient has a minor burn on the hand. What is the first step?";
  const work = mkdtempSync(join(tmpdir(), "lifeline-adapt-"));
  const trainPath = join(work, "train.jsonl");
  const evalPath = join(work, "eval.jsonl");
  const outDir = join(work, "adapter");
  writeFileSync(trainPath, toJsonl(pairs));
  writeFileSync(evalPath, toJsonl(DEFAULT_EVAL_PAIRS));

  // 1) Train the adapter on the base model.
  const baseId = await loadModel({
    modelSrc: QWEN3_600M_INST_Q4,
    modelConfig: { device: "gpu", ctx_size: 512 },
    onProgress: (p: unknown) => opts.onLoad?.(p as ProgressUpdate),
  } as unknown as LoadModelOptions);

  const t0 = performance.now();
  let status = "UNKNOWN";
  let trainLoss: number | undefined;
  let valLoss: number | undefined;
  let valAccuracy: number | undefined;
  let steps = 0;
  try {
    // finetune() is overloaded (run → handle; control → promise). Pin the run
    // overload's shape so we get the streaming handle, not a control promise.
    const runFinetune = finetune as unknown as (p: { modelId: string; options: Record<string, unknown> }) => {
      progressStream: AsyncIterable<{ is_train: boolean; loss: number | null; global_steps: number; current_epoch: number; eta_ms: number }>;
      result: Promise<{ status: string; stats?: { train_loss?: number; val_loss?: number; val_accuracy?: number; global_steps?: number } }>;
    };
    const handle = runFinetune({
      modelId: baseId,
      options: {
        trainDatasetDir: trainPath,
        validation: { type: "dataset", path: evalPath },
        outputParametersDir: outDir,
        numberOfEpochs: epochs,
        loraModules: "attn_q,attn_k,attn_v,attn_o,ffn_gate,ffn_up,ffn_down",
        assistantLossOnly: true,
      },
    });
    for await (const row of handle.progressStream) {
      steps = row.global_steps ?? steps;
      opts.onProgress?.({ isTrain: row.is_train, loss: row.loss, step: row.global_steps, epoch: row.current_epoch, etaMs: row.eta_ms });
    }
    const res = await handle.result;
    status = res.status;
    trainLoss = res.stats?.train_loss;
    valLoss = res.stats?.val_loss;
    valAccuracy = res.stats?.val_accuracy;
    steps = res.stats?.global_steps ?? steps;
  } finally {
    await unloadModel({ modelId: baseId }).catch(() => {});
  }
  const train_ms = Math.round(performance.now() - t0);
  const adapterPath = newestAdapter(outDir);

  // 2) Before/after: answer the same prompt with the base model, then with the adapter.
  const baseAnswer = await answerOnce(undefined, testPrompt);
  const adaptedAnswer = adapterPath ? await answerOnce(adapterPath, testPrompt) : "(no adapter file was produced)";

  return { status, trainLoss, valLoss, valAccuracy, epochs, steps, adapterPath, testPrompt, baseAnswer, adaptedAnswer, model: "Qwen3-0.6B Instruct (Q4)", train_ms };
}
