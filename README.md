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
| **1 (this commit)** | Local QVAC inference spine on the laptop + engine abstraction + evidence/profiling pipeline + repo hygiene. |
| 2 | P2P **delegated** inference between two real devices over QVAC's Holepunch/Pears stack, with `fallbackToLocal`. |
| 3 | Medical vertical — MedGemma/MedPsy + RAG over an offline field manual + voice (STT/TTS) + translation. |
| 4 | Multimodal (vision/OCR), the Raspberry Pi node, prompt-injection hardening of the delegated path. |
| 5 | 5-min demo video, reproducibility, evidence bundle, submission. |

> **Day 1 is foundation only.** It is built so that Day 2 (swapping the local engine for a
> delegated P2P one) is a *one-line change* — see [Engine abstraction](#engine-abstraction).

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

Day 1 ships **`LocalEngine`** (QVAC-backed, on-device). **The single place Day 2 plugs in** is
`createEngine()` in [`packages/core/src/engine.ts`](./packages/core/src/engine.ts) — the
`case "delegated"` branch, where a `DelegatedEngine` implementing the *same* interface will use
QVAC's `loadModel({ ..., delegate })` + `startQVACProvider({ topic })` with `fallbackToLocal`.
**The CLI needs zero changes.**

### Repo layout
```
lifeline/
  package.json            # npm workspaces root + scripts
  LICENSE                 # Apache-2.0
  remote-apis.yaml        # disclosure of every remote API call (Day 1: none)
  lifeline                # ./lifeline ask "..." convenience launcher
  packages/
    core/                 # the important package — SDK-agnostic interface + QVAC LocalEngine
      src/{engine,logger,sysinfo,types,index}.ts
    node-app/             # laptop orchestrator CLI (talks only to @lifeline/core)
      src/cli.ts
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
