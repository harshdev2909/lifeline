/**
 * peerStats.ts — real, in-memory readouts for the mesh panel.
 *
 * Records what actually happened: per-peer served-turn counts and the most
 * recent TTFT / tokens-per-sec a peer delivered, plus the last routing decision
 * (the probe ladder → winner / fallback). Nothing here is invented — entries
 * appear only after a peer has genuinely served a turn.
 */
import type { PeerProbeWire, PeerServedStats, RouteDecision } from "./protocol";

const served = new Map<string, PeerServedStats>();
let lastDecision: RouteDecision | undefined;

export function recordServed(peerKey: string, stats: { ttftMs?: number; tps?: number }): void {
  const prev = served.get(peerKey) ?? { turns: 0 };
  served.set(peerKey, {
    turns: prev.turns + 1,
    lastTtftMs: stats.ttftMs ?? prev.lastTtftMs,
    lastTps: stats.tps ?? prev.lastTps,
    lastAt: Date.now(),
  });
}

export function getServed(peerKey: string): PeerServedStats | undefined {
  return served.get(peerKey);
}

export function recordDecision(d: { candidates: PeerProbeWire[]; chosen?: string; servedBy: "local" | "remote"; fallbackReason?: string }): void {
  lastDecision = { ...d, at: Date.now() };
}

export function getLastDecision(): RouteDecision | undefined {
  return lastDecision;
}
