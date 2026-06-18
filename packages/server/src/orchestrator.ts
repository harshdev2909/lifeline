/**
 * orchestrator.ts — runs one conversation turn through @lifeline/core and emits
 * the streaming events the UI renders. The event-driven sibling of the CLI's
 * `ask`: same engine seam, RAG, safety, and modality chain, same evidence log,
 * but it emits structured ServerEvents instead of writing to a terminal.
 *
 * The completion model and (for grounded turns) the KnowledgeBase are kept WARM
 * across turns by the EngineManager — loaded once, reused after — so a
 * conversation does not re-pay worker init or the DHT holepunch every turn. Each
 * turn stays isolated via `kvCache:false`. Imports only @lifeline/core; never
 * @qvac/sdk.
 */
import { performance } from "node:perf_hooks";

import {
  assessSafety,
  buildGroundedSystemPrompt,
  buildVisionSystemPrompt,
  collectSysInfo,
  createEngine,
  detectInjection,
  extractCitations,
  extractText,
  EMERGENCY_NOTICE,
  MEDICAL_DISCLAIMER,
  MODELS,
  RunLogger,
  synthesizeToWav,
  transcribeAudio,
  translateFromEnglish,
  translateToEnglish,
  ungroundedRefusal,
  type ChatMsg,
  type CompletionStats,
  type DelegationInfo,
  type InferenceEngine,
  type ModelRef,
  type RetrievedPassage,
  type SafetyResult,
} from "@lifeline/core";

import { getSettings, isModelKey } from "./config";
import { engineManager } from "./engineManager";
import { recordDecision, recordServed } from "./peerStats";
import type { ServerEvent, SourceChip, TurnRequest } from "./protocol";
import { getFile, registerFile } from "./uploads";

const GROUNDING_MIN_SCORE = 0.52;
const DEFAULT_SYSTEM = "You are Lifeline, a concise, careful offline first-aid assistant. Answer directly.";

export type Emit = (ev: ServerEvent) => void;

function resolveModel(key: string): ModelRef {
  return isModelKey(key) ? MODELS[key] : MODELS.medgemma4b;
}

function toChips(tagged: { tag: string; p: RetrievedPassage }[]): SourceChip[] {
  return tagged.map((t) => ({ tag: t.tag, source: t.p.source, section: t.p.section, score: t.p.score, snippet: t.p.snippet }));
}

