/**
 * Lifeline CLI — laptop orchestrator.
 *
 * IMPORTANT (Day 1 acceptance criterion #6): this file depends ONLY on
 * `@lifeline/core`'s `InferenceEngine` interface + helpers. It never imports
 * `@qvac/sdk` and never learns whether it's talking to a Local or (Day 2)
 * Delegated engine. Swapping engines is a one-line change in
 * `core/engine.ts::createEngine` — nothing here changes.
 *
 * Usage:
 *   lifeline ask "<prompt>" [--model llama1b|medgemma4b] [--system "<text>"]
 *                           [--no-stream] [--max-tokens N] [--evidence-dir DIR]
 */
import { performance } from "node:perf_hooks";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Redirect QVAC's storage root onto the repo volume.
//
// The SDK keeps its registry corestore AND model cache under HOME_DIR/.qvac.
// `cacheDirectory` config only moves the *model files*, not the corestore, and
// on machines where the home disk is full the corestore can't be created/locked
// (surfacing as "File descriptor could not be locked"). The SDK's Node client
// honors SNAP_USER_COMMON as a HOME_DIR override (checked before os.homedir()),
// so setting it here — before the worker spawns at first loadModel — relocates
// the ENTIRE .qvac tree to <repo>/.qvac-home without touching the global HOME.
// Override by exporting your own SNAP_USER_COMMON (or QVAC_HOME-style) path.
if (!process.env.SNAP_USER_COMMON) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  process.env.SNAP_USER_COMMON = join(repoRoot, ".qvac-home");
}

import {
  collectSysInfo,
  createEngine,
  DEFAULT_MODEL,
  formatSysInfoTable,
  MODELS,
  RunLogger,
} from "@lifeline/core";
import type {
  ChatMsg,
  CompletionStats,
  InferenceEngine,
  MeasuredInference,
  ModelRef,
  ProgressUpdate,
} from "@lifeline/core";

const DEFAULT_SYSTEM = "You are Lifeline, a concise, careful offline assistant. Answer directly.";

interface Args {
  command?: string;
  prompt: string;
  modelKey: string;
  system: string;
  stream: boolean;
  maxTokens?: number;
  evidenceDir?: string;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { prompt: "", modelKey: "llama1b", system: DEFAULT_SYSTEM, stream: true, help: false };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    switch (t) {
      case "-h":
      case "--help":
        a.help = true;
        break;
      case "--no-stream":
        a.stream = false;
        break;
      case "--model":
        a.modelKey = argv[++i] ?? a.modelKey;
        break;
      case "--system":
        a.system = argv[++i] ?? "";
        break;
      case "--max-tokens":
        a.maxTokens = Number(argv[++i]);
        break;
      case "--evidence-dir":
        a.evidenceDir = argv[++i];
        break;
      default:
        if (t.startsWith("-")) throw new Error(`Unknown flag: ${t}`);
        positionals.push(t);
    }
  }
  a.command = positionals.shift();
  a.prompt = positionals.join(" ");
  return a;
}

const USAGE = `
Lifeline — offline-first, on-device AI (QVAC).

Usage:
  lifeline ask "<prompt>" [options]

Options:
  --model <key>        Model to use: ${Object.keys(MODELS).join(" | ")}  (default: llama1b)
  --system "<text>"    System prompt (default: a concise assistant; pass "" to omit)
  --no-stream          Wait for the full answer instead of streaming tokens
  --max-tokens <n>     Cap generated tokens
  --evidence-dir <dir> Where to write the run log (default: <repo>/evidence)
  -h, --help           Show this help

Every run writes an auditable JSONL evidence log and prints a timing summary.
All inference is 100% local via @qvac/sdk — no cloud, ever.
`;

function pct(n: number | undefined): string {
  return typeof n === "number" ? `${Math.round(n * 100)}%` : "";
}

function makeProgressReporter(): (p: ProgressUpdate) => void {
  let lastShown = -1;
  let lastPhase = "";
  return (p) => {
    const phase = p.phase ?? "downloading";
    const frac = typeof p.progress === "number" ? p.progress : undefined;
    const cur = typeof frac === "number" ? Math.round(frac * 100) : -1;
    if (phase !== lastPhase || cur !== lastShown) {
      lastPhase = phase;
      lastShown = cur;
      const label = frac !== undefined ? `${phase} ${pct(frac)}` : phase;
      process.stderr.write(`\r  ⬇ model fetch/prepare: ${label}            `);
      if (cur >= 100) process.stderr.write("\n");
    }
  };
}

function num(n: number | undefined, digits = 1): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

