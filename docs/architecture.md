# Architecture

Lifeline is a small core library (`@lifeline/core`) and a CLI (`@lifeline/node-app`) that drives it. The core holds everything that touches the QVAC SDK; the CLI holds none of it. This document explains the seams and the request flow.

## The engine seam

Every model call goes through one interface, `InferenceEngine` (`packages/core/src/types.ts`):

```ts
interface InferenceEngine {
  readonly kind: "local" | "delegated";
  loadModel(opts: { model: ModelRef }): Promise<string>;
  complete(opts: { modelId: string; messages: ChatMsg[]; stream?: boolean }):
    AsyncIterable<string> | Promise<string>;
  unload(modelId: string): Promise<void>;
  // optional, engine-neutral hooks for evidence: lastStats, lastTiming,
  // delegationInfo, profilerSnapshot, dispose, ...
}
```

`createEngine()` (`packages/core/src/engine.ts`) is the only place that decides which implementation to build:

- `LocalEngine` runs the model on this device through the QVAC SDK.
- `DelegatedEngine` runs it on a peer over the peer-to-peer transport, and falls back to a `LocalEngine` when it has to.

The CLI calls `createEngine()` and then only the interface. It cannot tell which engine answered, which is what keeps delegation from leaking into the rest of the code. All QVAC-specific names (functions, stat fields, the profiler) stay inside `engine.ts` and the other core modules, so callers never import the SDK.

## Local and delegated execution

A device hosts a model with `lifeline serve`, which calls `startQVACProvider` and advertises on the Hyperswarm DHT under a keypair. The keypair is derived deterministically from a topic string (`seed = sha256("lifeline:" + topic)`), so two devices that share a topic compute the same provider key without exchanging it. A specific key can also be passed directly with `--provider-key`.

A consumer adds `--delegate`. `DelegatedEngine.loadModel` first sends a `heartbeat` to the provider; this both checks liveness and warms the link, and its latency is recorded as transport setup. If the probe fails, the engine loads a local model instead and records why.

During streaming, a watchdog bounds the wait for the first event and for each subsequent event. If the provider goes silent past the threshold, or the connection errors, the engine cancels the remote request and re-runs locally, recording a fallback with its reason. The result is that a delegated call either streams from the peer or transparently completes on-device; it does not hang.

With more than one peer, `--peers "<label@topic-or-key>,..."` gives an ordered preference list. The engine probes each in turn, routes to the first that answers, and falls through to local only when none do. Each probe and the chosen peer are recorded.

## Grounded answers and safety

Medical questions run retrieval before generation (`packages/core/src/rag.ts`, `safety.ts`):

1. The corpus is chunked and embedded once with EmbeddingGemma into QVAC's vector workspace. The source of each chunk is encoded in its id so citations can be reconstructed.
2. The question is embedded and matched; the top passages come back with scores.
3. The passages are placed in the system prompt under an instruction hierarchy: only the system message and the user's question are trusted, and the passages are data to quote and cite, never instructions to follow.
4. The model answers, citing passages by tag (`[S1]`, `[IMG]`, `[OCR]`).

A safety layer wraps this and is enforced in code rather than left to the model:

- A red-flag detector recognizes life-threatening descriptions and leads the answer with a call for emergency help.
- A grounding guard refuses to answer (no model call) when the top retrieval score is below a threshold, instead of inventing guidance.
- A disclaimer is appended to every answer and cannot be suppressed.
- An injection detector scans untrusted text and flags planted instructions; whether or not it fires, that text is always fenced as data.

The same fencing applies to image descriptions, OCR output, and anything returned by a peer.

## Other modalities

- Voice in: Whisper transcribes a WAV to text, which becomes the question. With a non-English target language, the multilingual Whisper is used.
- Voice out: Supertonic synthesizes the answer text to a WAV.
- Vision: SmolVLM2 describes the observable contents of an image. That description becomes a cited passage, and the medical model grounds the advice in it plus the manual. Vision can run on a peer.
- OCR: the Latin recognizer extracts printed text, which is treated as untrusted input and fenced.
- Translation: Bergamot translates a non-English question to English, the normal grounded chain runs, and the answer is translated back, preserving citations.

## Evidence log

Each run appends one JSON object per line to `evidence/run-<timestamp>.jsonl`. Event types are discriminated by `type`: `session`, `model_load`, `inference`, `model_unload`, `delegation`, `fallback`, `routing`, `rag_ingest`, `rag_search`, `safety`, `grounding_check`, `injection_guard`, `vision`, `tts`, `translation`, `stt`, `ocr`, `medbench`, `bench`, `sdk_profile`.

Numeric fields are labelled as measured (wall-clock, by Lifeline) or SDK-reported (by QVAC). Measured time-to-first-token includes Lifeline's own overhead, so it is always at least the SDK's figure; the gap is that overhead. For reasoning models, the answer's time-to-first-token and the reasoning time are recorded separately, so the reasoning phase is visible rather than hidden in the latency.

Representative logs are checked in under [`examples/logs/`](../examples/logs).

## Web interface and the bridge

The CLI is one consumer of `core`; the web interface is another, split in two: a localhost bridge (`packages/server`) and a browser app (`packages/web`).

The bridge wraps the same engine, retrieval, safety, and modality chain the CLI uses and exposes them over a WebSocket — streaming a turn's answer tokens, separated reasoning, citations, per-turn telemetry, the served-by indicator, mesh routing, fallback, and safety events — plus a small HTTP API for settings, a mesh snapshot and on-demand peer probe, raw-body uploads for image and audio, and generated speech. It is the event-driven sibling of the CLI's `ask`: where the CLI writes to a terminal, the bridge emits structured events. It runs each turn as a full lifecycle, serialized one at a time so a single QVAC worker and corestore are never contended, and writes the same evidence log. It imports only `@lifeline/core`, so the SDK boundary holds: the bridge does no inference, and the browser does none either.

The browser app talks only to that bridge, over localhost. It is bundled with its fonts and assets self-hosted, so it loads and runs with the network off; the bridge serves the built app from a single origin. On-demand peer liveness for the mesh visualizer uses `probePeers` in `core/mesh.ts`, which wraps the same heartbeat the delegated engine uses during routing, so the mesh shows real status rather than a guess.

## Storage

QVAC keeps its model registry and downloaded weights under a home directory. Lifeline points that at a repo-local `.qvac-home/` (and `.qvac-home-consumer/` for a consumer process on the same machine) via the SDK's `SNAP_USER_COMMON` override, so weights stay off a small home disk and next to the project. A second or third provider on one machine can be given its own corestore with `serve --home <dir>`.
