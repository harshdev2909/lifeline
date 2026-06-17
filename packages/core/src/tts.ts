/**
 * tts.ts — text-to-speech (voice-out) via Supertonic (single-file GGML, local).
 *
 * Pattern from the official qvac-examples: loadModel(TTS_EN_SUPERTONIC_Q8_0,
 * modelConfig:{ttsEngine:"supertonic",...}) → textToSpeech({...,stream:false}) →
 * `await result.buffer` (Int16 PCM samples @ 44100 Hz mono). We wrap the PCM in a
 * 44-byte WAV header and write a .wav. We unload+reload per synthesis (a loaded
 * model is one shared KV-cache; flushing avoids acoustic artifacts).
 */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { loadModel, unloadModel, textToSpeech, TTS_EN_SUPERTONIC_Q8_0 } from "@qvac/sdk";
import type { LoadModelOptions } from "@qvac/sdk";

import type { ModelSrc, ProgressUpdate } from "./types";

const SAMPLE_RATE = 44100;

export interface TtsResult {
  out_path: string;
  model: string;
  engine: "supertonic";
  chars: number;
  samples: number;
  synth_ms: number;
  sample_rate: number;
}

export interface TtsOptions {
  model?: ModelSrc;
  modelLabel?: string;
  voice?: string;
  language?: string;
  onProgress?: (p: ProgressUpdate) => void;
}

/** Standard 44-byte RIFF/WAVE header for 16-bit mono PCM. */
function wavHeader(dataLength: number, sampleRate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataLength, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); // byte rate
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits/sample
  h.write("data", 36);
  h.writeUInt32LE(dataLength, 40);
  return h;
}

function samplesToBuffer(samples: number[]): Buffer {
  const b = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(samples[i])));
    b.writeInt16LE(v, i * 2);
  }
  return b;
}

/** Synthesize `text` to a WAV file at `outPath`. Loads + unloads the TTS model (KV flush). */
export async function synthesizeToWav(text: string, outPath: string, opts: TtsOptions = {}): Promise<TtsResult> {
  const loadOpts = {
    modelSrc: opts.model ?? TTS_EN_SUPERTONIC_Q8_0,
    modelConfig: {
      ttsEngine: "supertonic",
      language: opts.language ?? "en",
      voice: opts.voice ?? "F1",
      ttsSpeed: 1.05,
      ttsNumInferenceSteps: 5,
    },
    onProgress: (p: unknown) => opts.onProgress?.(p as ProgressUpdate),
  } as unknown as LoadModelOptions;

  const modelId = await loadModel(loadOpts);
  try {
    const t0 = performance.now();
    const result = textToSpeech({ modelId, text, inputType: "text", stream: false } as unknown as Parameters<typeof textToSpeech>[0]);
    const samples = (await result.buffer) as number[];
    const synth_ms = Math.round(performance.now() - t0);
    writeFileSync(outPath, Buffer.concat([wavHeader(samples.length * 2, SAMPLE_RATE), samplesToBuffer(samples)]));
    return {
      out_path: outPath,
      model: opts.modelLabel ?? "Supertonic EN (Q8_0)",
      engine: "supertonic",
      chars: text.length,
      samples: samples.length,
      synth_ms,
      sample_rate: SAMPLE_RATE,
    };
  } finally {
    await unloadModel({ modelId }).catch(() => {});
  }
}
