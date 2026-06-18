/**
 * voice.ts — the hands-free live voice loop, on-device.
 *
 * mic PCM (16 kHz mono s16le, streamed in as binary WS frames)
 *   → Whisper streaming session with native VAD + silence endpointing
 *   → on end-of-turn, the warm grounded LLM answers (streamed as text, with the
 *     same citations / served-by / telemetry the typed conversation shows)
 *   → Supertonic streams the answer as PCM back out (binary WS frames).
 *
 * Turn-taking is the SDK's VAD/endpointing. Barge-in: while speaking we keep
 * scoring the mic; sustained user speech cancels the in-flight TTS (and any
 * generation) and returns to listening. Models are loaded once per session
 * (warm) and the LLM stays warm via the EngineManager. Imports only
 * @lifeline/core; never @qvac/sdk.
 */
import { performance } from "node:perf_hooks";

import {
  assessSafety,
  buildGroundedSystemPrompt,
  cancelKind,
  collectSysInfo,
  extractCitations,
  EMERGENCY_NOTICE,
  loadTranscriber,
  loadTts,
  MEDICAL_DISCLAIMER,
  MODELS,
  openTranscription,
  RunLogger,
  speakStream,
  TTS_SAMPLE_RATE,
  ungroundedRefusal,
  type ChatMsg,
  type CompletionStats,
  type RetrievedPassage,
  type TranscriptionSession,
} from "@lifeline/core";

import { getSettings, isModelKey } from "./config";
import { engineManager } from "./engineManager";
import { recordDecision, recordServed } from "./peerStats";
import type { ServerEvent, SourceChip, TurnOptions, VoiceState } from "./protocol";
import { tracked } from "./serialize";

const GROUNDING_MIN_SCORE = 0.52;
const TTS_LANGS = new Set(["en", "es", "fr", "pt", "ko"]);
const MIN_TRANSCRIPT_CHARS = 2;
const BARGE_PROB = 0.72;
const BARGE_FRAMES = 4;

export type Emit = (ev: ServerEvent) => void;
export type EmitBinary = (pcm: Buffer) => void;

function int16Buffer(samples: number[]): Buffer {
  const b = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(samples[i])));
    b.writeInt16LE(v, i * 2);
  }
  return b;
}

export class VoiceSession {
  private state: VoiceState = "idle";
  private running = false;
  private whisperId?: string;
  private ttsId?: string;
  private stt?: TranscriptionSession;
  private options: TurnOptions = {};
  private turnSeq = 0;
  private bargeFrames = 0;
  private barged = false;
  private ttsActive = false;
  private busy = false; // a turn (LLM/TTS) is in progress
  private endpointAt = 0;
  private held = false; // we pinned the worker for this session

  constructor(private readonly emit: Emit, private readonly emitBinary: EmitBinary) {}

  get active(): boolean {
    return this.running;
  }

