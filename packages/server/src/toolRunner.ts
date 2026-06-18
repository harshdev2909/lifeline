/**
 * toolRunner.ts — runs a standalone capability ("tool") and streams the
 * consistent ServerEvents the workspace renders: tool_accepted → stage(s) →
 * (tool_token…) → telemetry → done | error. The sibling of the conversation
 * orchestrator for capabilities a medic reaches for on their own.
 *
 * Like a turn, a tool run is serialized (it goes through `tracked()` in main.ts)
 * and only ever touches the SDK through @lifeline/core — it never imports
 * @qvac/sdk. Transient models (OCR, vision, SOAP, embeddings) load and unload on
 * the shared worker WITHOUT disposing it, so the warm conversation slot survives.
 */
import { performance } from "node:perf_hooks";

import {
  buildVisionSystemPrompt,
  collectSysInfo,
  createEngine,
  detectInjection,
  extractText,
  KnowledgeBase,
  MEDICAL_DISCLAIMER,
  MODELS,
  RunLogger,
  supportedLangs,
  synthesizeToWav,
  transcribeAudio,
  translateFromEnglish,
  translateToEnglish,
  TRANSLATION_PAIRS,
  type ChatMsg,
  type InferenceEngine,
  type ModelRef,
} from "@lifeline/core";

import { DEFAULT_CORPUS, getSettings, isModelKey } from "./config";
import type { ServerEvent, ToolRunRequest } from "./protocol";
import { getFile, registerFile } from "./uploads";

export type Emit = (ev: ServerEvent) => void;

/** Dispatch a tool run to its handler. Throws on unknown tools or bad input. */
export async function runTool(req: ToolRunRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  switch (req.tool) {
    case "ocr":
      return runOcr(req, emit, signal);
    case "translate":
      return runTranslate(req, emit);
    case "search":
      return runSearch(req, emit);
    case "dictate":
      return runDictate(req, emit);
    case "speak":
      return runSpeak(req, emit);
    case "vision":
      return runVision(req, emit, signal);
    case "soap":
      return runSoap(req, emit, signal);
    case "corpus":
      return runCorpus(req, emit);
    default:
      throw new Error(`Unknown tool: ${String((req as { tool: string }).tool)}`);
  }
}

// --- helpers -----------------------------------------------------------------

const str = (req: ToolRunRequest, key: string, fallback = ""): string => {
  const v = req.params?.[key];
  return typeof v === "string" ? v : fallback;
};
const num = (req: ToolRunRequest, key: string): number | undefined => {
  const v = req.params?.[key];
  return typeof v === "number" ? v : undefined;
};

/** Build a transient engine honoring the delegate toggle + configured peers. */
function engineFor(delegate: boolean): InferenceEngine {
  const { peers } = getSettings();
  const peerKeys = peers.map((p) => p.key);
  const peerLabels = Object.fromEntries(peers.map((p) => [p.key, p.label]));
  return delegate && peerKeys.length
    ? createEngine({ kind: "delegated", providerKeys: peerKeys, peerLabels, profile: false })
    : createEngine({ kind: "local", profile: false });
}

function resolveModel(key: string): ModelRef {
  return isModelKey(key) ? MODELS[key] : MODELS.medgemma4b;
}

// --- handlers ----------------------------------------------------------------

