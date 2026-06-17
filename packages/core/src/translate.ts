/**
 * translate.ts — offline machine translation via Bergamot NMT (pairwise X↔EN).
 *
 * loadModel(BERGAMOT_<pair>) → translate({modelId,text,modelType:"nmtcpp-translation"})
 * → await result.text. Lets a non-English question round-trip through the
 * English RAG+MedPsy chain: xx→en, answer, en→xx. Unload per call (KV flush).
 */
import { performance } from "node:perf_hooks";

import {
  loadModel,
  unloadModel,
  translate,
  BERGAMOT_ES_EN,
  BERGAMOT_EN_ES,
  BERGAMOT_FR_EN,
  BERGAMOT_EN_FR,
} from "@qvac/sdk";
import type { LoadModelOptions } from "@qvac/sdk";

import type { ModelSrc, ProgressUpdate } from "./types";

interface Pair {
  lang: string;
  toEn: ModelSrc;
  fromEn: ModelSrc;
}

export const TRANSLATION_PAIRS: Record<string, Pair> = {
  es: { lang: "Spanish", toEn: BERGAMOT_ES_EN, fromEn: BERGAMOT_EN_ES },
  fr: { lang: "French", toEn: BERGAMOT_FR_EN, fromEn: BERGAMOT_EN_FR },
};

export function isSupportedLang(code: string): boolean {
  return code in TRANSLATION_PAIRS;
}
export function supportedLangs(): string[] {
  return Object.keys(TRANSLATION_PAIRS);
}

export interface TranslateResult {
  text: string;
  direction: string;
  src_lang: string;
  tgt_lang: string;
  chars: number;
  ms: number;
}

async function run(model: ModelSrc, text: string, direction: string, src: string, tgt: string, onProgress?: (p: ProgressUpdate) => void): Promise<TranslateResult> {
  const modelId = await loadModel({
    modelSrc: model,
    // Bergamot loads with an engine config (from/to pair), not a modelType.
    modelConfig: { engine: "Bergamot", from: src, to: tgt, beamsize: 1, normalize: 1, temperature: 0.2, norepeatngramsize: 3, lengthpenalty: 1.2 },
    onProgress: (p: unknown) => onProgress?.(p as ProgressUpdate),
  } as unknown as LoadModelOptions);
  try {
    const t0 = performance.now();
    const result = translate({ modelId, text, modelType: "nmtcpp-translation", stream: false } as unknown as Parameters<typeof translate>[0]);
    let out: string;
    const maybeText = (result as { text?: Promise<string> }).text;
    if (maybeText) {
      out = await maybeText;
    } else {
      out = "";
      for await (const t of result.tokenStream) out += t;
    }
    return { text: out.trim(), direction, src_lang: src, tgt_lang: tgt, chars: text.length, ms: Math.round(performance.now() - t0) };
  } finally {
    await unloadModel({ modelId }).catch(() => {});
  }
}

export async function translateToEnglish(text: string, code: string, onProgress?: (p: ProgressUpdate) => void): Promise<TranslateResult> {
  const p = TRANSLATION_PAIRS[code];
  if (!p) throw new Error(`unsupported --lang "${code}" (supported: ${supportedLangs().join(", ")})`);
  return run(p.toEn, text, `${code}->en`, code, "en", onProgress);
}

export async function translateFromEnglish(text: string, code: string, onProgress?: (p: ProgressUpdate) => void): Promise<TranslateResult> {
  const p = TRANSLATION_PAIRS[code];
  if (!p) throw new Error(`unsupported --lang "${code}" (supported: ${supportedLangs().join(", ")})`);
  return run(p.fromEn, text, `en->${code}`, "en", code, onProgress);
}
