#!/usr/bin/env bash
# Lifeline end-to-end demo: grounded medical answer → red-flag → refusal → P2P delegation.
# Provider for the delegated leg is auto-spawned as a child process. Models must be cached
# (they are after the first run / prefetch). Evidence lands in ./evidence/run-*.jsonl.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
L=(node --import tsx packages/node-app/src/cli.ts)

hr() { printf '\n════════════════════════════════════════════════════════════\n'; }

hr; echo "1/4 · Grounded MedPsy answer (LOCAL, cited from the field manual)"
"${L[@]}" ask --model medpsy4b --rag corpus/ "How should I treat heat stroke in the field?" --max-tokens 400

hr; echo "2/4 · Red-flag emergency query (leads with seek-emergency-care)"
"${L[@]}" ask --model medpsy4b --rag corpus/ "Someone collapsed and is not breathing, what do I do?" --max-tokens 400

hr; echo "3/4 · Off-manual query → refusal (no hallucination)"
"${L[@]}" ask --model medpsy4b --rag corpus/ "What is the correct insulin dose for type 1 diabetes?"

hr; echo "4/4 · P2P delegated answer (provider auto-spawned; completion runs on the peer)"
pkill -9 -f "cli.ts serve" 2>/dev/null; sleep 1
"${L[@]}" serve --topic demo-mesh --model medpsy4b > /tmp/lifeline-demo-serve.log 2>&1 &
SP=$!
until grep -q "Serving…" /tmp/lifeline-demo-serve.log 2>/dev/null; do sleep 1; done
echo "   provider serving; delegating a grounded query…"
"${L[@]}" ask --delegate --topic demo-mesh --model medpsy4b --rag corpus/ "How do I treat severe bleeding?" --max-tokens 400
kill -9 "$SP" 2>/dev/null; pkill -9 -f "cli.ts serve" 2>/dev/null; pkill -9 -f "server/worker.js" 2>/dev/null

hr
echo "Done. Evidence (one JSONL per run): $DIR/evidence/run-*.jsonl"
echo "Bonus: 'npm run medbench' (MedPsy vs MedGemma), 'lifeline ask --audio <wav>' (voice in),"
echo "       'lifeline ask --delegate --simulate-stall' (mid-stream fallback demo)."