/** Read printed/handwritten text from a photographed label, note, or sheet — on-device. */
async function runOcr(req: ToolRunRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  const runId = req.runId;
  const file = getFile(req.uploads?.find((u) => u.role === "image")?.id ?? "");
  if (!file) throw new Error("Attach a photo of the label or note to read.");

  const logger = new RunLogger();
  logger.session("ui (read tool)", collectSysInfo());

  emit({ type: "tool_stage", runId, stage: "ocr", status: "start", detail: file.name });
  const r = await extractText(file.path);
  if (signal.aborted) return;

  // Photographed text is untrusted (a label could carry a planted instruction):
  // surfaced read-only, scanned, and flagged so the medic knows.
  const inj = detectInjection(r.text);
  logger.injectionGuard({ source: "ocr", detected: inj.detected, patterns: inj.patterns, action: inj.detected ? "flagged" : "scanned" });
  logger.ocr({ model: r.model, image: file.name, block_count: r.block_count, text_chars: r.text.length, ocr_ms: r.ocr_ms });

  emit({ type: "tool_stage", runId, stage: "ocr", status: "done", ms: r.ocr_ms, detail: `${r.block_count} block(s)` });
  emit({
    type: "tool_telemetry",
    runId,
    telemetry: {
      servedBy: "local",
      metrics: [
        { label: "model", value: "OCR Latin", hint: r.model },
        { label: "blocks", value: String(r.block_count), hint: "Text regions the recognizer found." },
        { label: "chars", value: String(r.text.length), hint: "Characters of text extracted." },
        { label: "ocr", value: `${r.ocr_ms}ms`, hint: "On-device recognition time (measured wall-clock)." },
      ],
    },
  });
  emit({
    type: "tool_done",
    runId,
    output: { tool: "ocr", text: r.text, blocks: r.blocks, injection: inj.detected ? { detected: true, patterns: inj.patterns } : undefined },
    evidence: logger.path,
  });
}

/** Offline machine translation, either direction, via Bergamot NMT. */
async function runTranslate(req: ToolRunRequest, emit: Emit): Promise<void> {
  const runId = req.runId;
  const text = str(req, "text").trim();
  const lang = str(req, "lang", "es");
  const toEnglish = req.params?.toEnglish !== false; // default: foreign → English
  if (!text) throw new Error("Enter some text to translate.");
  if (!(lang in TRANSLATION_PAIRS)) throw new Error(`Unsupported language "${lang}" (have: ${supportedLangs().join(", ")}).`);

  const logger = new RunLogger();
  logger.session("ui (translate tool)", collectSysInfo());
  emit({ type: "tool_stage", runId, stage: "translate", status: "start", detail: toEnglish ? `${lang}→en` : `en→${lang}` });
  const r = toEnglish ? await translateToEnglish(text, lang) : await translateFromEnglish(text, lang);
  logger.translation({ direction: r.direction, src_lang: r.src_lang, tgt_lang: r.tgt_lang, chars: r.chars, ms: r.ms });
  emit({ type: "tool_stage", runId, stage: "translate", status: "done", ms: r.ms });
  emit({
    type: "tool_telemetry",
    runId,
    telemetry: {
      servedBy: "local",
      metrics: [
        { label: "model", value: "Bergamot", hint: `Bergamot NMT (${r.direction}).` },
        { label: "in", value: `${r.chars} ch`, hint: "Input characters." },
        { label: "ms", value: `${r.ms}ms`, hint: "On-device translation time (measured)." },
      ],
    },
  });
  emit({ type: "tool_done", runId, output: { tool: "translate", text: r.text, direction: r.direction, srcLang: r.src_lang, tgtLang: r.tgt_lang }, evidence: logger.path });
}

