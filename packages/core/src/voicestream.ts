/**
 * voicestream.ts — streaming speech for the live voice loop, on-device.
 *
 * Built on the SDK's native streaming primitives (verified against 0.13.3):
 *  - `transcribeStream({ emitVadEvents:true, endOfTurnSilenceMs })` opens a
 *    bidirectional session: `write(pcm)` feeds 16 kHz mono s16le audio and the
 *    session emits `vad` (speaking + probability), `endOfTurn` (silence-based
 *    endpointing), and `text` (the turn's transcript). Whisper does the VAD and
 *    endpointing itself — given a Silero VAD model — so we don't hand-roll one.
 *  - `textToSpeech({ stream:true })` yields PCM samples incrementally via
 *    `bufferStream`, so the answer is spoken as it is generated.
 *  - `cancel({ operation:"broad", modelId, kind })` stops in-flight TTS (and
 *    generation) for barge-in.
 *
 * SDK specifics stay here so the rest of the app stays SDK-agnostic.
 */
import {
  loadModel,
  unloadModel,
  transcribeStream,
  textToSpeech,
  cancel,
  WHISPER_EN_BASE_Q8_0,
  WHISPER_BASE_Q8_0,
  TTS_EN_SUPERTONIC_Q8_0,
} from "@qvac/sdk";
import type { LoadModelOptions } from "@qvac/sdk";

import type { ProgressUpdate } from "./types";

/** The audio sample rate the transcription session expects (16 kHz mono s16le). */
export const STT_SAMPLE_RATE = 16000;

/** Silero VAD model used by streaming Whisper (not a named SDK export — referenced by registry src). */
export const VAD_SILERO_SRC =
  "registry://hf/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v5.1.2.bin";

export type SttEvent =
  | { type: "vad"; speaking: boolean; probability: number }
  | { type: "text"; text: string }
  | { type: "endOfTurn"; silenceMs?: number };

export interface TranscriptionSession {
  /** Feed a chunk of 16 kHz mono s16le PCM. */
  write(pcm: Uint8Array): void;
  /** Signal end of audio. */
  end(): void;
  /** Tear the session down. */
  destroy(): void;
  /** Async-iterable of normalized VAD / endpoint / transcript events. */
  events(): AsyncIterable<SttEvent>;
}

/** Load a streaming Whisper transcriber (with the Silero VAD model). Reusable/warm. */
export async function loadTranscriber(opts: { multilingual?: boolean; onProgress?: (p: ProgressUpdate) => void } = {}): Promise<string> {
  const loadOpts = {
    modelSrc: opts.multilingual ? WHISPER_BASE_Q8_0 : WHISPER_EN_BASE_Q8_0,
    modelType: "whisper",
    modelConfig: { vadModelSrc: VAD_SILERO_SRC },
    onProgress: (p: unknown) => opts.onProgress?.(p as ProgressUpdate),
  } as unknown as LoadModelOptions;
  return loadModel(loadOpts);
}

/** Open a bidirectional transcription session on a loaded transcriber. */
export async function openTranscription(modelId: string, opts: { endOfTurnSilenceMs?: number } = {}): Promise<TranscriptionSession> {
  const session = await transcribeStream({
    modelId,
    emitVadEvents: true,
    endOfTurnSilenceMs: opts.endOfTurnSilenceMs ?? 600,
  } as Parameters<typeof transcribeStream>[0]);

  async function* events(): AsyncGenerator<SttEvent> {
    for await (const ev of session as AsyncIterable<{ type: string; text?: string; speaking?: boolean; probability?: number; silenceDurationMs?: number; segment?: { text: string } }>) {
      if (ev.type === "vad") yield { type: "vad", speaking: Boolean(ev.speaking), probability: ev.probability ?? 0 };
      else if (ev.type === "endOfTurn") yield { type: "endOfTurn", silenceMs: ev.silenceDurationMs };
      else if (ev.type === "text" && ev.text) yield { type: "text", text: ev.text };
      else if (ev.type === "segment" && ev.segment?.text) yield { type: "text", text: ev.segment.text };
    }
  }

  return {
    write: (pcm) => (session as { write(p: Uint8Array): void }).write(pcm),
    end: () => (session as { end(): void }).end(),
    destroy: () => (session as { destroy?(): void }).destroy?.(),
    events,
  };
}

export async function unloadTranscriber(modelId: string): Promise<void> {
  await unloadModel({ modelId }).catch(() => {});
}

// --- TTS ---------------------------------------------------------------------

export interface TtsConfig {
  voice?: string;
  language?: string;
  speed?: number;
  onProgress?: (p: ProgressUpdate) => void;
}

/** Load a Supertonic TTS model. Reusable/warm. */
export async function loadTts(opts: TtsConfig = {}): Promise<string> {
  const loadOpts = {
    modelSrc: TTS_EN_SUPERTONIC_Q8_0,
    modelConfig: {
      ttsEngine: "supertonic",
      language: opts.language ?? "en",
      voice: opts.voice ?? "F1",
      ttsSpeed: opts.speed ?? 1.05,
      ttsNumInferenceSteps: 5,
    },
    onProgress: (p: unknown) => opts.onProgress?.(p as ProgressUpdate),
  } as unknown as LoadModelOptions;
  return loadModel(loadOpts);
}

export interface SpokenStream {
  /** Int16 PCM samples (44.1 kHz mono) as they are synthesized. */
  pcm: AsyncGenerator<number>;
  /** Resolves true on clean completion, false if interrupted. */
  done: Promise<boolean>;
}

/** Synthesize `text` to streaming PCM (spoken as generated). */
export function speakStream(modelId: string, text: string): SpokenStream {
  const r = textToSpeech({ modelId, text, inputType: "text", stream: true } as unknown as Parameters<typeof textToSpeech>[0]);
  return { pcm: r.bufferStream as AsyncGenerator<number>, done: r.done as Promise<boolean> };
}

/** TTS output sample rate (Supertonic). */
export const TTS_SAMPLE_RATE = 44100;

export async function unloadTts(modelId: string): Promise<void> {
  await unloadModel({ modelId }).catch(() => {});
}

/** Barge-in: cancel all in-flight requests of a kind on a model. */
export async function cancelKind(modelId: string, kind: "tts" | "completion"): Promise<void> {
  await cancel({ operation: "broad", modelId, kind } as unknown as Parameters<typeof cancel>[0]).catch(() => {});
}
