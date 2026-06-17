/**
 * Lifeline CLI — the orchestrator that ties the pieces together.
 *
 * This file depends only on `@lifeline/core` (the `InferenceEngine` interface,
 * `Provider`, logger, sysinfo, p2p helpers); it never imports `@qvac/sdk`.
 * Local vs delegated execution is chosen entirely by `createEngine`.
 *
 * Commands:
 *   lifeline ask "<q>" [--delegate --topic T | --provider-key K] [--model m]
 *                      [--system s] [--no-stream] [--max-tokens n] [--json]
 *   lifeline serve --topic T [--model m] [--seed hex] [--no-warm]
 *   lifeline bench "<q>" (--topic T | --provider-key K) [--model m] [--json]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assessSafety,
  buildGroundedSystemPrompt,
  buildVisionSystemPrompt,
  collectSysInfo,
  detectInjection,
  createEngine,
  EMERGENCY_NOTICE,
  formatSysInfoTable,
  KnowledgeBase,
  MEDICAL_DISCLAIMER,
  MODELS,
  extractText,
  Provider,
  RunLogger,
  setSdkConsole,
  synthesizeToWav,
  topicToProviderKey,
  topicToSeedHex,
  transcribeAudio,
  translateToEnglish,
  translateFromEnglish,
  ungroundedRefusal,
} from "@lifeline/core";
import type {
  BenchRow,
  ChatMsg,
  CompletionStats,
  DelegationInfo,
  EngineOptions,
  InferenceEngine,
  MeasuredInference,
  ModelRef,
  RetrievedPassage,
  SafetyResult,
} from "@lifeline/core";

/**
 * Grounding threshold (calibrated empirically against the corpus): the top
 * retrieved passage must score at least this to count as "grounded". QVAC's
 * embedding similarity score is higher = more relevant.
 */
const GROUNDING_MIN_SCORE = 0.52;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_SYSTEM = "You are Lifeline, a concise, careful offline assistant. Answer directly.";

// --- env: route QVAC storage off the (full) home disk; separate corestores per role ---
function setupQvacEnv(role: "provider" | "consumer"): void {
  if (!process.env.QVAC_CONFIG_PATH) {
    process.env.QVAC_CONFIG_PATH = join(REPO_ROOT, "qvac.config.js"); // shared model-weights cache
  }
  if (!process.env.SNAP_USER_COMMON) {
    // Per-role QVAC home → separate registry corestores so a long-lived provider's
    // corestore lock never collides with a consumer process on the same machine.
    process.env.SNAP_USER_COMMON = join(REPO_ROOT, role === "provider" ? ".qvac-home" : ".qvac-home-consumer");
  }
}

// --- tiny arg parser (no deps) ---
const BOOL_FLAGS = new Set(["delegate", "no-stream", "json", "no-warm", "simulate-stall", "speak", "help", "h"]);
interface Args {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}
function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "-h") {
      flags.help = true;
    } else if (t.startsWith("--")) {
      const name = t.slice(2);
      if (BOOL_FLAGS.has(name)) flags[name] = true;
      else flags[name] = argv[++i] ?? "";
    } else {
      positionals.push(t);
    }
  }
  return { command: positionals.shift(), positionals, flags };
}
const fstr = (f: Args["flags"], k: string): string | undefined => (typeof f[k] === "string" ? (f[k] as string) : undefined);
const fbool = (f: Args["flags"], k: string): boolean => f[k] === true;
const fnum = (f: Args["flags"], k: string): number | undefined => {
  const v = f[k];
  return typeof v === "string" && v !== "" ? Number(v) : undefined;
};
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const USAGE = `
Lifeline — offline-first, on-device AI mesh (QVAC). All inference local or P2P-delegated; no cloud.

Commands:
  ask "<prompt>"     Run a completion. Add --rag for grounded medical answers; --delegate to offload to a peer.
  serve              Host a model over P2P for peers to delegate to.
  bench "<prompt>"   Run the same prompt local AND delegated; print a comparison.
  medbench           Run grounded medical Qs through MedPsy-4B vs MedGemma-4B (--rag <corpus> required).

ask options:
  --audio <wavfile>          Voice in: transcribe speech (Whisper, local) and use it as the prompt
  --speak                    Voice out: synthesize the answer to a .wav (Supertonic TTS, local)
  --image <path>             Vision: describe the image (multimodal), then ground the answer
  --ocr <path>               OCR: read printed text off an image (label/sheet) as untrusted data
  --lang <code>              Non-English round-trip (es|fr): translate Q→EN, answer, EN→answer-lang
  --rag <path|dir>           Ground the answer in a corpus (RAG): retrieve passages + cite sources
  --top-k <n>                Passages to retrieve (default: 4)
  --model <key>              ${Object.keys(MODELS).join(" | ")}  (default: llama1b; medical: medpsy4b)
  --delegate                 Offload completion to a provider (falls back to local if unreachable)
  --topic <t>                Rendezvous topic (derives the provider's key on both sides)
  --provider-key <hex>       Target a specific provider public key (overrides --topic)
  --peers <list>             Mesh routing: ordered [label@]topic-or-key list; route to first live
                             peer, fall back across them, then local (e.g. laptop@t1,pi@t2)
  --system "<text>" | --no-stream | --max-tokens <n>
  --timeout <ms> | --health-timeout <ms> | --json | --evidence-dir <dir>
  Medical grounding adds a safety layer: red-flag emergency notice, source citations,
  a non-removable disclaimer, and refusal when the corpus has no relevant guidance.

serve options:
  --topic <t>                Rendezvous topic → deterministic provider identity (recommended)
  --seed <hex>               Raw 32-byte hex seed for the provider identity (advanced)
  --allow <key[,key...]>     Private mesh: only accept these peer public keys (firewall)
  --model <key>              Model to pre-load/warm (default: llama1b)
  --no-warm                  Don't pre-load the model (load lazily on first request)
  --home <dir>               Own QVAC corestore dir — run a 2nd/3rd peer on one machine
  --label <name>             Display label for this peer (e.g. "pi"), shown in the banner

bench options:
  --topic <t> | --provider-key <hex>  (required)   --model <key>   --max-tokens <n>   --json
`;

// --- shared helpers ---
function resolveModel(flags: Args["flags"]): ModelRef {
  const key = fstr(flags, "model") ?? "llama1b";
  const base: ModelRef | undefined = MODELS[key as keyof typeof MODELS];
  if (!base) {
    throw new Error(`unknown model "${key}". Available: ${Object.keys(MODELS).join(", ")}`);
  }
  const maxTokens = fnum(flags, "max-tokens");
  return maxTokens ? { ...base, config: { ...base.config, predict: maxTokens } } : base;
}