  async start(options: TurnOptions): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.options = options;
    this.setState("idle", "live", "warming models…");
    try {
      // Warm the LLM slot BEFORE opening the transcription stream, so any worker
      // re-warm (teardown → close) happens now — never under the live STT RPC.
      await tracked(() => engineManager.prepare(this.prepareOpts()));
      engineManager.hold();
      this.held = true;
      // Warm-managed (load once, reuse) so re-entering voice never double-loads.
      const ml = Boolean(options.lang);
      const ttsLang = options.lang && TTS_LANGS.has(options.lang) ? options.lang : "en";
      this.whisperId = await engineManager.loadAux(`whisper:${ml ? "ml" : "en"}`, () => loadTranscriber({ multilingual: ml }));
      this.ttsId = await engineManager.loadAux(`tts:${ttsLang}`, () => loadTts({ language: ttsLang }));
      // A fresh streaming session per conversation (the model stays loaded between sessions).
      this.stt = await openTranscription(this.whisperId, { endOfTurnSilenceMs: 600 });
    } catch (err) {
      this.emit({ type: "voice_error", message: err instanceof Error ? err.message : String(err) });
      await this.stop();
      return;
    }
    this.setState("listening", "live");
    void this.consume();
  }

  private prepareOpts() {
    const settings = getSettings();
    const modelKey = this.options.model ?? settings.defaultModel;
    return {
      model: isModelKey(modelKey) ? MODELS[modelKey] : MODELS.medgemma4b,
      modelKey,
      grounded: this.options.grounded ?? settings.grounded,
      delegate: this.options.delegate ?? settings.delegate,
      peerKeys: settings.peers.map((p) => p.key),
      peerLabels: Object.fromEntries(settings.peers.map((p) => [p.key, p.label])),
    };
  }

  /** Feed a chunk of mic PCM (16 kHz mono s16le). */
  audio(pcm: Buffer): void {
    // Always feed while listening; also during speaking so barge-in can hear the user.
    if (this.running && this.stt && (this.state === "listening" || this.state === "speaking")) {
      this.stt.write(pcm);
    }
  }

  async stop(): Promise<void> {
    if (!this.running && !this.held) return;
    this.running = false;
    this.ttsActive = false;
    // Close the streaming RPC FIRST so nothing is in flight, THEN release the pin
    // so future teardowns can't abort a live stream. The whisper/tts models stay
    // warm (engineManager owns them; cleared on the next worker teardown).
    try {
      this.stt?.end();
      this.stt?.destroy();
    } catch {
      /* ignore */
    }
    this.stt = undefined;
    if (this.held) {
      engineManager.release();
      this.held = false;
    }
    this.whisperId = undefined;
    this.ttsId = undefined;
    this.setState("idle", "live");
  }

  private setState(state: VoiceState, mode: "live" | "turn-based" = "live", detail?: string): void {
    this.state = state;
    this.emit({ type: "voice_state", state, mode, detail });
  }

  private async consume(): Promise<void> {
    if (!this.stt) return;
    try {
      for await (const ev of this.stt.events()) {
        if (!this.running) break;
        if (ev.type === "vad") {
          this.emit({ type: "voice_level", speaking: ev.speaking, level: ev.probability });
          if (this.state === "speaking") this.scoreBargeIn(ev.speaking, ev.probability);
        } else if (ev.type === "endOfTurn") {
          this.endpointAt = performance.now();
        } else if (ev.type === "text") {
          const text = ev.text.trim();
          // A finalized transcript while listening (and not mid-turn) is a new user turn.
          if (this.state === "listening" && !this.busy && text.length >= MIN_TRANSCRIPT_CHARS) {
            void this.handleTurn(text);
          }
        }
      }
    } catch (err) {
      if (this.running) this.emit({ type: "voice_error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  private scoreBargeIn(speaking: boolean, probability: number): void {
    // Conservative: require sustained, confident speech so we never interrupt on
    // our own playback or a stray noise.
    if (speaking && probability >= BARGE_PROB) {
      if (++this.bargeFrames >= BARGE_FRAMES) void this.bargeIn();
    } else {
      this.bargeFrames = Math.max(0, this.bargeFrames - 1);
    }
  }

  private async bargeIn(): Promise<void> {
    if (this.barged) return;
    this.barged = true;
    this.bargeFrames = 0;
    this.ttsActive = false;
    // Generation has already completed by the time we're speaking, so cancelling
    // the in-flight TTS is what stops the assistant's voice promptly.
    if (this.ttsId) await cancelKind(this.ttsId, "tts");
    this.setState("interrupted", "live");
  }

  private async handleTurn(text: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.barged = false;
    this.bargeFrames = 0;
    const sttFinalizeMs = this.endpointAt ? Math.round(performance.now() - this.endpointAt) : undefined;
    const turnId = `voice-${++this.turnSeq}-${Date.now()}`;
    const logger = new RunLogger();
    logger.session("voice", collectSysInfo());

    this.setState("thinking", "live");
    this.emit({ type: "voice_user", turnId, text });

    let answer = "";
    let served: "local" | "remote" = "local";
    let llmTtft = 0;
    let llmMs = 0;
    try {
      const r = await tracked(() => this.generateAnswer(turnId, text, logger));
      answer = r.answer;
      served = r.served;
      llmTtft = r.llmTtft;
      llmMs = r.llmMs;
    } catch (err) {
      this.emit({ type: "error", turnId, message: err instanceof Error ? err.message : String(err) });
    }

    // ---- Speak the answer (streaming PCM out), unless interrupted ----
    let ttsMs = 0;
    if (answer.trim() && this.running && !this.barged && this.ttsId) {
      this.setState("speaking", "live");
      this.emit({ type: "voice_tts", turnId, status: "start", sampleRate: TTS_SAMPLE_RATE });
      const t0 = performance.now();
      this.ttsActive = true;
      try {
        const { pcm, done } = speakStream(this.ttsId, answer.trim());
        let buf: number[] = [];
        for await (const sample of pcm) {
          if (!this.ttsActive || this.barged || !this.running) break;
          buf.push(sample);
          if (buf.length >= 2048) {
            this.emitBinary(int16Buffer(buf));
            buf = [];
          }
        }
        if (buf.length && this.ttsActive && !this.barged && this.running) this.emitBinary(int16Buffer(buf));
        await done.catch(() => {});
      } catch {
        /* TTS error → answer text already delivered */
      }
      ttsMs = Math.round(performance.now() - t0);
      this.ttsActive = false;
      this.emit({ type: "voice_tts", turnId, status: "end", bargedIn: this.barged });
    }

    logger.voiceTurn({
      endpoint_silence_ms: 600,
      stt_ms: sttFinalizeMs,
      llm_ttft_ms: llmTtft,
      llm_ms: llmMs,
      tts_ms: ttsMs,
      barge_in: this.barged,
      cancelled: this.barged ? ["tts"] : undefined,
      served_by: served,
      transcript_chars: text.length,
      answer_chars: answer.length,
    });
    this.emit({ type: "done", turnId, answer, disclaimer: MEDICAL_DISCLAIMER, evidence: logger.path });

    this.busy = false;
    engineManager.reconcile();
    if (this.running) this.setState("listening", "live");
  }

  /** The grounded answer (warm LLM + KB), emitting the same rich events as a typed turn. */
  private async generateAnswer(
    turnId: string,
    prompt: string,
    logger: RunLogger,
  ): Promise<{ answer: string; served: "local" | "remote"; llmTtft: number; llmMs: number }> {
    const opts = this.prepareOpts();
    const { model, grounded, delegate } = opts;
    const prepared = await engineManager.prepare(opts);
    const { engine, modelId, kb } = prepared;
    if (prepared.ingest) logger.ragIngest(prepared.ingest);
    logger.modelLoad({ modelId, source: typeof model.src === "string" ? model.src : model.label, label: model.label, load_ms: prepared.loadMs, warm: prepared.warm });

    let passages: RetrievedPassage[] = [];
    let safety = { red_flag: false, red_flag_terms: [] as string[], grounded: true, action: "answer" as string };
    if (grounded && kb) {
      const r = await kb.retrieve(prompt, 4);
      passages = r.passages;
      logger.ragSearch(r.stats);
      const isGrounded = passages.length > 0 && passages[0].score >= GROUNDING_MIN_SCORE;
      safety = assessSafety({ query: prompt, grounded: isGrounded });
      logger.safety(safety);
    } else {
      safety = assessSafety({ query: prompt, grounded: true });
    }
    this.emit({ type: "safety", turnId, redFlag: safety.red_flag, terms: safety.red_flag_terms, grounded: safety.grounded, action: safety.action });

    if (grounded && safety.action === "refuse_ungrounded") {
      const text = ungroundedRefusal();
      this.emit({ type: "refusal", turnId, text, disclaimer: MEDICAL_DISCLAIMER });
      return { answer: text, served: prepared.di.served_by, llmTtft: 0, llmMs: 0 };
    }
    if (safety.red_flag) this.emit({ type: "emergency", turnId, notice: EMERGENCY_NOTICE });

    const tagged = passages.map((p, i) => ({ tag: `S${i + 1}`, p }));
    const messages: ChatMsg[] = tagged.length
      ? [{ role: "system", content: buildGroundedSystemPrompt(tagged.map((t) => ({ tag: t.tag, content: t.p.content }))) }, { role: "user", content: prompt }]
      : [
          { role: "system", content: "You are Lifeline, a concise, careful offline first-aid assistant. Answer directly." },
          { role: "user", content: prompt },
        ];

    let answer = "";
    const t0 = performance.now();
    let firstAt = 0;
    let chunks = 0;
    const it = engine.complete({
      modelId,
      messages,
      stream: true,
      kvCache: false,
      onThinking: (delta) => this.emit({ type: "thinking", turnId, delta }),
    }) as AsyncIterable<string>;
    for await (const tok of it) {
      if (!this.running) break;
      if (chunks === 0) firstAt = performance.now();
      answer += tok;
      chunks++;
      this.emit({ type: "token", turnId, delta: tok });
    }
    const llmMs = Math.round(performance.now() - t0);
    const di = engine.delegationInfo?.() ?? prepared.di;
    const sdk: CompletionStats | null = engine.lastStats?.() ?? null;
    const timing = engine.lastTiming?.();
    const measuredTtft = firstAt ? Math.round(firstAt - t0) : llmMs;

    if (delegate && di.route) {
      recordDecision({ candidates: di.route.candidates.map((c) => ({ peerKey: c.peer_key, label: c.label, ok: c.ok, probeMs: c.probe_ms, error: c.error })), chosen: di.route.chosen, servedBy: di.served_by, fallbackReason: di.fallback_reason });
    }
    if (di.served_by === "remote") recordServed(di.peer_key ?? "", { ttftMs: sdk?.ttft_ms ?? measuredTtft, tps: sdk?.tokens_per_sec ?? (chunks > 0 ? chunks / (llmMs / 1000) : 0) });

    this.emit({ type: "served_by", turnId, servedBy: di.served_by, peerKey: di.peer_key, transportMs: prepared.warm ? undefined : di.transport_setup_ms != null ? Math.round(di.transport_setup_ms) : undefined, warm: prepared.warm && di.served_by === "remote", fallback: delegate && di.served_by === "local", reason: di.fallback_reason });

    if (tagged.length) {
      const retrievedTags = tagged.map((t) => t.tag);
      const { cited, attached, hallucinated } = extractCitations(answer, retrievedTags);
      logger.groundingCheck({ cited, retrieved: retrievedTags, hallucinated_cites: hallucinated });
      this.emit({ type: "citations", turnId, sources: toChips(tagged), cited, attached, hallucinated });
    }

    logger.inference({ modelId, prompt_chars: prompt.length, prompt_tokens: sdk?.prompt_tokens, measured: { ttft_ms: measuredTtft, total_ms: llmMs, completion_tokens: chunks, tokens_per_sec: chunks > 0 ? chunks / (llmMs / 1000) : 0 }, sdk_reported: sdk });
    this.emit({
      type: "telemetry",
      turnId,
      telemetry: {
        ttftMs: sdk?.ttft_ms ?? measuredTtft,
        ttftContentMs: timing?.ttft_content_ms,
        thinkingMs: timing?.thinking_ms,
        tokensPerSec: sdk?.tokens_per_sec ?? (chunks > 0 ? chunks / (llmMs / 1000) : 0),
        completionTokens: sdk?.completion_tokens ?? chunks,
        promptTokens: sdk?.prompt_tokens,
        totalMs: llmMs,
        loadMs: Math.round(prepared.loadMs),
        backendDevice: sdk?.backend_device,
        statsSource: sdk ? "sdk" : "measured",
      },
    });

    return { answer, served: di.served_by, llmTtft: sdk?.ttft_ms ?? measuredTtft, llmMs };
  }
}

function toChips(tagged: { tag: string; p: RetrievedPassage }[]): SourceChip[] {
  return tagged.map((t) => ({ tag: t.tag, source: t.p.source, section: t.p.section, score: t.p.score, snippet: t.p.snippet }));
}
