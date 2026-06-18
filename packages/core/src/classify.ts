/**
 * classify.ts — image classification, two honest flavours.
 *
 * 1) `classifyImage` uses QVAC's first-class classifier (the bundled
 *    MobileNetV3-Small via modelType "ggml-classification"): a real softmax over
 *    its label set (food / report / other). Fast capture-triage — e.g. "is this
 *    a document?" → route it to OCR.
 *
 * 2) For a medical screening label set (burn severity, wound type), no trained
 *    classifier ships, so the honest path is the multimodal model constrained to
 *    a fixed label set with code-side validation (`matchLabel`). That runs
 *    through the engine seam in the caller; here we own the label sets and the
 *    validation. Screening output is descriptive support, never a diagnosis, and
 *    carries no fabricated probability.
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { loadModel, unloadModel, classify } from "@qvac/sdk";
import type { LoadModelOptions } from "@qvac/sdk";

export interface ClassLabel {
  label: string;
  confidence: number;
}
export interface ClassifyResult {
  results: ClassLabel[];
  model: string;
  classify_ms: number;
}

/** Classify an image with the bundled MobileNetV3-Small (food / report / other). */
export async function classifyImage(path: string): Promise<ClassifyResult> {
  const modelId = await loadModel({ modelType: "ggml-classification" } as unknown as LoadModelOptions);
  try {
    const t0 = performance.now();
    const results = await classify({ modelId, image: readFileSync(path) } as unknown as Parameters<typeof classify>[0]);
    return {
      results: results.map((r) => ({ label: r.label, confidence: r.confidence })),
      model: "MobileNetV3-Small (bundled)",
      classify_ms: Math.round(performance.now() - t0),
    };
  } finally {
    await unloadModel({ modelId }).catch(() => {});
  }
}

export interface LabelSet {
  id: string;
  label: string;
  options: string[];
}

/** Fixed medical screening label sets the multimodal model is constrained to. */
export const SCREEN_LABEL_SETS: LabelSet[] = [
  { id: "burn", label: "Burn severity", options: ["superficial (first-degree)", "partial-thickness (second-degree)", "full-thickness (third-degree)", "not a burn", "unclear"] },
  { id: "wound", label: "Wound type", options: ["minor abrasion", "laceration", "puncture wound", "deep / bleeding wound", "unclear"] },
  { id: "rash", label: "Skin finding", options: ["localized rash", "widespread rash", "blistering", "swelling / inflammation", "unclear"] },
];

export function labelSetById(id: string): LabelSet | undefined {
  return SCREEN_LABEL_SETS.find((s) => s.id === id);
}

/**
 * Code-side validation: map a model's free-text answer to one option of a fixed
 * set, so the screening result is always a known label (never an open string).
 * Returns undefined if nothing matched (the caller then reports "unclear").
 */
export function matchLabel(text: string, options: string[]): string | undefined {
  const t = text.toLowerCase();
  let best: string | undefined;
  let bestLen = 0;
  for (const opt of options) {
    const key = opt.split("(")[0].split("/")[0].trim().toLowerCase();
    if ((t.includes(opt.toLowerCase()) || t.includes(key)) && key.length > bestLen) {
      best = opt;
      bestLen = key.length;
    }
  }
  return best;
}