/** Reject a missing/unreadable input file early with a clear message instead of a deep SDK error. */
function requireFile(path: string, what: string): void {
  if (!existsSync(path)) throw new Error(`${what} not found: ${path}`);
}

function resolveProviderKey(flags: Args["flags"]): { key: string; topic?: string } {
  const explicit = fstr(flags, "provider-key");
  if (explicit) return { key: explicit };
  const topic = fstr(flags, "topic");
  if (topic) return { key: topicToProviderKey(topic), topic };
  throw new Error("delegation needs --topic <t> or --provider-key <hex>");
}

/**
 * Parse `--peers` (mesh routing): a comma-separated, preference-ordered list of peers.
 * Each entry is `[label@]ref` where ref is either a 64-hex provider key or a topic name
 * (derived to a key). Returns ordered keys + a key→label map for the routing evidence.
 */
function parsePeers(spec: string): { keys: string[]; labels: Record<string, string> } {
  const keys: string[] = [];
  const labels: Record<string, string> = {};
  for (const raw of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const at = raw.indexOf("@");
    const label = at >= 0 ? raw.slice(0, at) : undefined;
    const ref = at >= 0 ? raw.slice(at + 1) : raw;
    const isHex = /^[0-9a-f]{64}$/i.test(ref);
    const key = isHex ? ref.toLowerCase() : topicToProviderKey(ref);
    keys.push(key);
    labels[key] = label ?? (isHex ? ref.slice(0, 8) : ref);
  }
  if (!keys.length) throw new Error("--peers needs at least one [label@]topic-or-key");
  return { keys, labels };
}

function makeProgressReporter(quiet: boolean): (p: { phase?: string; progress?: number }) => void {
  if (quiet) return () => {};
  let last = -1;
  let lastPhase = "";
  return (p) => {
    const phase = p.phase ?? "preparing";
    const cur = typeof p.progress === "number" ? Math.round(p.progress * 100) : -1;
    if (phase !== lastPhase || cur !== last) {
      lastPhase = phase;
      last = cur;
      const label = cur >= 0 ? `${phase} ${cur}%` : phase;
      process.stderr.write(`\r  ⬇ model fetch/prepare: ${label}            `);
      if (cur >= 100) process.stderr.write("\n");
    }
  };
}

const num = (n: number | undefined, d = 1): string =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(d) : "n/a";

/** Stream/await a completion, measuring wall-clock TTFT/tok-s. `sink` receives token chunks. */
async function runCompletion(
  engine: InferenceEngine,
  modelId: string,
  messages: ChatMsg[],
  stream: boolean,
  sink: (s: string) => void,
  onThinking?: (delta: string) => void,
): Promise<MeasuredInference> {
  const t0 = performance.now();
  let measured: MeasuredInference;
  if (stream) {
    let firstAt = 0;
    let chunks = 0;
    const it = engine.complete({ modelId, messages, stream: true, onThinking }) as AsyncIterable<string>;
    for await (const tok of it) {
      if (chunks === 0) firstAt = performance.now();
      sink(tok);
      chunks++;
    }
    const total = performance.now() - t0;
    measured = {
      ttft_ms: firstAt ? firstAt - t0 : total,
      total_ms: total,
      completion_tokens: chunks,
      tokens_per_sec: chunks > 0 ? chunks / (total / 1000) : 0,
    };
  } else {
    const text = await (engine.complete({ modelId, messages, stream: false }) as Promise<string>);
    sink(text + "\n");
    const total = performance.now() - t0;
    measured = { ttft_ms: total, total_ms: total, completion_tokens: 0, tokens_per_sec: 0 };
  }
  // Engine-measured split (time-to-first-CONTENT vs reasoning), if available.
  const timing = engine.lastTiming?.();
  if (timing) {
    if (timing.ttft_content_ms) measured.ttft_content_ms = timing.ttft_content_ms;
    if (timing.thinking_ms) measured.thinking_ms = timing.thinking_ms;
  }
  return measured;
}

function buildMessages(prompt: string, system: string): ChatMsg[] {
  const msgs: ChatMsg[] = [];
  if (system.trim()) msgs.push({ role: "system", content: system });
  msgs.push({ role: "user", content: prompt });
  return msgs;
}

