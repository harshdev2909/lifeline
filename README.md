# Lifeline

[![Built with QVAC](https://raw.githubusercontent.com/tetherto/qvac/refs/heads/main/docs/branding/qvac-badge-green-dark.svg)](https://github.com/tetherto/qvac)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

Lifeline is a first-aid assistant that runs entirely on the devices you already have, with no cloud and no internet required to answer a question. When a phone is too weak to run a capable model, it borrows compute from a stronger device on the same network. Every answer is grounded in a local first-aid manual and carries its sources.

## Why this exists

The places that most need decision support during a medical emergency are often the places with the least reliable connectivity: a rural clinic, a disaster zone after the towers go down, a boat, a trail, a region where bandwidth is scarce or metered. A medical assistant that only works when there's a fast link to a data center isn't much use there.

Lifeline assumes the network is unreliable and the data is sensitive. The models run on-device. Nothing about a question, the retrieved guidance, or the answer leaves the hardware in front of you. A laptop can lend its GPU to a phone over a direct peer link, and if that peer drops, the phone quietly falls back to running a smaller model itself rather than failing.

It is built for triage support and first-aid education, not diagnosis. See [Safety](#safety) below.

## What it does

- Answers first-aid questions from a local, citeable corpus instead of from model memory, so you can check where an answer came from.
- Leads with "call emergency services now" when a question describes a life-threatening situation, and **refuses below the grounding threshold** — when the best retrieved passage scores under a fixed cutoff, it declines rather than guessing.
- Takes spoken questions and can speak its answers back.
- Reads a photo: it can describe a visible injury or transcribe a printed label, then ground the advice in the manual.
- Works across languages, including **cross-lingual retrieval**: a question in Spanish or French is translated to the corpus language to retrieve English sources, then the answer comes back in the question's language — so one language's question can be grounded in another's manual.
- Offloads heavy models to a stronger peer over an encrypted peer-to-peer link, and falls back to local inference when no peer is reachable or a peer stalls mid-answer.
- Produces a structured **incident report** from a triage exchange — the question, the grounded guidance with its citations, the safety severity, model, and where it ran — exportable as Markdown/JSON and handable to a reviewer.
- Can run as an **unattended responder**: a node auto-answers triage questions from the mesh through the full grounded chain, gated by an allowlist, with a live operator feed.
- Degrades gracefully on a **constrained link**: terse, byte-budgeted answers split into UTF-8-safe chunks with per-chunk retry, for a narrow or lossy channel.
- Treats anything it reads from a document, an image, or a peer as untrusted data. A "ignore your instructions" line hidden in a scanned label is quoted, never obeyed.
- Writes a structured log of every run (timings, which device served it, what was retrieved, what safety checks fired) so a run can be audited after the fact.

## Quick look

A grounded answer with its sources and the standing disclaimer:

```
$ lifeline ask --model medpsy4b --rag corpus/ "How should I treat a burn?"

Cool the burn under cool (not ice-cold) running water for at least 20 minutes [S1].
Remove jewelry and loose clothing near the burn before swelling starts, but do not
pull away anything stuck to the skin [S1]. Cover it loosely with a clean, non-stick
dressing, and avoid butter, oils, toothpaste, or ice [S1]. Seek emergency care for
burns that are large, deep, or on the face, hands, feet, or genitals [S1].

Sources (retrieved locally from the field manual):
  [S1] field-first-aid § Burns  (score 0.66)

Lifeline gives first-aid education and triage support, not a medical diagnosis.
It can be wrong or incomplete. In any emergency, call your local emergency number.
```

Offload the same question to a peer, with automatic fallback if it's unreachable:

```
$ lifeline serve --topic clinic --model medpsy4b          # on the strong device
$ lifeline ask --delegate --topic clinic --rag corpus/ "How do I treat severe bleeding?"
  served_by: remote peer        # or "local (fallback)" if the peer is gone
```

## Quick start

You need Node.js 22.17 or newer (developed on Node 24). QVAC uses Metal on macOS and Vulkan on Linux/Windows, with a CPU fallback.

```bash
npm install
npm run lifeline -- ask "Explain heat stroke first aid in three steps"
```

The convenience launcher `./lifeline` is equivalent to `npm run lifeline --`. The first run downloads model weights (a few hundred MB for the default model) over the QVAC registry and caches them on disk; after that it runs offline. `npm run demo` walks through the main capabilities end to end.

Each run appends one JSON-per-line log to `evidence/`. A few representative ones are checked in under [`examples/logs/`](./examples/logs) (a grounded answer, a delegated run, an offline fallback, a blocked injection, and more) so you can see the schema without running anything.

## Web interface

A local web interface ships alongside the CLI. It runs in the browser, talks only to a localhost bridge over the same `core`, and does no inference itself — every answer, metric, citation, peer, and animation is real data streamed from the engine.

```bash
npm run ui
```

This builds the UI and serves it from the bridge at `http://127.0.0.1:8787`. It is offline-first: fonts and assets are self-hosted and bundled, there is no runtime CDN, and it loads and runs with the network off. For live development, run `npm run bridge` and `npm run web` (the Vite dev server) in separate terminals.

The interface is a focused conversation. Answers stream in token by token; chain-of-thought is shown in a separate, collapsible aside rather than inline; citation chips expand to the exact source snippet; and a quiet indicator shows where each answer ran — this device, a peer, or rerouted home — beside a time-to-first-token and tokens-per-second readout in a monospace face. The red-flag emergency, grounded, and ungrounded-refusal states each have their own calm treatment, and the disclaimer is always present. Image attachment (vision and OCR), a language selector, light and dark themes, and full keyboard and screen-reader support are all included.

**Live voice.** A hands-free spoken mode holds a continuous conversation on-device: the mic streams to the bridge, Whisper's own voice-activity detection ends each turn on a pause, the grounded model answers, and the answer is spoken back as it is generated — no button between turns. Talking over the assistant interrupts it. A calm state machine (listening → thinking → speaking) and a live captioned transcript keep it glanceable; it degrades honestly to a snappy turn-based mode where streaming isn't available. After the first turn the model worker stays warm, so subsequent turns — local or delegated — skip the cold load and the peer handshake.

**Mesh control panel.** The mesh view is an instrument, not a diagram. It shows this device and its peers with live status, roles, and models; connect or disconnect a peer by topic or key; flip routing between this device and a peer and see each turn's decision explained (the probe ladder, the winner, any fallback); read real per-peer served-turn stats; and toggle this device to serve a model to others, making the mesh bidirectional. Blind relays are configurable too — relay public keys help a delegated link cross strict NAT/firewalls, and the panel reports relay-assist honestly. Every value is real — no placeholder peers or invented metrics.

**Capability suite.** Beyond the conversation, the workspace is a rail of tools, each named for its field use case and sharing one layout — an input, a local-or-peer run control, streamed or typed output, a monospace telemetry strip, and a link to that run's on-device evidence log. *See*: analyze a photo for observable findings; a screening aid (capture-triage a document to the reader, or screen an image against a fixed medical label set with code-side validation); generate a simple instructional first-aid illustration; and animate a short instructional clip (heavy — see below). *Read & translate*: read a label or note (OCR) and two-way offline translation. *Listen & speak*: dictate a note (transcription) and read guidance aloud (speech). *Knowledge*: semantic search across the manual with similarity scores, and a corpus inspector. *Converse*: the triage chat plus a clinical-note writer (SOAP, or a plain-language explainer). *Records*: incident reports — a structured record of a triage exchange with its citations, exportable as Markdown/JSON and handable to a reviewer. *Network*: the mesh panel, an unattended responder that auto-answers peers' questions through the grounded chain behind an allowlist, and a constrained-link mode that holds a terse, byte-budgeted, chunked answer together over a narrow channel. *Adapt*: train a LoRA adapter on a local set, run a frozen eval, then compare the base and adapted model on the same prompt. Every tool runs real on-device inference and writes an evidence event.

Video generation (Animate) is included but heavy and opt-in: ~14.5 GB of models (Wan 2.1 T2V) and several minutes per short clip, with that cost stated in the tool. Two SDK capabilities are left off entirely, and labelled as such in the app: BCI and VLA — both present in `@qvac/sdk` 0.13.3, but one needs EEG-class hardware and the other drives a robot, so neither has a field-medic use case here.

| | |
|---|---|
| ![A grounded answer with an expanded citation and the telemetry readout](docs/screenshots/02-grounded-answer.png) | ![A real delegation: completion runs on a peer while the mesh shows it serving](docs/screenshots/07-delegation-midflight.png) |
| A grounded answer with an expanded citation and the per-turn readout | A real delegation — completion runs on a peer; the mesh shows it serving |

More screenshots — the red-flag emergency state, the light theme, the live mesh, the [voice surface](docs/screenshots/09-voice-listening.png), and the [mesh control panel](docs/screenshots/10-mesh-control.png) — are in [`docs/screenshots/`](./docs/screenshots).

## How it works

Lifeline is a small core library with a CLI and a web interface on top of it. Neither the CLI nor the browser touches the model SDK directly; they talk to one interface, `InferenceEngine`, and a factory decides whether a given call runs on this device or on a peer. That single seam is what makes delegation invisible to the rest of the code. The web interface adds a thin localhost bridge (`packages/server`) that wraps the same engine and streams its events to the browser (`packages/web`); the browser runs no model and makes no network calls beyond localhost.

Delegation rides on QVAC's peer-to-peer stack (Holepunch/Hyperswarm). A device that wants to host a model runs `serve`; a device that wants to borrow it adds `--delegate`. Before sending work, the consumer sends a liveness probe; if the peer doesn't answer, or goes quiet partway through streaming an answer, the engine cancels the remote request and re-runs locally on a smaller model. When several peers are available, it tries them in a stated order of preference and falls through to local only if none respond.

Medical answers go through retrieval before generation. The question is embedded, matched against a local vector store built from the first-aid corpus, and the top passages are handed to the model with instructions to answer only from them and to cite each one. A non-English question is translated to the corpus language before retrieval, so a Spanish or French query is grounded in the English manual and answered back in the original language — cross-lingual retrieval, not just translation. A safety layer wraps this: it detects emergency red flags and leads with a call-for-help, it **refuses below a fixed grounding-score threshold** — when the best retrieved passage scores under the cutoff it declines rather than inventing an answer — and it appends a disclaimer that the code does not allow the model to drop. Retrieved text, image descriptions, OCR output, and anything returned by a peer are fenced as untrusted data so a planted instruction can't hijack the response.

The field-readiness features build on this same core. An incident report is assembled only from data a run already produced. The unattended responder runs the identical grounded chain on an incoming question and can delegate the heavy completion to a peer over the real QVAC channel. Because QVAC's peer link carries model inference rather than arbitrary messages, the question/answer envelope and the incident handoff are an app-layer protocol over the localhost bridge (the only network the browser uses) — stated plainly in the responder and incident surfaces; on a multi-node deployment they ride the mesh, while heavy inference always uses the real delegated channel.

Everything runs through on-device models from the QVAC SDK: a small general model, a medical model for grounded answers, an embedding model for retrieval, Whisper for speech, a text-to-speech voice, a vision model, translation models, an OCR recognizer, a bundled image classifier, a Stable Diffusion model for illustrations, a Wan text-to-video model for short clips, and on-device LoRA fine-tuning. For the full picture, see [docs/architecture.md](./docs/architecture.md).

## Privacy and offline guarantees

The model inputs and outputs never leave your devices. Questions, retrieved passages, answers, audio, and images are processed on-device, or on a peer you connect to over an end-to-end-encrypted link. No prompt or model output is ever sent to a third-party service.

There is one network dependency, and it is discovery only. To find a peer by its public key and punch through NAT, the peer-to-peer layer uses the public Hyperswarm DHT. Coordination metadata (public keys, connection setup) crosses it; prompts, answers, and model weights do not. It is disclosed in full in [`remote-apis.yaml`](./remote-apis.yaml). On a closed network you can skip it entirely with a pre-shared provider key and a local bootstrap node. Single-device use needs no network at all once the weights are cached.

Model weights are fetched once, on first use, over the QVAC registry, then cached on disk and used offline.

## Safety

Lifeline gives first-aid education and triage support. It is not a medical professional, it does not diagnose, and it can be wrong or incomplete. In any emergency, call your local emergency number and follow a trained dispatcher. The disclaimer is attached to every answer in code and cannot be turned off, and questions that describe life-threatening situations are answered with a call for emergency help first.

The bundled corpus is a general first-aid reference for demonstration. It is not a substitute for certified training or professional care.

## Models

All models run on-device and are cached after first download.

| Model | Role | Size | Source | License |
|---|---|---|---|---|
| Llama 3.2 1B Instruct (Q4_0) | default general model | ~0.7 GB | QVAC registry | Llama 3.2 |
| MedPsy-4B (Q4_K_M) | grounded medical answers | ~2.5 GB | Hugging Face (`qvac/MedPsy-4B-GGUF`) | per MedPsy |
| MedGemma 4B IT (Q4_1) | medical comparison | ~2.6 GB | QVAC registry | per MedGemma |
| EmbeddingGemma 300M (Q8_0) | retrieval embeddings | ~0.3 GB | QVAC registry | per EmbeddingGemma |
| Whisper base (Q8_0), English + multilingual | speech to text | ~0.08 GB | QVAC registry | MIT |
| Supertonic (Q8_0) | text to speech | small | QVAC registry | per Supertonic |
| SmolVLM2-500M + mmproj (Q8_0) | image understanding | ~0.5 GB | QVAC registry | per SmolVLM2 |
| Bergamot (es/fr ↔ en) | translation | small | QVAC registry | per Bergamot |
| OCR Latin recognizer | reading printed text | small | QVAC registry | per recognizer |

## License and acknowledgements

Licensed under [Apache-2.0](./LICENSE).

Built on the [QVAC SDK](https://github.com/tetherto/qvac), which provides the on-device inference, the model registry, and the peer-to-peer transport. The bundled first-aid corpus is original content dedicated to the public domain (CC0); see [`corpus/SOURCE.md`](./corpus/SOURCE.md). Test images and the injection-test fixtures are synthetic and likewise CC0, documented alongside the files that use them.
