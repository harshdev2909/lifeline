# Lifeline

[![Built with QVAC](https://raw.githubusercontent.com/tetherto/qvac/refs/heads/main/docs/branding/qvac-badge-green-dark.svg)](https://github.com/tetherto/qvac)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

**Lifeline** is a self-organizing, **offline-first, peer-to-peer AI mesh** of everyday devices
(phone + laptop + Raspberry Pi) that delivers private medical triage-support, multilingual
voice translation, and document intelligence with **zero cloud dependency**. Heavy queries are
transparently delegated to whichever peer is strongest; weak or disconnected peers degrade
gracefully to local inference. All AI runs on-device through the [QVAC SDK](https://github.com/tetherto/qvac)
(`@qvac/sdk`) — there are **no cloud AI APIs, ever** (see [`remote-apis.yaml`](./remote-apis.yaml)).

Built for **Tether's QVAC Hackathon I — “Unleash Edge AI.”**

### 5-day plan
| Day | Focus |
|----|-------|
| **1 ✅** | Local QVAC inference spine on the laptop + engine abstraction + evidence/profiling pipeline + repo hygiene. |
| **2 ✅** | P2P **delegated** inference over QVAC's Holepunch stack (`serve` / `ask --delegate` / `bench`), with transparent fallback-to-local. |
| 3 | Medical vertical — MedGemma/MedPsy + RAG over an offline field manual + voice (STT/TTS) + translation. |
| 4 | Multimodal (vision/OCR), the Raspberry Pi node, prompt-injection hardening of the delegated path. |
| 5 | 5-min demo video, reproducibility, evidence bundle, submission. |

> Days 1–2 done. The CLI talks only to `core`'s `InferenceEngine`; `createEngine()` returns a
> `LocalEngine` or a `DelegatedEngine` (P2P) with no caller changes — see
> [Engine abstraction](#engine-abstraction) and [P2P delegated inference](#p2p-delegated-inference-day-2).

---

## Quick start

### Prerequisites
- **Node.js ≥ 22.17** (developed and verified on Node 24.10). The QVAC SDK also supports the
  Bare and Expo runtimes; Lifeline targets the Node.js runtime on the laptop for Day 1.
- macOS / Linux / Windows on a single consumer device (no multi-GPU clusters). QVAC uses
  **Metal** on macOS, **Vulkan** on Linux/Windows, with a CPU fallback.
- ~1 GB free disk for the default model weights (downloaded once, then fully offline).

### Install
```bash
npm install
```
This installs `@qvac/sdk` and the dev toolchain. All of the SDK's mobile/Bare/Electron peer
dependencies are *optional*, so a plain `npm install` is clean on Node.

### Run
```bash
# Capture this machine's hardware + runtime metadata
npm run sysinfo

# Ask a question — loads a model via @qvac/sdk, streams a real LOCAL completion,
# then prints a timing summary. (First run downloads ~773 MB of model weights; cached after.)
./lifeline ask "Explain heat stroke first aid in 3 steps"

# Equivalent without the wrapper:
npm run lifeline -- ask "Explain heat stroke first aid in 3 steps"
```

Options: `--model llama1b|medgemma4b`, `--system "<text>"`, `--no-stream`, `--max-tokens N`,
`--evidence-dir DIR`. Run `./lifeline --help` for details.

- `llama1b` — **Llama 3.2 1B Instruct (Q4_0)**, the fast default (~773 MB).
- `medgemma4b` — **MedGemma 4B IT (Q4_1)**, the medical model from the QVAC registry (the
  Day-3 medical-vertical candidate; larger download).

### Where evidence lands
Every run writes an auditable JSONL log to **`evidence/run-<ISO timestamp>.jsonl`** (one event
per line: `session`, `model_load`, `inference`, `model_unload`, `sdk_profile`). A sample run is
committed at [`evidence/run-sample.jsonl`](./evidence/run-sample.jsonl); the rest are gitignored.
Each numeric field is explicitly labelled **measured (by us, wall-clock)** vs **SDK-reported
(by QVAC)**.

### Model cache / storage
QVAC stores its model registry corestore + downloaded weights under `HOME_DIR/.qvac`. To keep
weights off a small/full home disk (and reproducibly next to the project), the CLI redirects
QVAC's storage root to a gitignored **`.qvac-home/`** inside the repo via the SDK's
`SNAP_USER_COMMON` home-override (no global `HOME` change). First run downloads the weights
there over the QVAC registry (P2P Hyperdrive); every later run loads from disk and is fully
offline. Override by exporting your own `SNAP_USER_COMMON=/abs/path` before running.

---

## Engine abstraction

The CLI and every future caller depend ONLY on the `InferenceEngine` interface in
[`packages/core/src/types.ts`](./packages/core/src/types.ts):

```ts
interface InferenceEngine {
  readonly kind: "local" | "delegated";
  loadModel(opts: { model: ModelRef }): Promise<string /* modelId */>;
  complete(opts: { modelId: string; messages: ChatMsg[]; stream?: boolean }):
    AsyncIterable<string> | Promise<string>;
  unload(modelId: string): Promise<void>;
  // optional, engine-neutral evidence surface:
  lastStats?(): CompletionStats | null;
  loadStats?(): Record<string, number>;
  profilerSnapshot?(): unknown;
  dispose?(): void;
}
```

`createEngine()` in [`packages/core/src/engine.ts`](./packages/core/src/engine.ts) returns a
**`LocalEngine`** (QVAC-backed, on-device) or a **`DelegatedEngine`** (P2P) — the CLI can't tell
them apart. The delegated engine uses QVAC's `loadModel({ ..., delegate: { providerPublicKey } })`
and falls back to local (via a `heartbeat()` probe) when the provider is unreachable.

## P2P delegated inference (Day 2)

A weak device offloads a whole completion to a stronger peer; if the peer is gone it degrades to
local — same `InferenceEngine`, so callers never change.

```bash
# Terminal A — host a model for peers (prints the provider's public key):
./lifeline serve --topic demo --model llama1b

# Terminal B — delegate a completion to that peer over end-to-end-encrypted P2P:
./lifeline ask --delegate --topic demo "Explain heat stroke first aid in 3 steps"
#   → served_by: remote peer   (or "local (FALLBACK)" if the provider is down)

# Side-by-side local vs delegated benchmark:
./lifeline bench --topic demo "Explain heat stroke first aid in 3 steps"
```

`--topic <t>` is a convenience: both sides derive the **same** provider key from the topic
(`seed = sha256("lifeline:"+topic)`, `key = DHT.keyPair(seed)`), so no key-copying is needed —
the topic is a pre-shared secret. Use `--provider-key <hex>` to target a specific peer. Add
`--json` for machine-readable output.

**How it actually works (verified, not per-spec):**
- **No topics in QVAC** — delegation targets a provider **public key**; `--topic` derives it
  deterministically (verified `DHT.keyPair(seed)` == `hypercore-crypto.keyPair(seed)`).
- **Topology tested:** two **separate OS processes** on one Mac over **real Holepunch** (not
  in-memory). Each role gets its own registry corestore (`.qvac-home` vs `.qvac-home-consumer`)
  with a **shared model-weights cache**, so a long-lived provider's corestore lock never collides.
- **Runtime:** both provider and consumer run on **Node.js** (the internal Bare worker does the DHT).
- **Discovery needs the internet** by default: peers find each other and holepunch via the public
  **Hyperswarm DHT** (first connect ≈ 5–9 s). Disclosed in [`remote-apis.yaml`](./remote-apis.yaml)
  as a *discovery-only* dependency — **prompts/weights never touch the DHT**. Offline/LAN needs a
  pre-shared key (we have it) + a local DHT bootstrap or swarm relays (not exercised; WAN was up).
- **Encryption:** the peer link is end-to-end encrypted (Holepunch Noise/UDX) per the docs; logged
  in evidence as `e2e_encrypted: "per-docs"` (not independently verified in code).
- **Fallback:** a `heartbeat()` liveness probe; on failure the engine runs a local model and logs a
  `fallback` event. New evidence event types: `delegation`, `fallback`, `bench`.

**Day 3 plugs in here:** the medical vertical (MedGemma + RAG) reuses the *same*
`InferenceEngine`/`createEngine()` — a RAG step builds the prompt, then `engine.complete()` runs
locally **or** delegated unchanged. Model already wired: `--model medgemma4b`.

### Repo layout
```
lifeline/
  package.json            # npm workspaces root + scripts
  LICENSE                 # Apache-2.0
  remote-apis.yaml        # disclosure of remote network deps (DHT discovery; no cloud AI)
  qvac.config.js          # shared model-weights cache location (off the full home disk)
  .nvmrc                  # pinned Node version
  lifeline                # ./lifeline ask|serve|bench convenience launcher
  packages/
    core/                 # the important package — SDK-agnostic; all @qvac/sdk use is here
      src/
        engine.ts         # InferenceEngine + LocalEngine + DelegatedEngine (P2P) + createEngine
        provider.ts       # Provider role (startQVACProvider/warm/stop) for `serve`
        p2p.ts            # topic → deterministic provider public key
        logger.ts         # JSONL evidence (session/model_load/inference/delegation/fallback/bench)
        sysinfo.ts  sdklog.ts  types.ts  index.ts
    node-app/             # laptop orchestrator CLI (talks ONLY to @lifeline/core)
      src/cli.ts          # ask | serve | bench
  evidence/               # run-<ISO>.jsonl logs (one sample committed)
```

> **Why npm workspaces?** Zero extra tooling — it ships with Node ≥ 22, keeps dependencies
> minimal, and `package-lock.json` makes installs deterministic (reproducibility is graded).
> The phone/laptop/Pi nodes will share `@lifeline/core` unchanged.

---

## Hardware used

Captured via `npm run sysinfo` on the development machine. **At submission, attach a
macOS System Profiler (or equivalent) screenshot alongside this table.**

| Field | Value |
|------|-------|
| Runtime | Node v24.10.0 (V8 13.6.233.10-node.28) |
| Platform | darwin / arm64 (release 24.5.0) |
| CPU | Apple M4 |
| CPU cores | 10 @ 2400 MHz |
| RAM | 16 GB |
| QVAC accel backend | Metal (expected); authoritative cpu/gpu value recorded per-inference in the evidence log |

Re-run `npm run sysinfo` on your machine to regenerate this for your hardware.

---

## License
[Apache-2.0](./LICENSE). This repository is public.
