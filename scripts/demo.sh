#!/usr/bin/env bash
# Lifeline end-to-end demo. Days 1–4: grounded medical triage → safety → P2P delegation →
# vision → voice-out → multilingual → OCR → mesh routing. Providers are auto-spawned as
# child processes. Models must be cached (they are after the first run / prefetch).
# Evidence lands in ./evidence/run-*.jsonl.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
L=(node --import tsx packages/node-app/src/cli.ts)

hr() { printf '\n════════════════════════════════════════════════════════════\n'; }
cleanup() { pkill -9 -f "cli.ts serve" 2>/dev/null; pkill -9 -f "server/worker.js" 2>/dev/null; }
trap cleanup EXIT

hr; echo "1/8 · Grounded MedPsy answer (LOCAL, cited from the field manual)"
"${L[@]}" ask --model medpsy4b --rag corpus/ "How should I treat heat stroke in the field?" --max-tokens 400

hr; echo "2/8 · Red-flag emergency query (leads with seek-emergency-care)"
"${L[@]}" ask --model medpsy4b --rag corpus/ "Someone collapsed and is not breathing, what do I do?" --max-tokens 400

hr; echo "3/8 · Off-manual query → refusal (no hallucination)"
"${L[@]}" ask --model medpsy4b --rag corpus/ "What is the correct insulin dose for type 1 diabetes?"

hr; echo "4/8 · P2P delegated answer (provider auto-spawned; completion runs on the peer)"
cleanup; sleep 1
"${L[@]}" serve --topic demo-mesh --model medpsy4b > /tmp/lifeline-demo-serve.log 2>&1 &
until grep -q "Serving…" /tmp/lifeline-demo-serve.log 2>/dev/null; do sleep 1; done
echo "   provider serving; delegating a grounded query…"
"${L[@]}" ask --delegate --topic demo-mesh --model medpsy4b --rag corpus/ "How do I treat severe bleeding?" --max-tokens 400
cleanup; sleep 1

hr; echo "5/8 · Vision: describe an image → grounded answer (two-stage, LOCAL)"
"${L[@]}" ask --image corpus/test-images/wound.bmp --rag corpus/ --model medpsy4b "What first aid should I give for what's shown?" --max-tokens 400

hr; echo "6/8 · Voice-out: synthesize the answer to a WAV (Supertonic TTS, LOCAL)"
"${L[@]}" ask --rag corpus/ --model medpsy4b --speak "How do I treat a minor burn?" --max-tokens 300

hr; echo "7/8 · Multilingual: ask in Spanish, answer round-trips through the EN chain (Bergamot)"
"${L[@]}" ask --lang es --rag corpus/ --model medpsy4b "¿Cómo trato una quemadura?" --max-tokens 300

hr; echo "8/8 · OCR: read a printed label as UNTRUSTED text → fenced → grounded answer"
"${L[@]}" ask --ocr corpus/test-images/burn-label.png --rag corpus/ --model medpsy4b "What does this label say I should do?" --max-tokens 400

hr
echo "Done. Evidence (one JSONL per run): $DIR/evidence/run-*.jsonl"
echo "More: 'npm run medbench' (MedPsy vs MedGemma), 'ask --audio <wav> --lang es' (multilingual voice-in),"
echo "      'ask --delegate --simulate-stall' (mid-stream watchdog fallback),"
echo "      mesh routing across peers:"
echo "        ./lifeline serve --topic demo                                  # peer laptop"
echo "        ./lifeline serve --topic pidemo --home .qvac-home-pi --label pi # peer pi (emulated)"
echo "        ./lifeline ask --delegate --peers laptop@demo,pi@pidemo --rag corpus/ \"...\""