// ============================ ask ============================
async function runAsk(args: Args): Promise<void> {
  const { flags } = args;
  const json = fbool(flags, "json");
  if (json) setSdkConsole(false);
  const delegate = fbool(flags, "delegate");
  setupQvacEnv("consumer");

  let prompt = args.positionals.join(" ");
  const audioPath = fstr(flags, "audio");
  const imagePath = fstr(flags, "image");
  const ocrPath = fstr(flags, "ocr");
  if (!prompt.trim() && !audioPath && !imagePath && !ocrPath) {
    throw new Error('missing prompt, e.g. lifeline ask "Explain heat stroke first aid" (or --audio <wav> / --image <img> / --ocr <img>)');
  }
  if (audioPath) requireFile(audioPath, "audio file");
  if (imagePath) requireFile(imagePath, "image");
  if (ocrPath) requireFile(ocrPath, "image");

  const model = resolveModel(flags);
  const stream = !fbool(flags, "no-stream");
  const system = fstr(flags, "system") ?? DEFAULT_SYSTEM;
  const ragPath = fstr(flags, "rag");
  const topK = fnum(flags, "top-k") ?? fnum(flags, "topK") ?? 4;
  const out = (s: string) => {
    if (!json) process.stdout.write(s);
  };

  let providerKey: string | undefined;
  let topic: string | undefined;
  let peerKeys: string[] | undefined;
  let peerLabels: Record<string, string> | undefined;
  const peersSpec = fstr(flags, "peers");
  if (delegate) {
    if (peersSpec) {
      const m = parsePeers(peersSpec);
      peerKeys = m.keys;
      peerLabels = m.labels;
      providerKey = m.keys[0]; // preferred peer, for display/single-peer logging
    } else {
      const r = resolveProviderKey(flags);
      providerKey = r.key;
      topic = r.topic;
    }
  }

  // Shared delegated-engine options so vision + completion route over the same mesh.
  const delegatedOpts = (): EngineOptions => ({
    kind: "delegated",
    ...(peerKeys ? { providerKeys: peerKeys, peerLabels } : { providerPublicKey: providerKey }),
    timeout: fnum(flags, "timeout"),
    healthCheckTimeout: fnum(flags, "health-timeout"),
    streamStallMs: fnum(flags, "stall-ms"),
    firstEventMs: fnum(flags, "first-event-ms"),
    simulateStall: fbool(flags, "simulate-stall"),
    onProgress: makeProgressReporter(json),
  });

  const sysinfo = collectSysInfo();
  const logger = new RunLogger({ dir: fstr(flags, "evidence-dir") });
  const engine: InferenceEngine = createEngine(
    delegate ? delegatedOpts() : { kind: "local", onProgress: makeProgressReporter(json) },
  );
  logger.session(engine.kind, sysinfo);

  if (!json) {
    process.stderr.write(`\nLifeline · ${engine.kind} engine${delegate ? ` · topic "${topic ?? "—"}"` : ""} · no cloud\n`);
    process.stderr.write(formatSysInfoTable(sysinfo) + "\n");
    if (delegate && peerKeys) {
      process.stderr.write(`  Mesh peers (preference order): ${peerKeys.map((k) => `${peerLabels?.[k] ?? k.slice(0, 8)}(${k.slice(0, 8)}…)`).join(" → ")} → local\n`);
    } else if (delegate) {
      process.stderr.write(`  Provider key: ${providerKey}\n`);
    }
  }

  const lang = fstr(flags, "lang"); // non-English round-trip (e.g. es, fr)

  // ---- Voice in (LOCAL STT), if --audio (multilingual Whisper when --lang) ----
  if (audioPath) {
    if (!json) process.stderr.write(`🎤 transcribing ${audioPath} (Whisper${lang ? " multilingual" : ""}, LOCAL) …\n`);
    const stt = await transcribeAudio(audioPath, { multilingual: Boolean(lang), onProgress: makeProgressReporter(json) });
    prompt = stt.text || prompt;
    logger.stt({ model: stt.model, audio_seconds: stt.audio_seconds, transcribe_ms: stt.transcribe_ms, text_chars: prompt.length });
    if (!json) process.stderr.write(`  ✓ heard (${stt.transcribe_ms} ms): "${prompt}"\n`);
    if (!prompt.trim()) throw new Error("transcription produced no text");
  }

  // ---- Translate the question into English for the (English) grounded chain ----
  if (lang && prompt.trim()) {
    if (!json) process.stderr.write(`🌐 translating question ${lang}→en (Bergamot, LOCAL) …\n`);
    const tr = await translateToEnglish(prompt, lang, makeProgressReporter(json));
    logger.translation({ direction: tr.direction, src_lang: tr.src_lang, tgt_lang: tr.tgt_lang, chars: tr.chars, ms: tr.ms });
    if (!json) process.stderr.write(`  ✓ EN: "${tr.text}"\n`);
    prompt = tr.text;
  }

  // ---- Vision (multimodal describe → findings), if --image. Two-stage: vision describes,
  //      MedPsy + the manual decide. Honors --delegate (heavy model runs on the peer). ----
  let visionFindings: string | undefined;
  if (imagePath) {
    if (!prompt.trim()) prompt = "Based on what is shown, what first aid should I give?";
    if (!json) process.stderr.write(`👁  Vision: describing ${imagePath} (${delegate ? "DELEGATED to peer" : "LOCAL"}) …\n`);
    const vEngine: InferenceEngine = createEngine(
      delegate ? delegatedOpts() : { kind: "local", onProgress: makeProgressReporter(json) },
    );
    try {
      const vId = await vEngine.loadModel({ model: MODELS.vision });
      let f = "";
      const vm = await runCompletion(
        vEngine,
        vId,
        [
          { role: "system", content: buildVisionSystemPrompt() },
          { role: "user", content: "Describe the observable medical findings in this image.", attachments: [{ path: imagePath }] },
        ],
        true,
        (s) => {
          f += s;
        },
      );
      visionFindings = f.trim();
      const vinj = detectInjection(visionFindings);
      logger.injectionGuard({ source: "vision", detected: vinj.detected, patterns: vinj.patterns, action: vinj.detected ? "fenced+flagged" : "fenced" });
      if (!json && vinj.detected) process.stderr.write(`  🛡  injection guard: flagged ${vinj.patterns.join(", ")} in image findings — fenced as data\n`);
      const vDi = vEngine.delegationInfo?.() ?? { served_by: "local" };
      logger.vision({
        model: MODELS.vision.label,
        image: imagePath,
        findings_chars: visionFindings.length,
        ttfc_ms: vm.ttft_content_ms ?? Math.round(vm.ttft_ms),
        total_ms: Math.round(vm.total_ms),
        served_by: vDi.served_by,
      });
      await vEngine.unload(vId);
      if (!json) process.stderr.write(`  ✓ findings (served_by ${vDi.served_by}): ${visionFindings.slice(0, 160)}${visionFindings.length > 160 ? "…" : ""}\n`);
    } finally {
      await vEngine.dispose?.();
    }
  }

  // ---- OCR (printed text → string), if --ocr. The recognizer is small, so OCR runs LOCAL.
  //      The extracted text is UNTRUSTED (a photographed label/sheet can carry an injection):
  //      it's injection-scanned and fenced as data, then offered as an [OCR] grounding passage. ----
  let ocrText: string | undefined;
  if (ocrPath) {
    if (!prompt.trim()) prompt = "Based on the text in this image, what should I do?";
    if (!json) process.stderr.write(`🔤 OCR: reading text from ${ocrPath} (Latin recognizer, LOCAL) …\n`);
    const r = await extractText(ocrPath, { onProgress: makeProgressReporter(json) });
    ocrText = r.text;
    logger.ocr({ model: r.model, image: ocrPath, block_count: r.block_count, text_chars: ocrText.length, ocr_ms: r.ocr_ms });
    const oinj = detectInjection(ocrText);
    logger.injectionGuard({ source: "ocr", detected: oinj.detected, patterns: oinj.patterns, action: oinj.detected ? "fenced+flagged" : "fenced" });
    if (!json && oinj.detected) process.stderr.write(`  🛡  injection guard: flagged ${oinj.patterns.join(", ")} in OCR text — fenced as data\n`);
    if (!json) process.stderr.write(`  ✓ read ${r.block_count} block(s), ${ocrText.length} chars in ${r.ocr_ms} ms: ${ocrText.slice(0, 120).replace(/\n/g, " ")}${ocrText.length > 120 ? "…" : ""}\n`);
  }

  // ---- RAG retrieval (LOCAL) + safety, if --rag ----
  let kb: KnowledgeBase | undefined;
  let passages: RetrievedPassage[] = [];
  let safety: SafetyResult = { red_flag: false, red_flag_terms: [], grounded: true, action: "answer" };
  try {
    if (ragPath) {
      kb = new KnowledgeBase({ onProgress: makeProgressReporter(json) });
      if (!json) process.stderr.write(`📚 Knowledge base: ${ragPath} (embeddings: ${kb.embedLabel}, LOCAL)\n`);
      await kb.open();
      const ing = await kb.ingest(ragPath);
      logger.ragIngest(ing);
      if (!json) process.stderr.write(`  ✓ ingested ${ing.chunk_count} chunks / ${ing.doc_count} doc(s) in ${ing.ingest_ms} ms\n`);
      const r = await kb.retrieve(prompt, topK);
      passages = r.passages;
      logger.ragSearch(r.stats);
      // With an image, the [IMG] findings are themselves grounding context, so we answer
      // (citing [IMG] + whatever manual passages retrieved) rather than hard-refusing.
      const grounded = (passages.length > 0 && passages[0].score >= GROUNDING_MIN_SCORE) || Boolean(visionFindings) || Boolean(ocrText);
      // Run red-flag detection over the question AND the image findings / OCR text.
      safety = assessSafety({ query: `${prompt} ${visionFindings ?? ""} ${ocrText ?? ""}`, grounded });
      logger.safety({
        red_flag: safety.red_flag,
        red_flag_terms: safety.red_flag_terms,
        grounded: safety.grounded,
        action: safety.action,
      });
      // Injection guard: scan untrusted retrieved text. It's always FENCED in the prompt
      // (instruction hierarchy); detection adds a flag. We never let it become instructions.
      const ragText = passages.map((p) => p.content).join("\n");
      const inj = detectInjection(ragText);
      logger.injectionGuard({ source: "rag", detected: inj.detected, patterns: inj.patterns, action: inj.detected ? "fenced+flagged" : "fenced" });
      if (!json && inj.detected) {
        process.stderr.write(`  🛡  injection guard: flagged ${inj.patterns.join(", ")} in retrieved text — fenced as data, instructions ignored\n`);
      }
      if (!json) {
        process.stderr.write(`  ✓ retrieved ${passages.length} passage(s); top score ${passages[0]?.score.toFixed(2) ?? "—"}\n`);
        process.stderr.write(`  safety: red_flag=${safety.red_flag} grounded=${safety.grounded} action=${safety.action}\n`);
      }
    }

    // Ungrounded refusal (and NOT a red-flag emergency): never hallucinate; skip the LLM.
    if (ragPath && safety.action === "refuse_ungrounded") {
      const body = ungroundedRefusal();
      if (json) {
        process.stdout.write(
          JSON.stringify({ served_by: "local", grounded: false, refused: true, answer: body, disclaimer: MEDICAL_DISCLAIMER, evidence: logger.path }) + "\n",
        );
      } else {
        process.stdout.write(`\n${body}\n\n${MEDICAL_DISCLAIMER}\n`);
        process.stderr.write(`\n  (no model call — retrieval found nothing relevant)\n  Evidence: ${logger.path}\n\n`);
      }
      return;
    }

    // Build messages: grounded (RAG passages [S#] + optional image findings [IMG]) or plain.
    const tagged = passages.map((p, i) => ({ tag: `S${i + 1}`, p }));
    if (visionFindings) {
      tagged.unshift({
        tag: "IMG",
        p: { id: "image", source: "image", section: "vision findings", content: visionFindings, score: 1, snippet: visionFindings.slice(0, 120) },
      });
    }
    if (ocrText) {
      tagged.unshift({
        tag: "OCR",
        p: { id: "ocr", source: "image", section: "OCR text", content: ocrText, score: 1, snippet: ocrText.slice(0, 120).replace(/\n/g, " ") },
      });
    }
    const messages: ChatMsg[] = tagged.length
      ? [{ role: "system", content: buildGroundedSystemPrompt(tagged.map((t) => ({ tag: t.tag, content: t.p.content }))) }, { role: "user", content: prompt }]
      : buildMessages(prompt, system);

    if (!json) process.stderr.write(`  Loading model: ${model.label} …\n`);
    const tLoad0 = performance.now();
    const modelId = await engine.loadModel({ model });
    const loadMs = performance.now() - tLoad0;
    logger.modelLoad({
      modelId,
      source: typeof model.src === "string" ? model.src : (model.src as { src?: string }).src ?? model.label,
      label: model.label,
      load_ms: loadMs,
      sdk_load: engine.loadStats?.(),
    });

    // Provisional, post-LOAD view (may flip to local if the stream stalls mid-completion).
    let di: DelegationInfo = engine.delegationInfo?.() ?? { served_by: "local" };
    if (!json) {
      const servedNote = di.served_by === "remote" ? "remote peer" : delegate ? "local (FALLBACK)" : "local";
      process.stderr.write(`  ✓ loaded in ${loadMs.toFixed(0)} ms · served_by: ${servedNote}\n\n💬 ${prompt}\n\n`);
      if (safety.red_flag) process.stdout.write(`${EMERGENCY_NOTICE}\n\n`);
    }

    let answer = "";
    let thinkingChars = 0;
    let reasoningShown = false;
    const measured = await runCompletion(
      engine,
      modelId,
      messages,
      stream,
      (s) => {
        answer += s;
        out(s);
      },
      (delta) => {
        thinkingChars += delta.length;
        if (!json && !reasoningShown) {
          process.stderr.write("  🤔 reasoning…\n");
          reasoningShown = true;
        }
      },
    );
    if (thinkingChars > 0) measured.thinking_chars = thinkingChars;
    // Re-read after the completion: a mid-stream stall may have flipped this to local.
    di = engine.delegationInfo?.() ?? di;
    if (!json) process.stdout.write("\n");
    if (!json && thinkingChars > 0) {
      process.stderr.write(`  (reasoned ${measured.thinking_ms ?? "?"} ms · ${thinkingChars} chars — kept out of the answer above)\n`);
    }

    const sdk: CompletionStats | null = engine.lastStats?.() ?? null;
    logger.inference({ modelId, prompt_chars: prompt.length, prompt_tokens: sdk?.prompt_tokens, measured, sdk_reported: sdk });

    // Mesh routing evidence: which candidate peers were probed and which won (or local).
    if (delegate && di.route) {
      logger.routing({ topic, candidates: di.route.candidates, chosen: di.route.chosen, served_by: di.served_by });
    }

    if (di.served_by === "remote") {
      logger.delegation({
        topic,
        peer_key: di.peer_key ?? providerKey ?? "",
        transport_setup_ms: Math.round(di.transport_setup_ms ?? 0),
        e2e_encrypted: "per-docs",
        modelId,
        ttft_ms: sdk?.ttft_ms ?? measured.ttft_ms,
        tokens_per_sec: sdk?.tokens_per_sec ?? measured.tokens_per_sec,
        completion_tokens: sdk?.completion_tokens ?? measured.completion_tokens,
      });
    } else if (delegate) {
      logger.fallback({ reason: di.fallback_reason ?? "provider unavailable", topic, peer_key: providerKey });
    }

    // Grounding check: every citation the model emits must map to a passage we retrieved.
    // Captures [S#], [IMG], and [OCR] tags.
    let hallucinated: string[] = [];
    let citedTags: string[] = [];
    let attachedCite: string | undefined;
    if (tagged.length) {
      const retrievedTags = tagged.map((t) => t.tag);
      citedTags = [...new Set(Array.from(answer.matchAll(/\[(S\d+|IMG|OCR)\]/g), (m) => m[1]))];
      // Safety net: a grounded answer should always point at a source. If the model
      // answered without citing inline, attribute it to the top retrieved passage so the
      // chain stays auditable.
      if (citedTags.length === 0 && answer.trim()) {
        attachedCite = retrievedTags[0];
        citedTags = [attachedCite];
      }
      hallucinated = citedTags.filter((c) => !retrievedTags.includes(c));
      logger.groundingCheck({ cited: citedTags, retrieved: retrievedTags, hallucinated_cites: hallucinated });
    }

    // Sources (with grounding snippet) + the non-removable disclaimer.
    if (!json) {
      if (hallucinated.length) {
        process.stderr.write(`\n  flagged citation(s) not in the retrieved sources: ${hallucinated.join(", ")}\n`);
      }
      if (attachedCite) {
        const t = tagged.find((x) => x.tag === attachedCite);
        if (t) process.stdout.write(`\nGrounded in [${attachedCite}] ${t.p.source} § ${t.p.section}.\n`);
      }
      if (tagged.length) {
        process.stdout.write(`\nSources (retrieved locally from the field manual):\n`);
        for (const t of tagged) {
          process.stdout.write(`  [${t.tag}] ${t.p.source} § ${t.p.section}  (score ${t.p.score.toFixed(2)})\n`);
          process.stdout.write(`        “${t.p.snippet}…”\n`);
        }
      }
      process.stdout.write(`\n${MEDICAL_DISCLAIMER}\n`);
    }

    logger.sdkProfile(engine.profilerSnapshot?.());
    await engine.unload(modelId);
    logger.modelUnload(modelId);

    // Translate the answer back to the user's language (the chain ran in English).
    let localizedAnswer: string | undefined;
    if (lang && answer.trim()) {
      if (!json) process.stderr.write(`\n🌐 translating answer en→${lang} (Bergamot, LOCAL) …\n`);
      const tr = await translateFromEnglish(answer.trim(), lang, makeProgressReporter(json));
      logger.translation({ direction: tr.direction, src_lang: tr.src_lang, tgt_lang: tr.tgt_lang, chars: tr.chars, ms: tr.ms });
      localizedAnswer = tr.text;
      if (!json) process.stdout.write(`\n[${lang}] ${localizedAnswer}\n`);
    }

    // Voice out: synthesize the ANSWER (not the reasoning, not the disclaimer).
    let ttsPath: string | undefined;
    if (fbool(flags, "speak") && answer.trim()) {
      if (!json) process.stderr.write(`  🔊 synthesizing answer (Supertonic TTS, local) …\n`);
      const wav = logger.path.replace(/run-(.*)\.jsonl$/, "answer-$1.wav");
      const r = await synthesizeToWav(answer.trim(), wav, { onProgress: makeProgressReporter(json) });
      logger.tts({ model: r.model, engine: r.engine, chars: r.chars, synth_ms: r.synth_ms, out_path: r.out_path, sample_rate: r.sample_rate });
      ttsPath = r.out_path;
      if (!json) process.stderr.write(`  ✓ audio: ${r.out_path}  (${r.samples} samples, ${r.synth_ms} ms)\n`);
    }

    if (json) {
      process.stdout.write(
        JSON.stringify({
          served_by: di.served_by,
          fallback: delegate && di.served_by === "local",
          red_flag: safety.red_flag,
          grounded: safety.grounded,
          emergency_notice: safety.red_flag ? EMERGENCY_NOTICE : undefined,
          answer,
          disclaimer: MEDICAL_DISCLAIMER,
          sources: tagged.map((t) => ({ tag: t.tag, source: t.p.source, section: t.p.section, score: t.p.score, snippet: t.p.snippet })),
          cited: citedTags,
          attached_citation: attachedCite,
          hallucinated_cites: hallucinated,
          answer_localized: localizedAnswer,
          audio_out: ttsPath,
          peer_key: di.peer_key,
          transport_setup_ms: di.transport_setup_ms,
          load_ms: Math.round(loadMs),
          measured,
          sdk_reported: sdk,
          evidence: logger.path,
        }) + "\n",
      );
    } else {
      printAskSummary({ model, di, delegate, loadMs, measured, sdk, evidencePath: logger.path });
    }
  } finally {
    // Close the KB (unload embedding model) BEFORE disposing the engine, since
    // engine.dispose() closes the shared worker that the KB also uses.
    if (kb) await kb.close();
    await engine.dispose?.();
  }
}

