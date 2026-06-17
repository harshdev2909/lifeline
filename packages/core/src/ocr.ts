/**
 * ocr.ts — optical character recognition (printed text → string), local, on-device.
 *
 * loadModel(OCR_LATIN_RECOGNIZER_1, modelConfig{langList,useGPU,…}) → ocr({modelId,image})
 * → await blocks (OCRTextBlock[] = {text,bbox?,confidence?}). We join the blocks into a
 * single string. The caller treats the result as UNTRUSTED data (a photographed label/sheet
 * could carry an injection), so it's fenced and injection-scanned upstream. Unload per call.
 */
import { performance } from "node:perf_hooks";

import { loadModel, unloadModel, ocr, OCR_LATIN_RECOGNIZER_1 } from "@qvac/sdk";
import type { LoadModelOptions } from "@qvac/sdk";

import type { ModelSrc, ProgressUpdate } from "./types";

export interface OcrBlock {
  text: string;
  confidence?: number;
}

export interface OcrResult {
  text: string;
  blocks: OcrBlock[];
  block_count: number;
  model: string;
  ocr_ms: number;
}

export interface OcrOptions {
  model?: ModelSrc;
  modelLabel?: string;
  /** Drop blocks below this confidence (default: keep all the recognizer returned). */
  minConfidence?: number;
  onProgress?: (p: ProgressUpdate) => void;
}

/** Load the Latin recognizer, OCR an image file, unload. Returns joined text + per-block detail. */
export async function extractText(path: string, opts: OcrOptions = {}): Promise<OcrResult> {
  const loadOpts = {
    modelSrc: opts.model ?? OCR_LATIN_RECOGNIZER_1,
    modelConfig: {
      langList: ["en"],
      useGPU: true,
      timeout: 30000,
      magRatio: 1.5,
      defaultRotationAngles: [90, 180, 270],
      contrastRetry: false,
      lowConfidenceThreshold: 0.5,
      recognizerBatchSize: 1,
    },
    onProgress: (p: unknown) => opts.onProgress?.(p as ProgressUpdate),
  } as unknown as LoadModelOptions;
  const modelId = await loadModel(loadOpts);
  try {
    const t0 = performance.now();
    const { blocks } = ocr({ modelId, image: path, options: { paragraph: false } } as unknown as Parameters<typeof ocr>[0]);
    const raw = await blocks;
    const min = opts.minConfidence ?? 0;
    const kept: OcrBlock[] = raw
      .filter((b) => (b.confidence ?? 1) >= min)
      .map((b) => ({ text: b.text, confidence: b.confidence }));
    return {
      text: kept.map((b) => b.text).join("\n").trim(),
      blocks: kept,
      block_count: kept.length,
      model: opts.modelLabel ?? "OCR Latin recognizer (fasttext)",
      ocr_ms: Math.round(performance.now() - t0),
    };
  } finally {
    await unloadModel({ modelId }).catch(() => {});
  }
}
