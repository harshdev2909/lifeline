/**
 * mesh.ts — standalone peer-liveness probing for the mesh view.
 *
 * The DelegatedEngine probes peers internally during routing, but the UI also
 * wants on-demand liveness for the mesh visualizer without running a full turn.
 * This wraps the same QVAC `heartbeat` the engine uses, plus a worker shutdown
 * helper so a caller that only probed (and never loaded a model) can still
 * release the SDK worker. SDK specifics stay in core — callers see PeerProbe.
 */
import { performance } from "node:perf_hooks";

import { heartbeat, close } from "@qvac/sdk";

import type { PeerProbe } from "./types";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface ProbeOptions {
  /** Per-peer heartbeat timeout (ms). The first holepunch to a fresh peer is slow. */
  timeout?: number;
  /** Optional hex-key → human label map for the result rows. */
  labels?: Record<string, string>;
}

/** Heartbeat-probe one peer; resolves to a PeerProbe (never throws). */
export async function probePeer(peerKey: string, opts: ProbeOptions = {}): Promise<PeerProbe> {
  const timeout = opts.timeout ?? 20000;
  const t0 = performance.now();
  try {
    await heartbeat({ delegate: { providerPublicKey: peerKey, timeout } });
    return { peer_key: peerKey, label: opts.labels?.[peerKey], ok: true, probe_ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return { peer_key: peerKey, label: opts.labels?.[peerKey], ok: false, probe_ms: Math.round(performance.now() - t0), error: errMsg(err) };
  }
}

/** Probe several peers concurrently; preserves input order in the result. */
export async function probePeers(peerKeys: string[], opts: ProbeOptions = {}): Promise<PeerProbe[]> {
  return Promise.all(peerKeys.map((k) => probePeer(k, opts)));
}

/** Release the QVAC background worker (e.g. after probing without loading a model). */
export async function closeSdkWorker(): Promise<void> {
  await close().catch(() => {});
}