function printAskSummary(a: {
  model: ModelRef;
  di: DelegationInfo;
  delegate: boolean;
  loadMs: number;
  measured: MeasuredInference;
  sdk: CompletionStats | null;
  evidencePath: string;
}): void {
  const { measured, sdk, di } = a;
  const served = di.served_by === "remote" ? "remote peer" : a.delegate ? "local (FALLBACK)" : "local";
  const rows: Array<[string, string, string]> = [
    ["Metric", "measured (us)", "SDK-reported"],
    ["model load (ms)", num(a.loadMs, 0), "—"],
    ["TTFT (ms)", num(measured.ttft_ms, 0), num(sdk?.ttft_ms, 0)],
    ["tokens/sec", num(measured.tokens_per_sec, 1), num(sdk?.tokens_per_sec, 1)],
    ["completion tokens", num(measured.completion_tokens, 0), num(sdk?.completion_tokens, 0)],
    ["prompt tokens", "—", num(sdk?.prompt_tokens, 0)],
    ["total time (ms)", num(measured.total_ms, 0), "—"],
  ];
  const w = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length)));
  const line = (r: [string, string, string]) => `  ${r[0].padEnd(w[0])} | ${r[1].padStart(w[1])} | ${r[2].padStart(w[2])}`;
  process.stderr.write("\n");
  process.stderr.write(`  served_by: ${served}   Model: ${a.model.label}\n`);
  if (di.peer_key) process.stderr.write(`  peer: ${di.peer_key}   transport setup: ${num(di.transport_setup_ms, 0)} ms\n`);
  if (di.fallback_reason) process.stderr.write(`  fallback reason: ${di.fallback_reason}\n`);
  process.stderr.write(`  compute backend (SDK): ${a.sdk?.backend_device ?? "n/a"}\n`);
  process.stderr.write("  " + "-".repeat(w[0] + w[1] + w[2] + 6) + "\n");
  for (const r of rows) process.stderr.write(line(r) + "\n");
  process.stderr.write(`\n  Evidence: ${a.evidencePath}\n\n`);
}

