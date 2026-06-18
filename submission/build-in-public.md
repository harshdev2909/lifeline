# Build-in-public thread (draft)

> Ready to publish. Confirm the official hashtag before posting (placeholder:
> #BuildWithQVAC / #QVAC). Attach the demo clip or a screenshot to the first post.

**1/**
Lifeline: a first-aid assistant that runs entirely on the devices you already have. No cloud, no internet needed to answer. When a phone is too weak for a capable model, it borrows compute from a stronger device next to it. Built on @qvac. #BuildWithQVAC

**2/**
Why: the places that most need medical decision support — a rural clinic, a disaster zone, a boat, a trail — have the least reliable connectivity. An assistant that only works with a fast link to a data center isn't much use there. So Lifeline assumes the network is unreliable and the data is sensitive.

**3/**
It started local: one device, a grounded model, a first-aid manual. Every answer is retrieved from the manual and cited — not pulled from model memory. Emergencies lead with "call for help." Off-topic questions get declined, not guessed.

**4/**
Then it became a mesh. A weak device delegates inference to a stronger peer over an encrypted P2P link (QVAC/Holepunch). If the peer drops mid-answer, it falls back to a smaller local model on its own. Real, and logged: served_by remote → served_by local.

**5/**
Then it learned to see, hear, speak, and translate — all on-device: read a label (OCR), describe a wound (vision), hands-free voice in/out, two-way ES/FR translation with cross-lingual retrieval (ask in Spanish, grounded in the English manual, answered in Spanish).

**6/**
Then field-readiness: structured incident reports you can export and hand to a reviewer; an unattended responder that auto-answers a peer's triage questions through the full grounded chain behind an allowlist; and a constrained-link mode that keeps a terse, byte-budgeted answer intact over a narrow, lossy channel.

**7/**
Honesty is a feature. Every run writes an auditable evidence log (TTFT, tokens/sec, what was retrieved, which device served it). It's triage support, not diagnosis — the disclaimer is in code and can't be turned off. Heavy bits (on-device video) are labeled and opt-in, not hidden.

**8/**
100% on-device or peer-to-peer. The only network use is one-time model download and peer discovery — disclosed in `remote-apis.yaml`. Apache-2.0, public repo. Demo + code below. #BuildWithQVAC
[repo link] · [video link]
