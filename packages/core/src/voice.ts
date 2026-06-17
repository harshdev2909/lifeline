/**
 * voice.ts — speech-to-text (Whisper) for voice-in. Local, on-device.
 *
 * STT only for now: QVAC's TTS models are multi-file ONNX (Chatterbox/Supertonic)
 * streaming PCM — deferred (see report). Whisper is a single GGUF, so `transcribe`
 * is straightforward. The SDK bundles an audio decoder, so a standard WAV file
 * (we pass its bytes) is decoded internally.
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { loadModel, unloadModel, transcribe, WHISPER_EN_BASE_Q8_0 } from "@qvac/sdk";
import type { LoadModelOptions } from "@qvac/sdk";

import type { ModelSrc, ProgressUpdate } from "./types";

export interface TranscribeResult {
  text: string;
  model: string;
  transcribe_ms: number;
  audio_bytes: number;
  audio_seconds?: number;
}

export interface TranscribeOptions {
  model?: ModelSrc;
  modelLabel?: string;
  onProgress?: (p: ProgressUpdate) => void;
}

/** Rough duration estimate for a 16-bit PCM WAV (44-byte header). */
function wavSeconds(buf: Buffer): number | undefined {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return undefined;
  const byteRate = buf.readUInt32LE(28); // bytes/sec from the fmt chunk
  if (!byteRate) return undefined;
  return Number(((buf.length - 44) / byteRate).toFixed(2));
}

/** Load Whisper locally, transcribe an audio file, unload. Returns the text + timing. */
export async function transcribeAudio(path: string, opts: TranscribeOptions = {}): Promise<TranscribeResult> {
  const loadOpts = {
    modelSrc: opts.model ?? WHISPER_EN_BASE_Q8_0,
    modelType: "whisper",
    onProgress: (p: unknown) => opts.onProgress?.(p as ProgressUpdate),
  } as unknown as LoadModelOptions;
  const modelId = await loadModel(loadOpts);
  try {
    const audio = readFileSync(path);
    const t0 = performance.now();
    const text = await transcribe({ modelId, audioChunk: audio });
    return {
      text: text.trim(),
      model: opts.modelLabel ?? "Whisper base.en (Q8_0)",
      transcribe_ms: Math.round(performance.now() - t0),
      audio_bytes: audio.length,
      audio_seconds: wavSeconds(audio),
    };
  } finally {
    await unloadModel({ modelId }).catch(() => {});
  }
}
