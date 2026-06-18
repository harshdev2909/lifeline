# Demo video — script + shot list

Target: **under 5 minutes**, unlisted YouTube. Open in airplane mode. Lead with
the genuinely-on-the-mesh delegated inference. Keep the evidence visible on
screen. Every figure spoken must match the evidence logs.

Pre-warm first (see [`docs/demo.md`](../docs/demo.md)): weights cached, one
throwaway question asked so the worker is warm, the provider serving and the peer
connected for the delegation leg.

## Cold open (0:00–0:20)
- Shot: laptop with the **airplane-mode / Wi-Fi-off** indicator clearly in frame.
- VO: "This is Lifeline — a first-aid assistant. The network is off. Everything you're about to see runs on the device, or on another device next to it. No cloud."
- Cut to the app's "On-device · Working offline" indicator.

## 1. Grounded answer + the trust layer (0:20–1:05)
- Type: "How should I treat a burn?"
- Show: the answer streaming, the **[S1] citation chip** expanding to the source snippet, the mono **TTFT / tok/s** readout, the standing disclaimer.
- VO: "Answers come from a local first-aid manual, with the source attached — not from model memory."
- Quick beat: ask an emergency question ("someone collapsed and isn't breathing") → the **red-flag banner leads with 'call emergency help'**. Then an off-topic question → it **declines** rather than guessing.

## 2. The mesh — delegated inference + fallback (1:05–2:15)  ← the centerpiece
- Show the **mesh visualizer**: this device + a live peer.
- Flip routing to **Delegate**, ask a question; the travelling pulse fires, the answer streams, and the badge reads **"Delegated to a peer"** with the link time.
- On screen: the evidence line — `served_by: remote`, ttft ≈ 62 ms, ≈ 114 tok/s (matches `examples/logs/delegated-inference.jsonl`).
- Now **pull the peer** (close it / pull its network). Mid-answer it **reroutes home**: badge flips to "Answered on this device", `served_by: local` (matches `examples/logs/offline-fallback.jsonl`).
- VO: "A weak device borrows a stronger one's GPU over an encrypted peer link. If the peer drops, it falls back to local on its own — it degrades, it doesn't fail."

## 3. Sees, hears, speaks, translates (2:15–3:10)
- **Vision**: attach a wound photo → observed findings (fenced as untrusted).
- **Voice**: hands-free — speak a question, hear the grounded answer spoken back.
- **Multilingual**: ask in Spanish → English retrieval → Spanish answer. (Cross-lingual retrieval: one language's question grounded in another's manual.)

## 4. Field-readiness (3:10–4:25)
- **LoRA before/after** (pre-trained off-camera): show the base vs adapted answer + the frozen-eval numbers.
- **Incident report**: after the emergency exchange, "Save incident report" → open Records → show the structured report (citations, severity, disclaimer) → **export Markdown** → **hand off to a reviewer** (note: app-layer over the bridge — caption it).
- **Constrained link**: ask over a 64 B/chunk link at 25% loss → the readout shows **budget / sent / chunks / retries**, and a Spanish answer is **reassembled intact, no codepoint split**.
- On-screen caption (must appear): *"Delegated inference uses the real QVAC P2P channel. Incident handoff / responder messages are app-layer over the local bridge."*

## 5. Close (4:25–4:50)
- Show the `evidence/` folder / a log open in an editor.
- VO: "Every run writes an auditable log — timings, what was retrieved, which device served it. It's all real, and it's all on your hardware."
- End card: repo URL, Apache-2.0, the disclaimer.

## On-screen text / captions checklist
- [ ] Airplane mode visible in the cold open.
- [ ] `served_by: remote` and `served_by: local` legible during the mesh leg.
- [ ] The app-layer-transport caption during the incident/responder beat.
- [ ] The not-a-diagnosis disclaimer visible at least once and on the end card.

## Do NOT show
- Video generation (Animate) running — it OOMs on 16 GB. If mentioned, say "available, off by default; the real path is a ≥20 GB peer."
- Any number not present in the evidence logs.
- A faked peer — if recording on one machine, show the committed delegated/fallback logs instead.
