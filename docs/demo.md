# Lifeline — canonical demo flow

One reproducible run that tells the whole story, with every step backed by real
evidence. Each step lists what produces it and where the evidence lives:
**committed** = a sample log is checked in under [`examples/logs/`](../examples/logs);
**live** = the step writes its evidence event to `evidence/` at runtime and the
UI shows the evidence filename in the footer.

> Honesty note: delegated **inference** rides the real QVAC peer-to-peer channel
> (Holepunch/Hyperswarm), end-to-end encrypted. The incident handoff and the
> responder question/answer **envelopes** are an app-layer protocol over the
> localhost bridge — QVAC's peer link carries model inference, not arbitrary
> messages. No case-sync travels over the DHT. This is stated in About and the
> responder/incident surfaces, and must stay consistent in the video.

## The flow (target: under 5 minutes)

| # | Step | What it shows | Evidence |
|---|------|---------------|----------|
| 1 | Grounded MedPsy answer | retrieval → cited answer + standing disclaimer | committed: `grounded-answer.jsonl` |
| 2 | Red-flag emergency | a life-threatening question leads with "call emergency help" | committed: `grounded-answer-delegated.jsonl` (`red_flag:true`) |
| 3 | Ungrounded refusal | declines below the grounding threshold rather than guessing | committed: `ungrounded-refusal.jsonl` |
| 4 | Delegated inference | completion runs on a peer, `served_by:remote`, ttft ≈ 62 ms, ≈ 114 tok/s | committed: `delegated-inference.jsonl` |
| 5 | Fallback to local | peer drops mid-answer → re-run locally, `served_by:local` | committed: `offline-fallback.jsonl`, `watchdog-fallback.jsonl` |
| 6 | Vision | photo → observed findings, fenced as untrusted | committed: `vision.jsonl` |
| 7 | Voice in / out | spoken question → grounded answer → spoken reply | committed: `voice-in.jsonl`, `voice-out.jsonl` |
| 8 | Multilingual round-trip | Spanish question → English retrieval → Spanish answer | live: `translation` events |
| 9 | New capability — LoRA before/after | train a tiny adapter, frozen eval, base-vs-adapted answer | live: `finetune` event |
| 10 | Incident report | save the triage exchange → export → hand to a reviewer | live: `incident` event |
| 11 | Constrained-link terse answer | byte budget, chunks, retries; a multibyte answer survives intact | live: `constrained_link` event |

Injection-blocked (`injection-blocked.jsonl`) and the MedPsy-vs-MedGemma
comparison (`model-comparison.jsonl` / `.md`) are committed too and make good
B-roll. The comparison reports only what we measured — no third-party benchmark
numbers are claimed as ours.

## Pre-warm before recording (so nothing stalls on a cold load)

- First run downloads weights over the QVAC registry; do this once **before**
  recording so models are cached and the demo is fully offline.
- Keep the model worker warm: ask one throwaway question first, then record — the
  warm slot skips re-init and the peer handshake on later turns.
- For the delegation leg, start the provider and connect the peer first:
  `lifeline serve --topic clinic --model medpsy4b` on the strong device, and add
  the peer in Settings (or `--delegate --topic clinic`) on the field device.
- LoRA (step 9) takes ~20 s end to end; let it finish off-camera or speed it in
  the edit. Classification, incident, and constrained-link are fast.

## No-hardware reviewer path (offline, one machine, no peer)

A reviewer with an ordinary laptop and no second device can verify the core
without the delegation leg:

```bash
npm install
npm test                         # 66 tests: chunker boundaries, incident schema,
                                 # responder (allowlist/off/crash), safety, citations
npm run lifeline -- ask "How should I treat a burn?"   # one grounded answer, offline once cached
npm run ui                       # the full workspace at http://127.0.0.1:8787
```

Then read [`examples/logs/`](../examples/logs) for committed evidence of the
delegated and fallback legs (which need two devices to reproduce live), and open
the **Incident reports**, **Responder**, and **Constrained link** tools — each
writes a real evidence event and shows the filename in its footer.

## Recommended cuts (not bulletproof on 16 GB)

- **Video generation (Animate).** The Wan pipeline needs ≈ 20 GB unified memory
  and OOMs on a 16 GB machine. Show it only as "available, and here's why it's
  off by default" (About). Do not attempt a live clip in the recording.
- **Live delegation** is the strongest moment but needs a second device. If only
  one machine is available for recording, show the committed delegated +
  fallback logs on screen instead of faking a peer.
