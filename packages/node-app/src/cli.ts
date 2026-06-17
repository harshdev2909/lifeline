/**
 * Lifeline CLI — laptop orchestrator (Day 2: + P2P delegated inference).
 *
 * Acceptance invariant: this file depends ONLY on `@lifeline/core` (its
 * `InferenceEngine` interface, `Provider`, logger, sysinfo, p2p helpers). It
 * NEVER imports `@qvac/sdk`. Local vs delegated is chosen by `createEngine`.
 *
 * Commands:
 *   lifeline ask "<q>" [--delegate --topic T | --provider-key K] [--model m]
 *                      [--system s] [--no-stream] [--max-tokens n] [--json]
 *   lifeline serve --topic T [--model m] [--seed hex] [--no-warm]
 *   lifeline bench "<q>" (--topic T | --provider-key K) [--model m] [--json]
 */
import { performance } from "node:perf_hooks";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectSysInfo,
  createEngine,
  DEFAULT_MODEL,
  formatSysInfoTable,
  MODELS,
  Provider,
  RunLogger,
  setSdkConsole,
  topicToProviderKey,
  topicToSeedHex,
} from "@lifeline/core";
import type {
  BenchRow,
  ChatMsg,
  CompletionStats,
  DelegationInfo,
  InferenceEngine,
  MeasuredInference,
  ModelRef,
} from "@lifeline/core";

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
const BOOL_FLAGS = new Set(["delegate", "no-stream", "json", "no-warm", "help", "h"]);
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
  ask "<prompt>"     Run a completion. Add --delegate to offload to a peer.
  serve              Host a model over P2P for peers to delegate to.
  bench "<prompt>"   Run the same prompt local AND delegated; print a comparison.