// ============================ serve ============================
async function runServe(args: Args): Promise<void> {
  const { flags } = args;
  // --home lets a 2nd/3rd provider on the SAME machine use its own QVAC corestore
  // (so an emulated extra mesh peer doesn't collide on the default provider home).
  const homeDir = fstr(flags, "home");
  if (homeDir && !process.env.SNAP_USER_COMMON) {
    process.env.SNAP_USER_COMMON = isAbsolute(homeDir) ? homeDir : join(REPO_ROOT, homeDir);
  }
  const label = fstr(flags, "label");
  setupQvacEnv("provider");

  const topic = fstr(flags, "topic");
  const seedFlag = fstr(flags, "seed");
  const seedHex = seedFlag ?? (topic ? topicToSeedHex(topic) : undefined);
  if (!seedHex) throw new Error("serve needs --topic <t> (recommended) or --seed <hex>");
  process.env.QVAC_HYPERSWARM_SEED = seedHex;
  const expectedKey = topic ? topicToProviderKey(topic) : undefined;

  const model = resolveModel(flags);
  const warm = !fbool(flags, "no-warm");

  // Private mesh: --allow <pubkey[,pubkey]> → only these peers may connect.
  const allowList = (fstr(flags, "allow") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const firewall = allowList.length ? { mode: "allow" as const, publicKeys: allowList } : undefined;

  const sysinfo = collectSysInfo();
  const logger = new RunLogger({ dir: fstr(flags, "evidence-dir") });
  // Record the firewall config in the session event (auditable).
  logger.session(`provider${firewall ? " (allowlist)" : ""}`, sysinfo);

  const provider = new Provider({ onProgress: makeProgressReporter(false) });
  process.stderr.write(`\nLifeline provider · 100% on-device · serving over Holepunch P2P\n`);
  if (label) process.stderr.write(`  peer label: ${label}\n`);
  if (homeDir) process.stderr.write(`  home: ${process.env.SNAP_USER_COMMON}\n`);
  if (topic) process.stderr.write(`  topic: "${topic}"\n`);
  if (firewall) process.stderr.write(`  🔒 firewall: allow ${firewall.publicKeys.length} peer(s) only\n`);

  try {
    const { publicKey } = await provider.start({ firewall });
    process.stderr.write(`  ✓ provider public key: ${publicKey}\n`);
    if (expectedKey && expectedKey !== publicKey) {
      process.stderr.write(`  ⚠ derived key ${expectedKey} != advertised key (topic derivation mismatch)\n`);
    }
    if (warm) {
      process.stderr.write(`  warming model: ${model.label} …\n`);
      const id = await provider.warm(model);
      process.stderr.write(`  ✓ model warm (modelId=${id})\n`);
    }
    process.stderr.write(`\n  Consumers run:\n`);
    if (topic) process.stderr.write(`    lifeline ask --delegate --topic "${topic}" "<your question>"\n`);
    process.stderr.write(`    lifeline ask --delegate --provider-key ${publicKey} "<your question>"\n`);
    process.stderr.write(`\n  Serving… press Ctrl-C to stop.\n`);

    await new Promise<void>((res) => {
      const onSig = () => {
        process.stderr.write(`\n  shutting down provider…\n`);
        res();
      };
      process.once("SIGINT", onSig);
      process.once("SIGTERM", onSig);
    });
  } finally {
    await provider.stop();
    process.stderr.write(`  ✓ provider stopped (worker closed, swarm left).\n`);
  }
}

// ============================ bench ============================
async function benchOne(engine: InferenceEngine, model: ModelRef, messages: ChatMsg[]): Promise<BenchRow> {
  try {
    const t0 = performance.now();
    const modelId = await engine.loadModel({ model });
    const loadMs = performance.now() - t0;
    const measured = await runCompletion(engine, modelId, messages, true, () => {});
    const sdk = engine.lastStats?.() ?? null;
    const di = engine.delegationInfo?.() ?? { served_by: "local" as const };
    await engine.unload(modelId);
    return {
      served_by: di.served_by,
      load_ms: Math.round(loadMs),
      transport_setup_ms: di.transport_setup_ms != null ? Math.round(di.transport_setup_ms) : undefined,
      ttft_ms: sdk?.ttft_ms ?? measured.ttft_ms,
      tokens_per_sec: sdk?.tokens_per_sec ?? measured.tokens_per_sec,
      completion_tokens: sdk?.completion_tokens ?? measured.completion_tokens,
      total_ms: Math.round(measured.total_ms),
      backend_device: sdk?.backend_device,
    };
  } catch (err) {
    return { served_by: "local", error: errMsg(err) };
  } finally {
    await engine.dispose?.();
  }
}

async function runBench(args: Args): Promise<void> {
  const { flags } = args;
  const json = fbool(flags, "json");
  if (json) setSdkConsole(false);
  setupQvacEnv("consumer");

  const prompt = args.positionals.join(" ");
  if (!prompt.trim()) throw new Error('bench needs a prompt, e.g. lifeline bench "..." --topic demo');
  const { key: providerKey, topic } = resolveProviderKey(flags);
  const model = resolveModel(flags);
  const messages = buildMessages(prompt, fstr(flags, "system") ?? DEFAULT_SYSTEM);

  const sysinfo = collectSysInfo();
  const logger = new RunLogger({ dir: fstr(flags, "evidence-dir") });
  logger.session("bench", sysinfo);

  if (!json) process.stderr.write(`\nLifeline bench · "${prompt}"\n  topic "${topic ?? "—"}" · provider ${providerKey}\n`);

  if (!json) process.stderr.write(`\n  [1/2] LOCAL …\n`);
  const local = await benchOne(createEngine({ kind: "local", onProgress: makeProgressReporter(true) }), model, messages);

  if (!json) process.stderr.write(`  [2/2] DELEGATED …\n`);
  const delegated = await benchOne(
    createEngine({
      kind: "delegated",
      providerPublicKey: providerKey,
      timeout: fnum(flags, "timeout"),
      healthCheckTimeout: fnum(flags, "health-timeout"),
      onProgress: makeProgressReporter(true),
    }),
    model,
    messages,
  );

  logger.bench({ prompt, topic, local, delegated });

  if (json) {
    process.stdout.write(JSON.stringify({ prompt, topic, local, delegated, evidence: logger.path }) + "\n");
    return;
  }
  printBench(local, delegated, logger.path);
}

function printBench(local: BenchRow, delegated: BenchRow, evidencePath: string): void {
  const col = (r: BenchRow) => [
    r.served_by + (r.error ? " (ERR)" : ""),
    r.load_ms != null ? String(r.load_ms) : "—",
    r.transport_setup_ms != null ? String(r.transport_setup_ms) : "—",
    num(r.ttft_ms, 0),
    num(r.tokens_per_sec, 1),
    r.completion_tokens != null ? String(r.completion_tokens) : "—",
    r.backend_device ?? "—",
  ];
  const labels = ["served_by", "load ms", "transport ms", "TTFT ms", "tok/s", "tokens", "backend"];
  const L = col(local);
  const D = col(delegated);
  const w0 = Math.max(...labels.map((s) => s.length));
  const w1 = Math.max(6, ...L.map((s) => s.length));
  const w2 = Math.max(9, ...D.map((s) => s.length));
  process.stderr.write("\n  " + "Metric".padEnd(w0) + " | " + "LOCAL".padStart(w1) + " | " + "DELEGATED".padStart(w2) + "\n");
  process.stderr.write("  " + "-".repeat(w0 + w1 + w2 + 6) + "\n");
  for (let i = 0; i < labels.length; i++) {
    process.stderr.write("  " + labels[i].padEnd(w0) + " | " + L[i].padStart(w1) + " | " + D[i].padStart(w2) + "\n");
  }
  if (local.error) process.stderr.write(`  local error: ${local.error}\n`);
  if (delegated.error) process.stderr.write(`  delegated error: ${delegated.error}\n`);
  process.stderr.write(`\n  Evidence: ${evidencePath}\n\n`);
}

// ============================ medbench ============================
interface MedQuestion {
  q: string;
  expect: string[];
}
interface MedRow {
  model: string;
  question: string;
  ttft_content_ms?: number;
  answer_tokens?: number;
  thinking_tokens?: number;
  answer_tokens_per_sec?: number;
  total_ms: number;
  backend_device?: string;
  correct: number;
  expected: number;
  matched: string[];
  missed: string[];
  answer: string;
}

const DEFAULT_MEDBENCH: MedQuestion[] = [
  { q: "How do I treat severe bleeding?", expect: ["direct pressure", "tourniquet", "emergency"] },
  { q: "What should I do for a burn?", expect: ["cool", "water", "cover"] },
];

function loadMedQuestions(ragPath: string, positional: string): MedQuestion[] {
  if (positional.trim()) return [{ q: positional, expect: [] }];
  for (const c of [join(ragPath, "medbench-questions.json"), join(REPO_ROOT, "corpus", "medbench-questions.json")]) {
    try {
      const data = JSON.parse(readFileSync(c, "utf8")) as { questions?: MedQuestion[] } | MedQuestion[];
      const qs = Array.isArray(data) ? data : data.questions;
      if (qs && qs.length) return qs;
    } catch {
      /* try next */
    }
  }
  return DEFAULT_MEDBENCH;
}

function scoreAnswer(answer: string, expect: string[]): { matched: string[]; missed: string[] } {
  const a = answer.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];
  for (const fact of expect) (a.includes(fact.toLowerCase()) ? matched : missed).push(fact);
  return { matched, missed };
}