/** Semantic search across the loaded manual (local embeddings + vector search). */
async function runSearch(req: ToolRunRequest, emit: Emit): Promise<void> {
  const runId = req.runId;
  const query = str(req, "query").trim();
  const topK = num(req, "topK") ?? 5;
  if (!query) throw new Error("Enter a search query.");

  const logger = new RunLogger();
  logger.session("ui (search tool)", collectSysInfo());
  emit({ type: "tool_stage", runId, stage: "index", status: "start", detail: "Embedding the manual…" });
  const kb = new KnowledgeBase({ workspace: "lifeline-tool-search" });
  try {
    await kb.open();
    const ingest = await kb.ingest(DEFAULT_CORPUS);
    logger.ragIngest(ingest);
    emit({ type: "tool_stage", runId, stage: "index", status: "done", ms: ingest.ingest_ms, detail: `${ingest.chunk_count} chunks` });
    emit({ type: "tool_stage", runId, stage: "search", status: "start" });
    const { passages, stats } = await kb.retrieve(query, topK);
    logger.ragSearch(stats);
    emit({ type: "tool_stage", runId, stage: "search", status: "done", ms: stats.search_ms, detail: `${passages.length} hits` });
    emit({
      type: "tool_telemetry",
      runId,
      telemetry: {
        servedBy: "local",
        metrics: [
          { label: "embed", value: kb.embedLabel.split(" ")[0], hint: kb.embedLabel },
          { label: "chunks", value: String(ingest.chunk_count), hint: `Indexed in ${ingest.ingest_ms}ms.` },
          { label: "search", value: `${stats.search_ms}ms`, hint: "Vector search time (measured)." },
          { label: "top", value: passages[0]?.score.toFixed(2) ?? "—", hint: "Cosine similarity of the best hit (higher = closer)." },
        ],
      },
    });
    emit({
      type: "tool_done",
      runId,
      output: { tool: "search", query, hits: passages.map((p) => ({ source: p.source, section: p.section, score: p.score, snippet: p.snippet, content: p.content })) },
      evidence: logger.path,
    });
  } finally {
    await kb.close();
  }
}

/** Dictate a case / voice note → text (local Whisper STT). */
async function runDictate(req: ToolRunRequest, emit: Emit): Promise<void> {
  const runId = req.runId;
  const file = getFile(req.uploads?.find((u) => u.role === "audio")?.id ?? "");
  if (!file) throw new Error("Record or attach an audio clip to transcribe.");

  const logger = new RunLogger();
  logger.session("ui (dictate tool)", collectSysInfo());
  emit({ type: "tool_stage", runId, stage: "stt", status: "start", detail: file.name });
  const r = await transcribeAudio(file.path, { multilingual: false });
  logger.stt({ model: r.model, audio_seconds: r.audio_seconds, transcribe_ms: r.transcribe_ms, text_chars: r.text.length });
  emit({ type: "tool_stage", runId, stage: "stt", status: "done", ms: r.transcribe_ms });
  emit({
    type: "tool_telemetry",
    runId,
    telemetry: {
      servedBy: "local",
      metrics: [
        { label: "model", value: "Whisper", hint: r.model },
        ...(r.audio_seconds ? [{ label: "audio", value: `${r.audio_seconds.toFixed(1)}s`, hint: "Clip length." }] : []),
        { label: "stt", value: `${r.transcribe_ms}ms`, hint: "On-device transcription time (measured)." },
        { label: "chars", value: String(r.text.length) },
      ],
    },
  });
  emit({ type: "tool_done", runId, output: { tool: "dictate", text: r.text, audioSeconds: r.audio_seconds }, evidence: logger.path });
}

/** Read guidance aloud — local text-to-speech to a WAV the browser can play. */
async function runSpeak(req: ToolRunRequest, emit: Emit): Promise<void> {
  const runId = req.runId;
  const text = str(req, "text").trim();
  if (!text) throw new Error("Enter the text to read aloud.");

  const logger = new RunLogger();
  logger.session("ui (speak tool)", collectSysInfo());
  emit({ type: "tool_stage", runId, stage: "tts", status: "start" });
  const wavPath = logger.path.replace(/run-(.*)\.jsonl$/, "speak-$1.wav");
  const r = await synthesizeToWav(text, wavPath);
  logger.tts({ model: r.model, engine: r.engine, chars: r.chars, synth_ms: r.synth_ms, out_path: r.out_path, sample_rate: r.sample_rate });
  const f = registerFile(r.out_path, "tts", "audio/wav");
  emit({ type: "tool_stage", runId, stage: "tts", status: "done", ms: r.synth_ms });
  emit({
    type: "tool_telemetry",
    runId,
    telemetry: {
      servedBy: "local",
      metrics: [
        { label: "model", value: r.engine ?? "TTS", hint: r.model },
        { label: "chars", value: String(r.chars) },
        { label: "synth", value: `${r.synth_ms}ms`, hint: "On-device synthesis time (measured)." },
        ...(r.sample_rate ? [{ label: "rate", value: `${(r.sample_rate / 1000).toFixed(1)}k`, hint: "Audio sample rate." }] : []),
      ],
    },
  });
  emit({ type: "tool_done", runId, output: { tool: "speak", audioUrl: `/api/audio/${f.id}`, chars: r.chars }, evidence: logger.path });
}

