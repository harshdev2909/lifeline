/**
 * videogen.ts — on-device text-to-video via stable-diffusion.cpp's video mode
 * (the QVAC "sdcpp-generation" plugin in mode "video"). Lifeline uses it for
 * short ILLUSTRATIVE first-aid motion clips only — never purported real footage.
 *
 * This is the heavy one: Wan 2.1 T2V 1.3B (diffusion ~2.8 GB) + UMT5-XXL text
 * encoder (~11.4 GB) + VAE (~254 MB) ≈ 14.5 GB of weights, and generation takes
 * minutes per second of video. The pipeline loads on use and unloads right after
 * so it never sits resident. Frame count must satisfy (4*k + 1).
 */
import { performance } from "node:perf_hooks";

import { loadModel, unloadModel, video, WAN2_1_T2V_1_3B_FP16, UMT5_XXL_FP16, WAN_2_1_COMFYUI_REPACKAGED_VAE } from "@qvac/sdk";
import type { LoadModelOptions } from "@qvac/sdk";

import type { ProgressUpdate } from "./types";

export interface VideoResult {
  avi: Uint8Array;
  width: number;
  height: number;
  frames: number;
  fps: number;
  steps: number;
  seed?: number;
  generation_ms: number;
  model: string;
}

export interface VideoOptions {
  width?: number;
  height?: number;
  /** Must satisfy (4*k + 1); 17 ≈ 1 s (shortest, fastest). */
  frames?: number;
  fps?: number;
  steps?: number;
  seed?: number;
  onProgress?: (p: ProgressUpdate) => void;
  onStep?: (step: number, total: number) => void;
}

/** Generate one short clip (AVI buffer) for a prompt. Loads Wan, generates, unloads. */
export async function generateVideo(prompt: string, opts: VideoOptions = {}): Promise<VideoResult> {
  const width = opts.width ?? 480;
  const height = opts.height ?? 832;
  const frames = opts.frames ?? 17;
  const fps = opts.fps ?? 16;
  const steps = opts.steps ?? 20;

  const modelId = await loadModel({
    modelSrc: WAN2_1_T2V_1_3B_FP16,
    modelType: "sdcpp-generation",
    modelConfig: {
      mode: "video",
      device: "gpu",
      threads: 4,
      t5XxlModelSrc: UMT5_XXL_FP16,
      vaeModelSrc: WAN_2_1_COMFYUI_REPACKAGED_VAE,
      diffusion_fa: true,
      offload_to_cpu: true,
      vae_on_cpu: true,
      vae_tiling: true,
    },
    onProgress: (p: unknown) => opts.onProgress?.(p as ProgressUpdate),
  } as unknown as LoadModelOptions);

  try {
    const t0 = performance.now();
    const { progressStream, outputs, stats } = video({
      modelId,
      mode: "txt2vid",
      prompt,
      negative_prompt: "blurry, low quality, static, jittery, photorealistic, gore, blood, text, watermark",
      width,
      height,
      video_frames: frames,
      fps,
      steps,
      cfg_scale: 6,
      // Wan 2.1 T2V needs flow_shift≈3 for visible motion.
      flow_shift: 3,
      seed: opts.seed ?? -1,
      vae_tiling: true,
    } as unknown as Parameters<typeof video>[0]);

    for await (const tick of progressStream) opts.onStep?.(tick.step, tick.totalSteps);
    const buffers = await outputs;
    const s = await stats;
    if (!buffers.length) throw new Error("video generation returned no output");
    return {
      avi: buffers[0],
      width,
      height,
      frames,
      fps,
      seed: s?.seed,
      steps,
      generation_ms: Math.round(performance.now() - t0),
      model: "Wan 2.1 T2V 1.3B",
    };
  } finally {
    await unloadModel({ modelId }).catch(() => {});
  }
}