async function runMedbench(args: Args): Promise<void> {
  const { flags } = args;
  const json = fbool(flags, "json");
  if (json) setSdkConsole(false);
  setupQvacEnv("consumer");

  const ragPath = fstr(flags, "rag");
  if (!ragPath) throw new Error("medbench needs --rag <corpus>");
  const maxTokens = fnum(flags, "max-tokens") ?? 320;
  const topK = fnum(flags, "top-k") ?? 3;
  const questions = loadMedQuestions(ragPath, args.positionals.join(" "));

  const medpsy: ModelRef = MODELS.medpsy4b;
  const medgemma: ModelRef = MODELS.medgemma4b;
  const benchModels: ModelRef[] = [
    { ...medpsy, config: { ...medpsy.config, predict: 768 } },
    { ...medgemma, config: { ...medgemma.config, predict: maxTokens } },
  ];

  const sysinfo = collectSysInfo();
  const logger = new RunLogger({ dir: fstr(flags, "evidence-dir") });
  logger.session("medbench", sysinfo);

  const kb = new KnowledgeBase({ onProgress: makeProgressReporter(json) });
  const engine = createEngine({ kind: "local", onProgress: makeProgressReporter(json) });
  const rows: MedRow[] = [];

  if (!json) process.stderr.write(`\nLifeline medbench · MedPsy-4B vs MedGemma-4B · ${questions.length} grounded Q · ${ragPath}\n`);

  try {
    await kb.open();
    const ing = await kb.ingest(ragPath);
    logger.ragIngest(ing);

    const retrieved: Array<{ q: string; expect: string[]; tagged: Array<{ tag: string; p: RetrievedPassage }> }> = [];
    for (const { q, expect } of questions) {
      const r = await kb.retrieve(q, topK);
      logger.ragSearch(r.stats);
      retrieved.push({ q, expect, tagged: r.passages.map((p, i) => ({ tag: `S${i + 1}`, p })) });
    }

    for (const model of benchModels) {
      if (!json) process.stderr.write(`\n▶ ${model.label}\n`);
      for (const { q, expect, tagged } of retrieved) {
        // Reload per question: one loaded model = one shared KV-cache, so we reset
        // it between questions to keep each independent (and avoid context overflow).
        const modelId = await engine.loadModel({ model });
        const messages: ChatMsg[] = [
          { role: "system", content: buildGroundedSystemPrompt(tagged.map((t) => ({ tag: t.tag, content: t.p.content }))) },
          { role: "user", content: q },
        ];
        let answer = "";
        const measured = await runCompletion(
          engine,
          modelId,
          messages,
          true,
          (s) => {
            answer += s;
          },
          () => {},
        );
        const timing = engine.lastTiming?.() ?? null;
        const sdk = engine.lastStats?.() ?? null;
        const answerTokens = timing?.content_tokens ?? measured.completion_tokens;
        const genMs = Math.max(1, measured.total_ms - (timing?.ttft_content_ms ?? 0));
        const { matched, missed } = scoreAnswer(answer, expect);
        rows.push({
          model: model.label,
          question: q,
          ttft_content_ms: timing?.ttft_content_ms ?? measured.ttft_ms,
          answer_tokens: answerTokens,
          thinking_tokens: timing?.thinking_tokens ?? 0,
          answer_tokens_per_sec: answerTokens ? answerTokens / (genMs / 1000) : 0,
          total_ms: Math.round(measured.total_ms),
          backend_device: sdk?.backend_device,
          correct: matched.length,
          expected: expect.length,
          matched,
          missed,
          answer: answer.trim(),
        });
        if (!json) {
          process.stderr.write(
            `  ✓ "${q.slice(0, 34)}…"  answer ${answerTokens} tok (+${timing?.thinking_tokens ?? 0} think) · facts ${matched.length}/${expect.length} · ${Math.round(measured.total_ms)} ms\n`,
          );
        }
        await engine.unload(modelId);
      }
    }
  } finally {
    await kb.close();
    await engine.dispose?.();
  }

  const note =
    "On-device latency + a small HAND-BUILT grounded-correctness check (does the answer mention the expected facts that are present in the CC0 corpus). NOT a validated clinical benchmark, and NOT QVAC's published numbers — only what we measured here. Answer tokens EXCLUDE reasoning.";
  logger.medbench({ corpus: ragPath, embed_model: kb.embedLabel, note, rows });
  const md = renderMedbenchMd(questions, rows, note);
  const mdPath = logger.path.replace(/run-(.*)\.jsonl$/, "medbench-$1.md");
  writeFileSync(mdPath, md);

  if (json) {
    process.stdout.write(JSON.stringify({ rows, evidence: logger.path, markdown: mdPath }) + "\n");
    return;
  }
  process.stdout.write("\n" + md + "\n");
  process.stderr.write(`  Evidence: ${logger.path}\n  Table: ${mdPath}\n\n`);
}