/** Photo → observed findings (multimodal vision), streamed; local or delegated. */
async function runVision(req: ToolRunRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  const runId = req.runId;
  const file = getFile(req.uploads?.find((u) => u.role === "image")?.id ?? "");
  if (!file) throw new Error("Attach a photo to analyze.");
  const delegate = req.options?.delegate ?? false;

  const logger = new RunLogger();
  logger.session(delegate ? "ui (see tool, delegated)" : "ui (see tool)", collectSysInfo());
  emit({ type: "tool_stage", runId, stage: "vision", status: "start", detail: delegate ? "delegated" : "local" });

  const engine = engineFor(delegate);
  const modelId = await engine.loadModel({ model: MODELS.vision });
  const t0 = performance.now();
  let findings = "";
  const it = engine.complete({
    modelId,
    stream: true,
    kvCache: false,
    messages: [
      { role: "system", content: buildVisionSystemPrompt() },
      { role: "user", content: str(req, "prompt") || "Describe the observable medical findings in this image.", attachments: [{ path: file.path }] },
    ],
  }) as AsyncIterable<string>;
  for await (const tok of it) {
    if (signal.aborted) break;
    findings += tok;
    emit({ type: "tool_token", runId, delta: tok });
  }
  findings = findings.trim();
  const totalMs = Math.round(performance.now() - t0);
  const di = engine.delegationInfo?.() ?? { served_by: "local" as const };
  const sdk = engine.lastStats?.() ?? null;
  const inj = detectInjection(findings);
  logger.injectionGuard({ source: "vision", detected: inj.detected, patterns: inj.patterns, action: inj.detected ? "flagged" : "scanned" });
  logger.vision({ model: MODELS.vision.label, image: file.name, findings_chars: findings.length, total_ms: totalMs, served_by: di.served_by });
  await engine.unload(modelId);

  emit({ type: "tool_stage", runId, stage: "vision", status: "done", ms: totalMs, detail: di.served_by === "remote" ? "served by peer" : "on-device" });
  emit({
    type: "tool_telemetry",
    runId,
    telemetry: {
      servedBy: di.served_by,
      backend: sdk?.backend_device,
      metrics: [
        { label: "model", value: "SmolVLM2", hint: MODELS.vision.label },
        ...(sdk?.tokens_per_sec ? [{ label: "tok/s", value: sdk.tokens_per_sec.toFixed(1), hint: "Throughput (SDK-reported)." }] : []),
        { label: "ms", value: `${totalMs}ms`, hint: "Total analysis time (measured)." },
      ],
    },
  });
  emit({ type: "tool_done", runId, output: { tool: "vision", findings, injection: inj.detected ? { detected: true, patterns: inj.patterns } : undefined }, evidence: logger.path });
}

