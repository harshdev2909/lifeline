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
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import {
  budgetText,
  buildVisionSystemPrompt,
  chunkUtf8,
  classifyImage,
  collectSysInfo,
  createEngine,
  detectInjection,
  extractText,
  frameChunks,
  generateIllustration,
  generateVideo,
  KnowledgeBase,
  reassemble,
  simulateTransmit,
  terseSystemSuffix,
  utf8Bytes,
  labelSetById,
  matchLabel,
  runAdaptation,
  SCREEN_LABEL_SETS,
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
    case "classify":
      return runClassify(req, emit, signal);
    case "illustrate":
      return runIllustrate(req, emit, signal);
    case "adapt":
      return runAdapt(req, emit, signal);
    case "video":
      return runVideo(req, emit, signal);
    case "link":
      return runLink(req, emit, signal);
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

/**
 * Constrained-link mode — answer over a narrow, lossy channel. The model is told
 * to answer tersely; the reply is byte-budgeted, split into UTF-8-safe chunks
 * (never mid-codepoint), framed, and pushed through a simulated ACK/retry
 * channel. The readout reports the link budget, bytes, chunks, and retries; an
 * `constrained_link` evidence event records them.
 */
async function runLink(req: ToolRunRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  const runId = req.runId;
  const question = str(req, "question").trim();
  if (!question) throw new Error("Enter a question to answer over the constrained link.");
  const chunkBytes = Math.max(16, Math.min(1024, num(req, "chunkBytes") ?? 200));
  const loss = Math.max(0, Math.min(0.9, num(req, "loss") ?? 0.25));
  const langRaw = str(req, "lang");
  const lang = supportedLangs().includes(langRaw as never) ? langRaw : "";
  const delegate = req.options?.delegate ?? false;
  const model = resolveModel(str(req, "model", "medgemma4b"));
  const totalBudget = Math.max(240, chunkBytes * 4); // every byte costs — keep it short

  const logger = new RunLogger();
  logger.session(delegate ? "ui (constrained link, delegated)" : "ui (constrained link)", collectSysInfo());

  emit({ type: "tool_stage", runId, stage: "load", status: "start", detail: model.label });
  const engine = engineFor(delegate);
  const modelId = await engine.loadModel({ model });
  emit({ type: "tool_stage", runId, stage: "load", status: "done", detail: model.label });

  const system = `You are Lifeline, an offline first-aid assistant answering over a very constrained radio link. ${terseSystemSuffix()} If it is an emergency, say to seek emergency care first.`;
  const messages: ChatMsg[] = [
    { role: "system", content: system },
    { role: "user", content: question },
  ];
  emit({ type: "tool_stage", runId, stage: "generate", status: "start", detail: "Terse answer…" });
  const t0 = performance.now();
  let full = "";
  const it = engine.complete({ modelId, messages, stream: true, kvCache: false }) as AsyncIterable<string>;
  for await (const tok of it) {
    if (signal.aborted) break;
    full += tok;
    emit({ type: "tool_token", runId, delta: tok });
  }
  const genMs = Math.round(performance.now() - t0);
  const sdk = engine.lastStats?.() ?? null;
  const di = engine.delegationInfo?.() ?? { served_by: "local" as const };
  await engine.unload(modelId);
  emit({ type: "tool_stage", runId, stage: "generate", status: "done", ms: genMs });

  full = full.trim();
  // Localize for a genuine multibyte payload when a non-English link is chosen.
  if (lang && full) {
    emit({ type: "tool_stage", runId, stage: "translate", status: "start", detail: `en→${lang}` });
    const tr = await translateFromEnglish(full, lang);
    logger.translation({ direction: tr.direction, src_lang: tr.src_lang, tgt_lang: tr.tgt_lang, chars: tr.chars, ms: tr.ms });
    full = tr.text.trim();
    emit({ type: "tool_stage", runId, stage: "translate", status: "done", ms: tr.ms });
  }

  const fullBytes = utf8Bytes(full);
  const { text: budgeted, truncated } = budgetText(full, totalBudget);
  const chunks = chunkUtf8(budgeted, chunkBytes);
  const frames = frameChunks(chunks);
  const reassembledOk = reassemble(frames) === budgeted;
  const sentBytes = utf8Bytes(budgeted);
  const tx = simulateTransmit(frames.length, { loss });

  logger.constrainedLink({ byte_budget: chunkBytes, total_bytes: sentBytes, chunks: frames.length, retries: tx.retries, full_bytes: fullBytes });

  emit({
    type: "tool_telemetry",
    runId,
    telemetry: {
      servedBy: di.served_by,
      backend: sdk?.backend_device,
      metrics: [
        { label: "budget", value: `${chunkBytes}B/chunk`, hint: "Max UTF-8 bytes per chunk on this link." },
        { label: "sent", value: `${sentBytes}B`, hint: truncated ? `Budgeted from ${fullBytes}B to fit the link.` : "Total answer bytes sent." },
        { label: "chunks", value: String(frames.length), hint: "UTF-8-safe chunks (never split a codepoint)." },
        { label: "retries", value: String(tx.retries), hint: `Re-sends at ${Math.round(loss * 100)}% simulated loss.` },
        ...(tx.dropped ? [{ label: "dropped", value: String(tx.dropped), hint: "Chunks that exhausted their retries." }] : []),
      ],
    },
  });

  emit({
    type: "tool_done",
    runId,
    output: {
      tool: "link",
      question,
      answer: reassemble(frames),
      lang,
      byteBudget: chunkBytes,
      fullBytes,
      sentBytes,
      truncated,
      chunks: frames.length,
      loss,
      retries: tx.retries,
      dropped: tx.dropped,
      reassembledOk,
    },
    evidence: logger.path,
  });
}

/**
 * Image classification — two honest modes:
 *  - triage: the bundled MobileNetV3 classifier (real softmax: food/report/other),
 *    used to route a captured document to the OCR reader.
 *  - screen: the multimodal model constrained to a fixed medical label set, with
 *    code-side validation. Screening support, never a diagnosis; no fake number.
 */
async function runClassify(req: ToolRunRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  const runId = req.runId;
  const file = getFile(req.uploads?.find((u) => u.role === "image")?.id ?? "");
  if (!file) throw new Error("Attach a photo to screen.");
  const mode = str(req, "mode", "triage") === "screen" ? "screen" : "triage";

  const logger = new RunLogger();
  logger.session("ui (screen tool)", collectSysInfo());

  if (mode === "triage") {
    emit({ type: "tool_stage", runId, stage: "classify", status: "start", detail: "on-device classifier" });
    const r = await classifyImage(file.path);
    if (signal.aborted) return;
    logger.classify({ mode: "triage", model: r.model, image: file.name, labels: r.results, classify_ms: r.classify_ms });
    const top = r.results[0];
    const note =
      top?.label === "report"
        ? "Looks like a document or label — open Read text to extract it."
        : top?.label === "food"
          ? "Not a medical image."
          : undefined;
    emit({ type: "tool_stage", runId, stage: "classify", status: "done", ms: r.classify_ms });
    emit({
      type: "tool_telemetry",
      runId,
      telemetry: {
        servedBy: "local",
        metrics: [
          { label: "model", value: "MobileNetV3", hint: r.model },
          { label: "top", value: top ? `${(top.confidence * 100).toFixed(0)}%` : "—", hint: "Confidence of the top class (real softmax)." },
          { label: "ms", value: `${r.classify_ms}ms`, hint: "On-device classification time (measured)." },
        ],
      },
    });
    emit({ type: "tool_done", runId, output: { tool: "classify", mode: "triage", results: r.results, note }, evidence: logger.path });
    return;
  }

  // screen: multimodal model constrained to a fixed label set + code-side validation.
  const set = labelSetById(str(req, "labelSet", "burn")) ?? SCREEN_LABEL_SETS[0];
  const delegate = req.options?.delegate ?? false;
  emit({ type: "tool_stage", runId, stage: "screen", status: "start", detail: set.label });
  const engine = engineFor(delegate);
  const modelId = await engine.loadModel({ model: MODELS.vision });
  const t0 = performance.now();
  const optsList = set.options.map((o) => `- ${o}`).join("\n");
  let answer = "";
  const it = engine.complete({
    modelId,
    stream: true,
    kvCache: false,
    messages: [
      {
        role: "system",
        content: `You are a triage screening aid, not a diagnostician. Look at the image and choose the single best category from this list:\n${optsList}\nReply with EXACTLY one category from the list on the first line, then one short sentence of visual reasoning. Never diagnose or recommend treatment.`,
      },
      { role: "user", content: "Which category best fits this image?", attachments: [{ path: file.path }] },
    ],
  }) as AsyncIterable<string>;
  for await (const tok of it) {
    if (signal.aborted) break;
    answer += tok;
  }
  const totalMs = Math.round(performance.now() - t0);
  const di = engine.delegationInfo?.() ?? { served_by: "local" as const };
  await engine.unload(modelId);
  const matched = matchLabel(answer, set.options) ?? "unclear";
  const firstLine = answer.split("\n")[0]?.trim() ?? "";
  const reason = answer.split("\n").slice(1).join(" ").trim() || firstLine;
  logger.classify({ mode: "screen", model: `${MODELS.vision.label} (constrained: ${set.label})`, image: file.name, labels: [{ label: matched }], classify_ms: totalMs });

  emit({ type: "tool_stage", runId, stage: "screen", status: "done", ms: totalMs });
  emit({
    type: "tool_telemetry",
    runId,
    telemetry: {
      servedBy: di.served_by,
      metrics: [
        { label: "model", value: "SmolVLM2", hint: `${MODELS.vision.label}, constrained to ${set.label}` },
        { label: "labels", value: String(set.options.length), hint: "Fixed label set the answer is validated against." },
        { label: "ms", value: `${totalMs}ms`, hint: "Total screening time (measured)." },
      ],
    },
  });
  emit({
    type: "tool_done",
    runId,
    output: { tool: "classify", mode: "screen", results: [{ label: matched }], reason, note: "Screening support, not a diagnosis — confirm with the manual or a clinician." },
    evidence: logger.path,
  });
}

/**
 * Generate an instructional first-aid illustration on-device (Stable Diffusion).
 * Framed and prompted as a non-graphic instructional diagram — never diagnostic
 * imagery. The SD weights load on use and unload right after (memory discipline).
 */
async function runIllustrate(req: ToolRunRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  const runId = req.runId;
  const subject = str(req, "prompt").trim();
  if (!subject) throw new Error("Describe the first-aid step to illustrate.");
  const steps = num(req, "steps") ?? 20;

  const logger = new RunLogger();
  logger.session("ui (illustrate tool)", collectSysInfo());
  emit({ type: "tool_stage", runId, stage: "load", status: "start", detail: "Loading Stable Diffusion…" });

  const prompt = `simple instructional first-aid illustration, clean flat vector line art, neutral palette, clear step-by-step diagram, no text labels: ${subject}`;
  let genStarted = false;
  const r = await generateIllustration(prompt, {
    steps,
    onProgress: (p) => emit({ type: "tool_stage", runId, stage: "load", status: "start", detail: p.phase, progress: p.progress }),
    onStep: (step, total) => {
      if (!genStarted) {
        genStarted = true;
        emit({ type: "tool_stage", runId, stage: "load", status: "done" });
      }
      emit({ type: "tool_stage", runId, stage: "generate", status: "start", detail: `step ${step}/${total}`, progress: total ? step / total : undefined });
    },
  });
  if (signal.aborted) return;

  logger.imageGen({ model: r.model, prompt: subject, width: r.width, height: r.height, steps: r.steps, seed: r.seed, generation_ms: r.generation_ms });
  emit({ type: "tool_stage", runId, stage: "generate", status: "done", ms: r.generation_ms });
  const dataUrl = `data:image/png;base64,${Buffer.from(r.png).toString("base64")}`;
  emit({
    type: "tool_telemetry",
    runId,
    telemetry: {
      servedBy: "local",
      metrics: [
        { label: "model", value: "SD v2.1", hint: r.model },
        { label: "size", value: `${r.width}×${r.height}` },
        { label: "steps", value: String(r.steps) },
        { label: "gen", value: `${(r.generation_ms / 1000).toFixed(1)}s`, hint: "On-device generation time (measured)." },
        ...(r.seed != null ? [{ label: "seed", value: String(r.seed) }] : []),
      ],
    },
  });
  emit({ type: "tool_done", runId, output: { tool: "illustrate", dataUrl, width: r.width, height: r.height, steps: r.steps, seed: r.seed, prompt: subject }, evidence: logger.path });
}

/**
 * Generate a short instructional first-aid motion clip on-device (Wan 2.1 T2V).
 * Heavy: ~14.5 GB of weights and minutes per clip. Framed as an illustrative
 * demonstration only. No ffmpeg here, so the output is an AVI for download.
 */
async function runVideo(req: ToolRunRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  const runId = req.runId;
  const subject = str(req, "prompt").trim();
  if (!subject) throw new Error("Describe the first-aid action to animate.");
  const frames = num(req, "frames") ?? 17;

  const logger = new RunLogger();
  logger.session("ui (video tool)", collectSysInfo());
  emit({ type: "tool_stage", runId, stage: "load", status: "start", detail: "Loading Wan 2.1 (this is large)…" });

  const prompt = `simple instructional first-aid demonstration, clean flat line-art animation, neutral palette, no text: ${subject}`;
  let genStarted = false;
  let r;
  try {
    r = await generateVideo(prompt, {
      frames,
      onProgress: (p) => emit({ type: "tool_stage", runId, stage: "load", status: "start", detail: p.phase, progress: p.progress }),
      onStep: (step, total) => {
        if (!genStarted) {
          genStarted = true;
          emit({ type: "tool_stage", runId, stage: "load", status: "done" });
        }
        emit({ type: "tool_stage", runId, stage: "generate", status: "start", detail: `frame pass ${step}/${total}`, progress: total ? step / total : undefined });
      },
    });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    // The Wan pipeline (~14.5 GB, incl. an 11.4 GB encoder) OOM-kills the worker
    // on a device with too little memory. Surface that clearly, don't crash.
    if (/WORKER_CRASHED|SIGKILL|worker exited|out of memory|MODEL_NOT_LOADED/i.test(m)) {
      throw new Error("Out of memory generating video — Wan 2.1 needs ≈20 GB of unified memory (more than this device has). Offload to a stronger peer or run it on a larger machine.");
    }
    throw err;
  }
  if (signal.aborted) return;

  logger.videoGen({ model: r.model, prompt: subject, width: r.width, height: r.height, frames: r.frames, fps: r.fps, steps: r.steps, seed: r.seed, generation_ms: r.generation_ms });
  const aviPath = logger.path.replace(/run-(.*)\.jsonl$/, "clip-$1.avi");
  writeFileSync(aviPath, r.avi);
  const f = registerFile(aviPath, "video", "video/x-msvideo");

  emit({ type: "tool_stage", runId, stage: "generate", status: "done", ms: r.generation_ms });
  emit({
    type: "tool_telemetry",
    runId,
    telemetry: {
      servedBy: "local",
      metrics: [
        { label: "model", value: "Wan2.1-1.3B", hint: r.model },
        { label: "size", value: `${r.width}×${r.height}` },
        { label: "frames", value: `${r.frames}@${r.fps}` },
        { label: "gen", value: `${(r.generation_ms / 1000).toFixed(0)}s`, hint: "On-device generation time (measured)." },
        ...(r.seed != null ? [{ label: "seed", value: String(r.seed) }] : []),
      ],
    },
  });
  emit({
    type: "tool_done",
    runId,
    output: { tool: "video", url: `/api/media/${f.id}`, mime: "video/x-msvideo", playable: false, frames: r.frames, fps: r.fps, width: r.width, height: r.height, seed: r.seed, prompt: subject },
    evidence: logger.path,
  });
}

/**
 * Adapt — train a LoRA adapter on a small local set, run the built-in frozen
 * eval, and demonstrate it at inference (same prompt answered by the base model
 * and by the adapter). Contained: Qwen3-0.6B at a short context.
 */
async function runAdapt(req: ToolRunRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  const runId = req.runId;
  const epochs = num(req, "epochs") ?? 2;
  const testPrompt = str(req, "testPrompt") || undefined;

  const logger = new RunLogger();
  logger.session("ui (adapt tool)", collectSysInfo());
  emit({ type: "tool_stage", runId, stage: "load", status: "start", detail: "Loading Qwen3-0.6B…" });

  let trainingStarted = false;
  const r = await runAdaptation({
    epochs,
    testPrompt,
    onLoad: (p) => emit({ type: "tool_stage", runId, stage: "load", status: "start", detail: p.phase, progress: p.progress }),
    onProgress: (pr) => {
      if (!trainingStarted) {
        trainingStarted = true;
        emit({ type: "tool_stage", runId, stage: "load", status: "done" });
      }
      const phase = pr.isTrain ? "train" : "eval";
      emit({
        type: "tool_stage",
        runId,
        stage: "train",
        status: "start",
        detail: `epoch ${pr.epoch + 1} · step ${pr.step} · ${phase} loss ${pr.loss != null ? pr.loss.toFixed(3) : "—"} · eta ${Math.round(pr.etaMs / 1000)}s`,
      });
    },
  });
  if (signal.aborted) return;

  logger.finetune({
    model: r.model,
    status: r.status,
    epochs: r.epochs,
    steps: r.steps,
    train_loss: r.trainLoss,
    val_loss: r.valLoss,
    val_accuracy: r.valAccuracy,
    adapter_path: r.adapterPath,
    train_ms: r.train_ms,
  });
  emit({ type: "tool_stage", runId, stage: "train", status: "done", ms: r.train_ms });
  emit({
    type: "tool_telemetry",
    runId,
    telemetry: {
      servedBy: "local",
      metrics: [
        { label: "model", value: "Qwen3-0.6B", hint: r.model },
        { label: "steps", value: String(r.steps) },
        ...(r.trainLoss != null ? [{ label: "train", value: r.trainLoss.toFixed(3), hint: "Final training loss." }] : []),
        ...(r.valLoss != null ? [{ label: "val", value: r.valLoss.toFixed(3), hint: "Validation loss — the frozen eval." }] : []),
        { label: "time", value: `${(r.train_ms / 1000).toFixed(0)}s`, hint: "Training wall-clock (measured)." },
      ],
    },
  });
  emit({
    type: "tool_done",
    runId,
    output: {
      tool: "adapt",
      status: r.status,
      trainLoss: r.trainLoss,
      valLoss: r.valLoss,
      valAccuracy: r.valAccuracy,
      epochs: r.epochs,
      steps: r.steps,
      adapterPath: r.adapterPath,
      testPrompt: r.testPrompt,
      baseAnswer: r.baseAnswer,
      adaptedAnswer: r.adaptedAnswer,
      model: r.model,
    },
    evidence: logger.path,
  });
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
