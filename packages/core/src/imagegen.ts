/**
 * imagegen.ts — on-device text-to-image via stable-diffusion.cpp (the QVAC
 * "sdcpp-generation" plugin). Lifeline uses it for ILLUSTRATIVE first-aid
 * diagrams only (recovery position, dressing a wound) — never purported
 * diagnostic imagery. The model is loaded on first use and unloaded right after
 * each generation, so the 2 GB-class SD weights never sit alongside the medical
 * model in memory.
 *
 * Default model: Stable Diffusion v2.1 (Q4_0, ~2.2 GB single-file checkpoint) —
 * the lightest standalone option (no companion text-encoder/VAE, unlike FLUX).
 */
import { performance } from "node:perf_hooks";

import { loadModel, unloadModel, diffusion, SD_V2_1_1B_Q4_0 } from "@qvac/sdk";
import type { LoadModelOptions } from "@qvac/sdk";

import type { ProgressUpdate } from "./types";

export interface IllustrationResult {
  png: Uint8Array;
  width: number;
  height: number;
  steps: number;
  seed?: number;
  generation_ms: number;
  model: string;
}

export interface IllustrationOptions {
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  /** Model download/load progress. */
  onProgress?: (p: ProgressUpdate) => void;
  /** Per-denoising-step progress (step, totalSteps). */
  onStep?: (step: number, total: number) => void;
}

/** Generate one illustration PNG for a prompt. Loads SD, generates, unloads. */
export async function generateIllustration(prompt: string, opts: IllustrationOptions = {}): Promise<IllustrationResult> {
  const width = opts.width ?? 512;
  const height = opts.height ?? 512;
  const steps = opts.steps ?? 20;

  const modelId = await loadModel({
    modelSrc: SD_V2_1_1B_Q4_0,
    modelType: "sdcpp-generation",
    modelConfig: { device: "gpu", threads: 4 },
    onProgress: (p: unknown) => opts.onProgress?.(p as ProgressUpdate),
  } as unknown as LoadModelOptions);

  try {
    const t0 = performance.now();
    const { progressStream, outputs, stats } = diffusion({
      modelId,
      prompt,
      negative_prompt: "photograph, photorealistic, gore, blood, graphic injury, text, watermark, signature",
      width,
      height,
      steps,
      cfg_scale: 7,
      seed: opts.seed ?? -1,
    } as unknown as Parameters<typeof diffusion>[0]);

    for await (const tick of progressStream) opts.onStep?.(tick.step, tick.totalSteps);
    const buffers = await outputs;
    const s = await stats;
    if (!buffers.length) throw new Error("diffusion returned no image");
    return {
      png: buffers[0],
      width,
      height,
      steps,
      seed: s?.seed,
      generation_ms: Math.round(performance.now() - t0),
      model: "Stable Diffusion v2.1 (Q4_0)",
    };
  } finally {
    await unloadModel({ modelId }).catch(() => {});
  }
}