function printSummary(args: {
  model: ModelRef;
  engineKind: string;
  loadMs: number;
  measured: MeasuredInference;
  sdk: CompletionStats | null;
  backend: string | undefined;
  evidencePath: string;
}): void {
  const { measured, sdk } = args;
  const rows: Array<[string, string, string]> = [
    ["Metric", "measured (us)", "SDK-reported"],
    ["model load (ms)", num(args.loadMs, 0), "—"],
    ["TTFT (ms)", num(measured.ttft_ms, 0), num(sdk?.ttft_ms, 0)],
    ["tokens/sec", num(measured.tokens_per_sec, 1), num(sdk?.tokens_per_sec, 1)],
    ["completion tokens", num(measured.completion_tokens, 0), num(sdk?.completion_tokens, 0)],
    ["prompt tokens", "—", num(sdk?.prompt_tokens, 0)],
    ["total time (ms)", num(measured.total_ms, 0), "—"],
  ];
  const w0 = Math.max(...rows.map((r) => r[0].length));
  const w1 = Math.max(...rows.map((r) => r[1].length));
  const w2 = Math.max(...rows.map((r) => r[2].length));
  const line = (r: [string, string, string]) =>
    `  ${r[0].padEnd(w0)} | ${r[1].padStart(w1)} | ${r[2].padStart(w2)}`;

  process.stderr.write("\n");
  process.stderr.write(`  Engine: ${args.engineKind}   Model: ${args.model.label}\n`);
  process.stderr.write(`  Compute backend (SDK-reported): ${args.backend ?? "n/a"}\n`);
  process.stderr.write("  " + "-".repeat(w0 + w1 + w2 + 6) + "\n");
  process.stderr.write(line(rows[0]) + "\n");
  process.stderr.write("  " + "-".repeat(w0 + w1 + w2 + 6) + "\n");
  for (const r of rows.slice(1)) process.stderr.write(line(r) + "\n");
  process.stderr.write(`\n  Evidence: ${args.evidencePath}\n\n`);
}

async function runAsk(args: Args): Promise<void> {
  const model: ModelRef =
    MODELS[args.modelKey as keyof typeof MODELS] ?? DEFAULT_MODEL;
  if (!MODELS[args.modelKey as keyof typeof MODELS]) {
    process.stderr.write(`Unknown model "${args.modelKey}", falling back to ${DEFAULT_MODEL.label}.\n`);
  }
  const modelRef: ModelRef = args.maxTokens
    ? { ...model, config: { ...model.config, predict: args.maxTokens } }
    : model;

  const sysinfo = collectSysInfo();
  const logger = new RunLogger({ dir: args.evidenceDir });
  const engine: InferenceEngine = createEngine({ onProgress: makeProgressReporter() });

  logger.session(engine.kind, sysinfo);

  try {
  process.stderr.write(`\nLifeline · ${engine.kind} engine · 100% on-device (no cloud)\n`);
  process.stderr.write(formatSysInfoTable(sysinfo) + "\n\n");
  process.stderr.write(`  Loading model: ${modelRef.label} …\n`);

  // ---- model load (wall-clock measured) -----------------------------------
  const tLoad0 = performance.now();
  const modelId = await engine.loadModel({ model: modelRef });
  const loadMs = performance.now() - tLoad0;
  logger.modelLoad({
    modelId,
    source: typeof modelRef.src === "string" ? modelRef.src : (modelRef.src as { src?: string }).src ?? modelRef.label,
    label: modelRef.label,
    load_ms: loadMs,
    sdk_load: engine.loadStats?.(),
  });
  process.stderr.write(`  ✓ loaded in ${loadMs.toFixed(0)} ms (modelId=${modelId})\n\n`);

  // ---- inference ----------------------------------------------------------
  const messages: ChatMsg[] = [];
  if (args.system.trim()) messages.push({ role: "system", content: args.system });
  messages.push({ role: "user", content: args.prompt });

  process.stderr.write(`💬 ${args.prompt}\n\n`);

  let measured: MeasuredInference;
  const tInfer0 = performance.now();

  if (args.stream) {
    let firstAt = 0;
    let chunks = 0;
    const it = engine.complete({ modelId, messages, stream: true }) as AsyncIterable<string>;
    for await (const token of it) {
      if (chunks === 0) firstAt = performance.now();
      process.stdout.write(token);
      chunks++;
    }
    process.stdout.write("\n");
    const totalMs = performance.now() - tInfer0;
    const ttft = firstAt ? firstAt - tInfer0 : totalMs;
    measured = {
      ttft_ms: ttft,
      total_ms: totalMs,
      completion_tokens: chunks, // approx: counted yielded stream chunks
      tokens_per_sec: chunks > 0 ? chunks / (totalMs / 1000) : 0,
    };
  } else {
    const text = await (engine.complete({ modelId, messages, stream: false }) as Promise<string>);
    process.stdout.write(text + "\n");
    const totalMs = performance.now() - tInfer0;
    measured = { ttft_ms: totalMs, total_ms: totalMs, completion_tokens: 0, tokens_per_sec: 0 };
  }

  const sdk = engine.lastStats?.() ?? null;
  logger.inference({
    modelId,
    prompt_chars: args.prompt.length,
    prompt_tokens: sdk?.prompt_tokens,
    measured,
    sdk_reported: sdk,
  });

    // ---- SDK profiler snapshot + unload -----------------------------------
    logger.sdkProfile(engine.profilerSnapshot?.());
    await engine.unload(modelId);
    logger.modelUnload(modelId);

    printSummary({
      model: modelRef,
      engineKind: engine.kind,
      loadMs,
      measured,
      sdk,
      backend: sdk?.backend_device,
      evidencePath: logger.path,
    });
  } finally {
    // Always shut down the SDK worker — even if load/inference threw — so it
    // never orphans and holds the model-registry lock for the next run.
    await engine.dispose?.();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    process.stdout.write(USAGE);
    return;
  }
  if (args.command !== "ask") {
    process.stderr.write(`Unknown command "${args.command}". Try: lifeline ask "<prompt>"\n`);
    process.exitCode = 2;
    return;
  }
  if (!args.prompt.trim()) {
    process.stderr.write('Missing prompt. Example: lifeline ask "Explain heat stroke first aid in 3 steps"\n');
    process.exitCode = 2;
    return;
  }
  await runAsk(args);
}

main().catch((err: unknown) => {
  process.stderr.write(`\n❌ ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