/** Run a turn, streaming ServerEvents through `emit`. Resolves when fully done. */
export async function runTurn(req: TurnRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  const turnId = req.id;
  const settings = getSettings();
  const opts = req.options ?? {};
  const grounded = opts.grounded ?? settings.grounded;
  const delegate = opts.delegate ?? settings.delegate;
  const lang = opts.lang ?? settings.lang;
  const speak = opts.speak ?? settings.speak;
  const modelKey = opts.model ?? settings.defaultModel;
  const model = resolveModel(modelKey);

  const attach = (kind: "image" | "ocr" | "audio") => {
    const a = req.attachments?.find((x) => x.kind === kind);
    return a ? getFile(a.id) : undefined;
  };
  const audioFile = attach("audio");
  const imageFile = attach("image");
  const ocrFile = attach("ocr");

  let prompt = req.prompt.trim();
  const stage = (s: Parameters<typeof emitStage>[1], status: "start" | "done", extra?: Record<string, unknown>) =>
    emitStage(emit, s, status, turnId, extra);

  const logger = new RunLogger();
  logger.session(delegate ? "ui (delegated)" : "ui (local)", collectSysInfo());

  const peerKeys = settings.peers.map((p) => p.key);
  const peerLabels = Object.fromEntries(settings.peers.map((p) => [p.key, p.label]));

  try {
    // ---- Voice in (local STT; transient model on the warm worker) ----
    if (audioFile) {
      stage("stt", "start");
      const t0 = performance.now();
      const stt = await transcribeAudio(audioFile.path, { multilingual: Boolean(lang) });
      prompt = stt.text || prompt;
      logger.stt({ model: stt.model, audio_seconds: stt.audio_seconds, transcribe_ms: stt.transcribe_ms, text_chars: prompt.length });
      stage("stt", "done", { detail: stt.model, ms: Math.round(performance.now() - t0) });
      emit({ type: "transcript", turnId, text: prompt });
    }

    // ---- Translate question → English ----
    if (lang && prompt) {
      stage("translate_in", "start", { detail: `${lang}→en` });
      const tr = await translateToEnglish(prompt, lang);
      logger.translation({ direction: tr.direction, src_lang: tr.src_lang, tgt_lang: tr.tgt_lang, chars: tr.chars, ms: tr.ms });
      prompt = tr.text;
      stage("translate_in", "done", { detail: tr.text, ms: tr.ms });
    }

    // ---- Vision (multimodal describe). Transient engine on the warm worker:
    //      profile:false and NO dispose(), so it never closes the warm worker. ----
    let visionFindings: string | undefined;
    if (imageFile) {
      if (!prompt) prompt = "Based on what is shown, what first aid should I give?";
      stage("vision", "start", { detail: delegate ? "delegated" : "local" });
      const vEngine: InferenceEngine = createEngine(
        delegate && peerKeys.length ? { kind: "delegated", providerKeys: peerKeys, peerLabels, profile: false } : { kind: "local", profile: false },
      );
      const vId = await vEngine.loadModel({ model: MODELS.vision });
      let findings = "";
      const t0 = performance.now();
      const it = vEngine.complete({
        modelId: vId,
        stream: true,
        kvCache: false,
        messages: [
          { role: "system", content: buildVisionSystemPrompt() },
          { role: "user", content: "Describe the observable medical findings in this image.", attachments: [{ path: imageFile.path }] },
        ],
      }) as AsyncIterable<string>;
      for await (const s of it) findings += s;
      visionFindings = findings.trim();
      const vDi = vEngine.delegationInfo?.() ?? { served_by: "local" as const };
      const vinj = detectInjection(visionFindings);
      logger.injectionGuard({ source: "vision", detected: vinj.detected, patterns: vinj.patterns, action: vinj.detected ? "fenced+flagged" : "fenced" });
      if (vinj.detected) emit({ type: "injection", turnId, source: "vision", detected: true, patterns: vinj.patterns });
      logger.vision({ model: MODELS.vision.label, image: imageFile.name, findings_chars: visionFindings.length, total_ms: Math.round(performance.now() - t0), served_by: vDi.served_by });
      await vEngine.unload(vId); // unload the transient model; leave the worker (and warm slot) intact
      stage("vision", "done", { detail: visionFindings.slice(0, 140), servedBy: vDi.served_by });
    }

    // ---- OCR (local; untrusted text, fenced; transient model on the warm worker) ----
    let ocrText: string | undefined;
    if (ocrFile) {
      if (!prompt) prompt = "Based on the text in this image, what should I do?";
      stage("ocr", "start");
      const r = await extractText(ocrFile.path);
      ocrText = r.text;
      logger.ocr({ model: r.model, image: ocrFile.name, block_count: r.block_count, text_chars: ocrText.length, ocr_ms: r.ocr_ms });
      const oinj = detectInjection(ocrText);
      logger.injectionGuard({ source: "ocr", detected: oinj.detected, patterns: oinj.patterns, action: oinj.detected ? "fenced+flagged" : "fenced" });
      if (oinj.detected) emit({ type: "injection", turnId, source: "ocr", detected: true, patterns: oinj.patterns });
      stage("ocr", "done", { detail: `${r.block_count} block(s), ${ocrText.length} chars`, ms: r.ocr_ms });
    }

    if (!prompt) throw new Error("Empty message — type a question or attach an image or recording.");

    // ---- Warm engine + KnowledgeBase (loaded once, reused after) ----
    stage("load", "start", { detail: model.label });
    const prepared = await engineManager.prepare({
      model,
      modelKey,
      grounded,
      delegate,
      peerKeys,
      peerLabels,
      onProgress: (p) => stage("load", "start", { detail: p.phase, progress: p.progress }),
    });
    const { engine, modelId, kb, warm, loadMs } = prepared;
    let di: DelegationInfo = prepared.di;
    if (prepared.ingest) logger.ragIngest(prepared.ingest);
    logger.modelLoad({ modelId, source: typeof model.src === "string" ? model.src : model.label, label: model.label, load_ms: loadMs, warm, sdk_load: engine.loadStats?.() });
    stage("load", "done", { detail: warm ? "warm · reused" : model.label, ms: Math.round(loadMs), servedBy: di.served_by });
    emitServedBy(emit, turnId, di, delegate, warm);
    if (di.route) emit({ type: "route", turnId, candidates: di.route.candidates.map((c) => ({ peerKey: c.peer_key, label: c.label, ok: c.ok, probeMs: c.probe_ms, error: c.error })), chosen: di.route.chosen, servedBy: di.served_by });

    // ---- RAG retrieval (local) + safety ----
    let passages: RetrievedPassage[] = [];
    let safety: SafetyResult = { red_flag: false, red_flag_terms: [], grounded: true, action: "answer" };
    if (grounded && kb) {
      stage("retrieval", "start");
      const r = await kb.retrieve(prompt, 4);
      passages = r.passages;
      logger.ragSearch(r.stats);
      const isGrounded = (passages.length > 0 && passages[0].score >= GROUNDING_MIN_SCORE) || Boolean(visionFindings) || Boolean(ocrText);
      safety = assessSafety({ query: `${prompt} ${visionFindings ?? ""} ${ocrText ?? ""}`, grounded: isGrounded });
      logger.safety({ red_flag: safety.red_flag, red_flag_terms: safety.red_flag_terms, grounded: safety.grounded, action: safety.action });
      const inj = detectInjection(passages.map((p) => p.content).join("\n"));
      logger.injectionGuard({ source: "rag", detected: inj.detected, patterns: inj.patterns, action: inj.detected ? "fenced+flagged" : "fenced" });
      if (inj.detected) emit({ type: "injection", turnId, source: "rag", detected: true, patterns: inj.patterns });
      stage("retrieval", "done", { detail: `${passages.length} passage(s), top ${passages[0]?.score.toFixed(2) ?? "—"}` });
      emit({ type: "safety", turnId, redFlag: safety.red_flag, terms: safety.red_flag_terms, grounded: safety.grounded, action: safety.action });
    } else {
      safety = assessSafety({ query: prompt, grounded: true });
      emit({ type: "safety", turnId, redFlag: safety.red_flag, terms: safety.red_flag_terms, grounded: true, action: safety.action });
    }

    if (grounded && safety.action === "refuse_ungrounded") {
      emit({ type: "refusal", turnId, text: ungroundedRefusal(), disclaimer: MEDICAL_DISCLAIMER });
      emit({ type: "done", turnId, answer: "", disclaimer: MEDICAL_DISCLAIMER, evidence: logger.path });
      return;
    }

    if (safety.red_flag) emit({ type: "emergency", turnId, notice: EMERGENCY_NOTICE });

    // ---- Build messages (grounded passages [S#]/[IMG]/[OCR], or plain) ----
    const tagged = passages.map((p, i) => ({ tag: `S${i + 1}`, p }));
    if (visionFindings) tagged.unshift({ tag: "IMG", p: { id: "image", source: "image", section: "vision findings", content: visionFindings, score: 1, snippet: visionFindings.slice(0, 120) } });
    if (ocrText) tagged.unshift({ tag: "OCR", p: { id: "ocr", source: "image", section: "OCR text", content: ocrText, score: 1, snippet: ocrText.slice(0, 120).replace(/\n/g, " ") } });
    const messages: ChatMsg[] = tagged.length
      ? [{ role: "system", content: buildGroundedSystemPrompt(tagged.map((t) => ({ tag: t.tag, content: t.p.content }))) }, { role: "user", content: prompt }]
      : [
          { role: "system", content: DEFAULT_SYSTEM },
          { role: "user", content: prompt },
        ];

    // ---- Stream the answer (kvCache:false → independent turn); reasoning aside ----
    let answer = "";
    let thinkingChars = 0;
    const t0 = performance.now();
    let firstAt = 0;
    let chunks = 0;
    const it = engine.complete({
      modelId,
      messages,
      stream: true,
      kvCache: false,
      onThinking: (delta) => {
        thinkingChars += delta.length;
        emit({ type: "thinking", turnId, delta });
      },
    }) as AsyncIterable<string>;
    for await (const tok of it) {
      if (signal.aborted) break;
      if (chunks === 0) firstAt = performance.now();
      answer += tok;
      chunks++;
      emit({ type: "token", turnId, delta: tok });
    }
    const totalMs = performance.now() - t0;
    if (thinkingChars > 0) emit({ type: "thinking_done", turnId, ms: engine.lastTiming?.()?.thinking_ms ?? 0, chars: thinkingChars });

    di = engine.delegationInfo?.() ?? di;
    emitServedBy(emit, turnId, di, delegate, warm);
    const timing = engine.lastTiming?.();
    const sdk: CompletionStats | null = engine.lastStats?.() ?? null;
    const measured = {
      ttft_ms: firstAt ? firstAt - t0 : totalMs,
      total_ms: totalMs,
      completion_tokens: chunks,
      tokens_per_sec: chunks > 0 ? chunks / (totalMs / 1000) : 0,
    };
    logger.inference({ modelId, prompt_chars: prompt.length, prompt_tokens: sdk?.prompt_tokens, measured, sdk_reported: sdk });

    if (delegate && di.route) {
      logger.routing({ candidates: di.route.candidates, chosen: di.route.chosen, served_by: di.served_by });
      recordDecision({
        candidates: di.route.candidates.map((c) => ({ peerKey: c.peer_key, label: c.label, ok: c.ok, probeMs: c.probe_ms, error: c.error })),
        chosen: di.route.chosen,
        servedBy: di.served_by,
        fallbackReason: di.fallback_reason,
      });
    }
    if (di.served_by === "remote") {
      logger.delegation({ peer_key: di.peer_key ?? "", transport_setup_ms: Math.round(di.transport_setup_ms ?? 0), e2e_encrypted: "per-docs", modelId, ttft_ms: sdk?.ttft_ms ?? measured.ttft_ms, tokens_per_sec: sdk?.tokens_per_sec ?? measured.tokens_per_sec, completion_tokens: sdk?.completion_tokens ?? measured.completion_tokens });
      recordServed(di.peer_key ?? "", { ttftMs: sdk?.ttft_ms ?? measured.ttft_ms, tps: sdk?.tokens_per_sec ?? measured.tokens_per_sec });
    } else if (delegate) {
      logger.fallback({ reason: di.fallback_reason ?? "provider unavailable", peer_key: peerKeys[0] });
    }

    // ---- Citations / grounding check ----
    let cited: string[] = [];
    let attached: string | undefined;
    let hallucinated: string[] = [];
    if (tagged.length) {
      const retrievedTags = tagged.map((t) => t.tag);
      ({ cited, attached, hallucinated } = extractCitations(answer, retrievedTags));
      logger.groundingCheck({ cited, retrieved: retrievedTags, hallucinated_cites: hallucinated });
      emit({ type: "citations", turnId, sources: toChips(tagged), cited, attached, hallucinated });
    }

    emit({
      type: "telemetry",
      turnId,
      telemetry: {
        ttftMs: sdk?.ttft_ms ?? measured.ttft_ms,
        ttftContentMs: timing?.ttft_content_ms,
        thinkingMs: timing?.thinking_ms,
        tokensPerSec: sdk?.tokens_per_sec ?? measured.tokens_per_sec,
        completionTokens: sdk?.completion_tokens ?? measured.completion_tokens,
        promptTokens: sdk?.prompt_tokens,
        totalMs: Math.round(measured.total_ms),
        loadMs: Math.round(loadMs),
        backendDevice: sdk?.backend_device,
        statsSource: sdk ? "sdk" : "measured",
      },
    });

    logger.sdkProfile(engine.profilerSnapshot?.());
    // NOTE: no unload/dispose — the model stays warm for the next turn.

    if (lang && answer.trim()) {
      stage("translate_out", "start", { detail: `en→${lang}` });
      const tr = await translateFromEnglish(answer.trim(), lang);
      logger.translation({ direction: tr.direction, src_lang: tr.src_lang, tgt_lang: tr.tgt_lang, chars: tr.chars, ms: tr.ms });
      stage("translate_out", "done", { ms: tr.ms });
      emit({ type: "localized", turnId, lang, text: tr.text });
    }

    if (speak && answer.trim()) {
      stage("tts", "start");
      const wavPath = logger.path.replace(/run-(.*)\.jsonl$/, "answer-$1.wav");
      const r = await synthesizeToWav(answer.trim(), wavPath);
      logger.tts({ model: r.model, engine: r.engine, chars: r.chars, synth_ms: r.synth_ms, out_path: r.out_path, sample_rate: r.sample_rate });
      const f = registerFile(r.out_path, "tts", "audio/wav");
      stage("tts", "done", { ms: r.synth_ms });
      emit({ type: "audio", turnId, url: `/api/audio/${f.id}` });
    }

    emit({ type: "done", turnId, answer, disclaimer: MEDICAL_DISCLAIMER, evidence: logger.path });
  } finally {
    // Keep the worker warm; only drop the slot if a delegated turn fell back to local.
    engineManager.reconcile();
  }
}

function emitStage(
  emit: Emit,
  stage: "stt" | "translate_in" | "vision" | "ocr" | "retrieval" | "load" | "translate_out" | "tts",
  status: "start" | "done",
  turnId: string,
  extra?: Record<string, unknown>,
): void {
  emit({ type: "stage", turnId, stage, status, ...(extra as object) });
}

function emitServedBy(emit: Emit, turnId: string, di: DelegationInfo, delegate: boolean, warm = false): void {
  emit({
    type: "served_by",
    turnId,
    servedBy: di.served_by,
    peerKey: di.peer_key,
    // On a warm (reused) link no setup is paid this turn, so don't report a stale time.
    transportMs: warm ? undefined : di.transport_setup_ms != null ? Math.round(di.transport_setup_ms) : undefined,
    warm: warm && di.served_by === "remote",
    fallback: delegate && di.served_by === "local",
    reason: di.fallback_reason,
  });
}
