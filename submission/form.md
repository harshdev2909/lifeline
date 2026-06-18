# Submission form copy — Lifeline

> Draft for the DoraHacks submission form. Fill the bracketed placeholders before
> submitting. Keep every claim consistent with the README, the evidence logs, and
> the video.

## Project name
Lifeline

## One-line description
An offline-first first-aid assistant that runs entirely on the devices you already have, grounds every answer in a local manual with citations, and borrows compute from a stronger peer over an encrypted P2P link when a device is too weak.

## Short description (≈ 50 words)
Lifeline answers first-aid questions on-device, with no cloud and no internet needed to answer. Answers are retrieved from a local manual and cited; emergencies lead with "call for help"; ungrounded questions are declined, not guessed. A weak device delegates inference to a stronger peer and falls back to local if the peer drops.

## Long description
The places that most need medical decision support — a rural clinic, a disaster zone after the towers go down, a boat, a trail — often have the least reliable connectivity. Lifeline assumes the network is unreliable and the data is sensitive: every model runs on-device, and nothing about a question, the retrieved guidance, or the answer leaves the hardware in front of you.

When a phone is too weak to run a capable model, it borrows the GPU of a stronger device on the same network over a direct, end-to-end-encrypted peer link; if that peer drops mid-answer, the phone quietly falls back to a smaller local model rather than failing. Medical answers go through retrieval before generation, cite their sources, lead with a call for emergency help on a red flag, and decline below a grounding-score threshold instead of inventing an answer. Untrusted text from a document, image, or peer is fenced as data so a planted instruction can't hijack the response. Every run writes a structured, auditable evidence log (model loads, TTFT, tokens/sec, what was retrieved, which device served it).

Beyond the conversation, Lifeline is a full field toolkit: read a label (OCR), describe a photo (vision), dictate and speak, translate two-way, search the manual semantically, write a clinical note, screen an image, illustrate a step, and fine-tune a small LoRA adapter — each on-device, each logging evidence. Three field-readiness features round it out: structured **incident reports** (exportable, handable to a reviewer), an **unattended responder** that auto-answers a peer's triage questions through the grounded chain behind an allowlist, and a **constrained-link mode** that keeps a terse, byte-budgeted, chunked answer intact over a narrow or lossy channel.

Lifeline is triage support and first-aid education, not a diagnosis. The disclaimer is attached to every answer in code and cannot be turned off.

## Track
General Purpose models (primary) and Psy Models (the medical model is the grounded triage path). The peer-to-peer mesh — delegating inference from a weak device to a stronger one, with automatic fallback — also supports a Tinkerer/Mobile narrative. We demonstrate the General Purpose + Psy path end to end; the mesh delegation is real and logged, shown between two devices.

## How we use QVAC
Every capability is a real `@qvac/sdk` model running on-device (or on a peer over P2P). `core` is the only package that imports the SDK.

- **Completion** — grounded medical answers (MedPsy-4B) and a fast general model (Llama 3.2 1B).
- **Embeddings + RAG** — `ragIngest`/`ragSearch` over a local vector store built from the first-aid corpus; answers cite the retrieved passages.
- **Multimodal vision** — describe a wound/rash/scene from a photo (SmolVLM2).
- **OCR** — read a medication label or handwritten note (`ocr`).
- **Transcription** — speech-to-text for voice-in and dictation (Whisper, English + multilingual).
- **Text-to-speech** — speak answers back (Supertonic); live hands-free voice with VAD turn-taking.
- **Translation** — offline two-way ES/FR↔EN (Bergamot); cross-lingual retrieval grounds a non-English question in the English manual.
- **Classification** — bundled MobileNetV3 capture-triage (route a photographed document to the reader).
- **Image generation** — first-aid illustrations on-device (Stable Diffusion 2.1).
- **LoRA fine-tuning** — train a small adapter on a local protocol set, run a frozen eval, compare base vs adapted.
- **Delegated inference** — `loadModel({delegate})` runs completion on a peer by its public key; `heartbeat` liveness; automatic fallback to local on drop.
- **Blind relays** — configurable Hyperswarm relay keys to traverse strict NAT/firewalls (relay + discovery only).
- **Text-to-video (Animate)** — Wan 2.1 on-device; included but heavy (~14.5 GB, needs ≈20 GB unified memory), labeled and opt-in.

Two SDK capabilities are present but out of scope here and labeled as such: BCI (needs EEG-class hardware) and VLA (drives a robot) — neither has a field-medic use case.

## Prior work
All application code was written during the hackathon. It builds on the QVAC SDK and its bundled open models, plus standard libraries (React, Vite, Tailwind, Radix UI, framer-motion, lucide-react, hypercore-crypto). No pre-existing Lifeline codebase, no proprietary medical dataset, no cloud AI. The first-aid corpus and test fixtures are original CC0 content. The MedPsy-vs-MedGemma comparison reports only figures we measured on our hardware.

## Honest scope notes (transparency)
- Delegated **inference** rides the real QVAC P2P channel (encrypted). The incident handoff and the responder question/answer **envelopes** are an app-layer protocol over the localhost bridge — QVAC's peer link carries model inference, not arbitrary messages — so on one machine they are brokered by the bridge; on multiple nodes they ride the mesh. No case-sync travels over the DHT.
- Video generation OOMs on a 16 GB machine; the real path is delegating it to a ≥20 GB peer. It is labeled available-but-heavy, not shown live.

## Repo
https://github.com/harshdev2909/lifeline (public, Apache-2.0)

## Demo video
[unlisted YouTube link — paste before submitting]

## Team
- Harsh Sharma — [role]
- [add every team member here AND on the DoraHacks project page]

## Disclaimer (include verbatim)
Lifeline gives first-aid education and triage support, not a medical diagnosis. It can be wrong or incomplete. In any emergency, call your local emergency number.