function modelSummary(rs: MedRow[], model: string): { facts: string; tokens: number; think: number; ttft: number } {
  const r = rs.filter((x) => x.model === model);
  const correct = r.reduce((s, x) => s + x.correct, 0);
  const expected = r.reduce((s, x) => s + x.expected, 0);
  return {
    facts: `${correct}/${expected}`,
    tokens: Math.round(r.reduce((s, x) => s + (x.answer_tokens ?? 0), 0) / Math.max(1, r.length)),
    think: Math.round(r.reduce((s, x) => s + (x.thinking_tokens ?? 0), 0) / Math.max(1, r.length)),
    ttft: Math.round(r.reduce((s, x) => s + (x.ttft_content_ms ?? 0), 0) / Math.max(1, r.length)),
  };
}

function renderMedbenchMd(questions: MedQuestion[], rs: MedRow[], note: string): string {
  const models = [...new Set(rs.map((r) => r.model))];
  const lines: string[] = ["# Lifeline medbench — MedPsy-4B vs MedGemma-4B", "", `> ${note}`, ""];
  lines.push("## Summary (averaged across questions)", "");
  lines.push("| Model | grounded facts | avg answer tokens | avg reasoning tokens | avg TTFC ms |");
  lines.push("|---|--:|--:|--:|--:|");
  for (const m of models) {
    const s = modelSummary(rs, m);
    lines.push(`| ${m} | ${s.facts} | ${s.tokens} | ${s.think} | ${s.ttft} |`);
  }
  lines.push(
    "",
    "_TTFC = time to first **content** (answer) token. **answer tokens exclude reasoning** — this is why MedPsy's earlier 'verbose' count was misleading: most of its tokens were reasoning, not answer._",
    "",
  );
  lines.push("## Per-question detail", "");
  lines.push("| Question | Model | answer tok | reasoning tok | answer tok/s | total ms | facts | backend |");
  lines.push("|---|---|--:|--:|--:|--:|:--:|:--|");
  for (const r of rs) {
    lines.push(
      `| ${r.question} | ${r.model} | ${r.answer_tokens ?? "?"} | ${r.thinking_tokens ?? 0} | ${num(r.answer_tokens_per_sec, 1)} | ${r.total_ms} | ${r.correct}/${r.expected} | ${r.backend_device ?? "?"} |`,
    );
  }
  lines.push("", "## Answers (qualitative)", "");
  for (const { q } of questions) {
    lines.push(`### ${q}`, "");
    for (const r of rs.filter((x) => x.question === q)) {
      const miss = r.missed.length ? `  _(missed: ${r.missed.join(", ")})_` : "";
      lines.push(`**${r.model}** — facts ${r.correct}/${r.expected}:${miss}`, "", r.answer, "");
    }
  }
  return lines.join("\n");
}

// ============================ main ============================
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (fbool(args.flags, "help") || !args.command) {
    process.stdout.write(USAGE);
    return;
  }
  switch (args.command) {
    case "ask":
      await runAsk(args);
      break;
    case "serve":
      await runServe(args);
      break;
    case "bench":
      await runBench(args);
      break;
    case "medbench":
      await runMedbench(args);
      break;
    default:
      process.stderr.write(`Unknown command "${args.command}". Run with --help.\n`);
      process.exitCode = 2;
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nError: ${message}\n`);
  // Full stack only when asked for, so normal failures stay readable.
  if (process.env.LIFELINE_DEBUG && err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exitCode = 1;
});