/** Case notes → SOAP note (clinician) or plain-language explainer (patient), streamed. */
async function runSoap(req: ToolRunRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  const runId = req.runId;
  const notes = str(req, "text").trim();
  if (!notes) throw new Error("Paste the case notes to summarize.");
  const audience = str(req, "audience", "clinician");
  const delegate = req.options?.delegate ?? false;
  const model = resolveModel(str(req, "model", "medgemma4b"));

  const system =
    audience === "patient"
      ? "You are a careful medical communicator. Rewrite the clinical information below as a clear, plain-language explanation for the patient at about a 6th-grade reading level. Be specific about what to do and what to watch for. Use ONLY the information given — never invent findings, doses, or diagnoses."
      : "You are a clinical scribe. From the case notes below, write a concise SOAP note with clearly labelled Subjective, Objective, Assessment, and Plan sections. Use ONLY the information given; do not invent findings or numbers. Where something is not documented, write 'not documented'.";

  const logger = new RunLogger();
  logger.session(delegate ? "ui (note tool, delegated)" : "ui (note tool)", collectSysInfo());
  emit({ type: "tool_stage", runId, stage: "load", status: "start", detail: model.label });
  const engine = engineFor(delegate);
  const modelId = await engine.loadModel({ model });
  emit({ type: "tool_stage", runId, stage: "load", status: "done", detail: model.label });

  const messages: ChatMsg[] = [
    { role: "system", content: system },
    { role: "user", content: notes },
  ];
  const t0 = performance.now();
  let answer = "";
  const it = engine.complete({ modelId, messages, stream: true, kvCache: false }) as AsyncIterable<string>;
  for await (const tok of it) {
    if (signal.aborted) break;
    answer += tok;
    emit({ type: "tool_token", runId, delta: tok });
  }
  const totalMs = Math.round(performance.now() - t0);
  const di = engine.delegationInfo?.() ?? { served_by: "local" as const };
  const sdk = engine.lastStats?.() ?? null;
  logger.inference({
    modelId,
    prompt_chars: notes.length,
    prompt_tokens: sdk?.prompt_tokens,
    measured: { ttft_ms: sdk?.ttft_ms ?? 0, total_ms: totalMs, completion_tokens: sdk?.completion_tokens ?? 0, tokens_per_sec: sdk?.tokens_per_sec ?? 0 },
    sdk_reported: sdk,
  });
  await engine.unload(modelId);

  emit({
    type: "tool_telemetry",
    runId,
    telemetry: {
      servedBy: di.served_by,
      backend: sdk?.backend_device,
      metrics: [
        { label: "model", value: model.label.split(" ")[0], hint: model.label },
        ...(sdk?.ttft_ms ? [{ label: "TTFT", value: `${Math.round(sdk.ttft_ms)}ms`, hint: "Time to first token (SDK-reported)." }] : []),
        ...(sdk?.tokens_per_sec ? [{ label: "tok/s", value: sdk.tokens_per_sec.toFixed(1), hint: "Throughput (SDK-reported)." }] : []),
        { label: "ms", value: `${totalMs}ms`, hint: "Total generation time (measured)." },
      ],
    },
  });
  emit({ type: "tool_done", runId, output: { tool: "soap", text: answer.trim() || MEDICAL_DISCLAIMER }, evidence: logger.path });
}

/** Corpus manager — ingest the manual and show its chunks/sources. */
async function runCorpus(req: ToolRunRequest, emit: Emit): Promise<void> {
  const runId = req.runId;
  const logger = new RunLogger();
  logger.session("ui (corpus tool)", collectSysInfo());
  emit({ type: "tool_stage", runId, stage: "index", status: "start", detail: "Embedding the manual…" });
  const kb = new KnowledgeBase({ workspace: "lifeline-tool-corpus" });
  try {
    await kb.open();
    const ingest = await kb.ingest(DEFAULT_CORPUS);
    logger.ragIngest(ingest);
    const chunks = kb.listChunks();
    emit({ type: "tool_stage", runId, stage: "index", status: "done", ms: ingest.ingest_ms, detail: `${ingest.chunk_count} chunks` });
    emit({
      type: "tool_telemetry",
      runId,
      telemetry: {
        servedBy: "local",
        metrics: [
          { label: "embed", value: kb.embedLabel.split(" ")[0], hint: kb.embedLabel },
          { label: "docs", value: String(ingest.doc_count) },
          { label: "chunks", value: String(ingest.chunk_count) },
          { label: "index", value: `${ingest.ingest_ms}ms`, hint: "Chunk + embed + save time (measured)." },
        ],
      },
    });
    emit({
      type: "tool_done",
      runId,
      output: {
        tool: "corpus",
        workspace: ingest.workspace,
        docCount: ingest.doc_count,
        chunkCount: ingest.chunk_count,
        embedModel: kb.embedLabel,
        chunks: chunks.map((c) => ({ source: c.source, section: c.section, snippet: c.snippet })),
      },
      evidence: logger.path,
    });
  } finally {
    await kb.close();
  }
}