ask options:
  --delegate                 Offload to a provider (falls back to local if unreachable)
  --topic <t>                Rendezvous topic (derives the provider's key on both sides)
  --provider-key <hex>       Target a specific provider public key (overrides --topic)
  --model <key>              ${Object.keys(MODELS).join(" | ")}  (default: llama1b)
  --system "<text>" | --no-stream | --max-tokens <n>
  --timeout <ms> | --health-timeout <ms> | --json | --evidence-dir <dir>

serve options:
  --topic <t>                Rendezvous topic → deterministic provider identity (recommended)
  --seed <hex>               Raw 32-byte hex seed for the provider identity (advanced)
  --model <key>              Model to pre-load/warm (default: llama1b)
  --no-warm                  Don't pre-load the model (load lazily on first request)

bench options:
  --topic <t> | --provider-key <hex>  (required)   --model <key>   --max-tokens <n>   --json
`;

// --- shared helpers ---
function resolveModel(flags: Args["flags"]): ModelRef {
  const key = fstr(flags, "model") ?? "llama1b";
  const base: ModelRef = MODELS[key as keyof typeof MODELS] ?? DEFAULT_MODEL;
  const maxTokens = fnum(flags, "max-tokens");
  return maxTokens ? { ...base, config: { ...base.config, predict: maxTokens } } : base;
}

function resolveProviderKey(flags: Args["flags"]): { key: string; topic?: string } {
  const explicit = fstr(flags, "provider-key");
  if (explicit) return { key: explicit };
  const topic = fstr(flags, "topic");
  if (topic) return { key: topicToProviderKey(topic), topic };
  throw new Error("delegation needs --topic <t> or --provider-key <hex>");
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
): Promise<MeasuredInference> {
  const t0 = performance.now();
  if (stream) {
    let firstAt = 0;
    let chunks = 0;
    const it = engine.complete({ modelId, messages, stream: true }) as AsyncIterable<string>;
    for await (const tok of it) {
      if (chunks === 0) firstAt = performance.now();
      sink(tok);
      chunks++;
    }
    const total = performance.now() - t0;
    return {
      ttft_ms: firstAt ? firstAt - t0 : total,
      total_ms: total,
      completion_tokens: chunks,
      tokens_per_sec: chunks > 0 ? chunks / (total / 1000) : 0,
    };
  }
  const text = await (engine.complete({ modelId, messages, stream: false }) as Promise<string>);
  sink(text + "\n");
  const total = performance.now() - t0;
  return { ttft_ms: total, total_ms: total, completion_tokens: 0, tokens_per_sec: 0 };
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

  const prompt = args.positionals.join(" ");
  if (!prompt.trim()) throw new Error('missing prompt, e.g. lifeline ask "Explain heat stroke first aid"');

  const model = resolveModel(flags);
  const stream = !fbool(flags, "no-stream");
  const system = fstr(flags, "system") ?? DEFAULT_SYSTEM;
  const out = (s: string) => (json ? undefined : process.stdout.write(s));

  let providerKey: string | undefined;
  let topic: string | undefined;
  if (delegate) {
    const r = resolveProviderKey(flags);
    providerKey = r.key;
    topic = r.topic;
  }

  const sysinfo = collectSysInfo();
  const logger = new RunLogger({ dir: fstr(flags, "evidence-dir") });
  const engine: InferenceEngine = createEngine(
    delegate
      ? {
          kind: "delegated",
          providerPublicKey: providerKey,
          timeout: fnum(flags, "timeout"),
          healthCheckTimeout: fnum(flags, "health-timeout"),
          onProgress: makeProgressReporter(json),
        }
      : { kind: "local", onProgress: makeProgressReporter(json) },
  );
  logger.session(engine.kind, sysinfo);

  if (!json) {
    process.stderr.write(`\nLifeline · ${engine.kind} engine${delegate ? ` · topic "${topic ?? "—"}"` : ""} · no cloud\n`);
    process.stderr.write(formatSysInfoTable(sysinfo) + "\n");
    if (delegate) process.stderr.write(`  Provider key: ${providerKey}\n`);
    process.stderr.write(`  Loading model: ${model.label} …\n`);
  }

  try {
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

    const di: DelegationInfo = engine.delegationInfo?.() ?? { served_by: "local" };
    if (!json) {
      const servedNote = di.served_by === "remote" ? "remote peer" : delegate ? "local (FALLBACK)" : "local";
      process.stderr.write(`  ✓ loaded in ${loadMs.toFixed(0)} ms · served_by: ${servedNote}\n\n💬 ${prompt}\n\n`);
    }

    const measured = await runCompletion(engine, modelId, buildMessages(prompt, system), stream, out);
    if (!json) process.stdout.write("\n");

    const sdk: CompletionStats | null = engine.lastStats?.() ?? null;
    logger.inference({
      modelId,
      prompt_chars: prompt.length,
      prompt_tokens: sdk?.prompt_tokens,
      measured,
      sdk_reported: sdk,
    });

    // delegation / fallback evidence
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

    logger.sdkProfile(engine.profilerSnapshot?.());
    await engine.unload(modelId);
    logger.modelUnload(modelId);

    if (json) {
      process.stdout.write(
        JSON.stringify({
          served_by: di.served_by,
          fallback: delegate && di.served_by === "local",
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
  setupQvacEnv("provider");

  const topic = fstr(flags, "topic");
  const seedFlag = fstr(flags, "seed");
  const seedHex = seedFlag ?? (topic ? topicToSeedHex(topic) : undefined);
  if (!seedHex) throw new Error("serve needs --topic <t> (recommended) or --seed <hex>");
  process.env.QVAC_HYPERSWARM_SEED = seedHex;
  const expectedKey = topic ? topicToProviderKey(topic) : undefined;

  const model = resolveModel(flags);
  const warm = !fbool(flags, "no-warm");

  const provider = new Provider({ onProgress: makeProgressReporter(false) });
  process.stderr.write(`\nLifeline provider · 100% on-device · serving over Holepunch P2P\n`);
  if (topic) process.stderr.write(`  topic: "${topic}"\n`);

  try {
    const { publicKey } = await provider.start();
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
    default:
      process.stderr.write(`Unknown command "${args.command}". Run with --help.\n`);
      process.exitCode = 2;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\n❌ ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
