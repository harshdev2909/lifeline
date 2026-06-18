/**
 * meshService.ts — assemble the live mesh snapshot for the visualizer.
 *
 * `self` is this device (from sysinfo + the configured default model); `peers`
 * come from settings. Liveness is real: `probeMesh` heartbeats each peer through
 * core's `probePeers` and reports who answered. Internet reachability is checked
 * best-effort against the DHT bootstrap (discovery needs it; serving does not).
 */
import { hostname } from "node:os";
import { lookup } from "node:dns/promises";

import { collectSysInfo, probePeers, closeSdkWorker, type PeerProbe } from "@lifeline/core";

import { getSettings, MODEL_REGISTRY } from "./config";
import { getLastDecision, getServed } from "./peerStats";
import { providerStatus } from "./providerService";
import type { MeshSnapshot, MeshPeer } from "./protocol";

function modelLabel(key: string): string {
  return MODEL_REGISTRY.find((m) => m.key === key)?.label ?? key;
}

let internetCache = { at: 0, ok: false };
async function checkInternet(): Promise<boolean> {
  const now = Date.now();
  if (now - internetCache.at < 15000) return internetCache.ok;
  let ok = false;
  try {
    await Promise.race([
      lookup("bootstrap1.hyperdht.org").then(() => {
        ok = true;
      }),
      new Promise((resolve) => setTimeout(resolve, 1200)),
    ]);
  } catch {
    ok = false;
  }
  internetCache = { at: now, ok };
  return ok;
}

function selfNode(): MeshSnapshot["self"] {
  const s = collectSysInfo();
  const settings = getSettings();
  const prov = providerStatus();
  return {
    label: hostname() || "this device",
    role: "this device",
    model: modelLabel(settings.defaultModel),
    platform: `${s.platform}/${s.arch}`,
    accel: s.qvac_accel_backend_expected,
    online: true,
    serving: prov.serving,
    publicKey: prov.publicKey,
    serveTopic: prov.topic,
    serveModel: prov.modelLabel,
  };
}

function relaySnapshot(): MeshSnapshot["relays"] {
  const keys = getSettings().relays ?? [];
  return { count: keys.length, keys };
}

function peerNodes(probes?: PeerProbe[]): MeshPeer[] {
  const settings = getSettings();
  const byKey = new Map((probes ?? []).map((p) => [p.peer_key, p]));
  return settings.peers.map((p) => {
    const pr = byKey.get(p.key);
    const status: MeshPeer["status"] = pr ? (pr.ok ? "live" : "down") : "unknown";
    return {
      key: p.key,
      label: p.label,
      role: p.role,
      model: p.model,
      status,
      probeMs: pr?.probe_ms,
      error: pr?.error,
      served: getServed(p.key),
    };
  });
}

/** A snapshot without probing (fast; peer status is "unknown"). */
export async function buildMeshSnapshot(): Promise<MeshSnapshot> {
  const internet = await checkInternet();
  return { self: selfNode(), peers: peerNodes(), internet, relays: relaySnapshot(), lastDecision: getLastDecision() };
}

/** A snapshot with real liveness — heartbeats every configured peer. */
export async function probeMesh(): Promise<MeshSnapshot> {
  const settings = getSettings();
  const internet = await checkInternet();
  if (!settings.peers.length) return { self: selfNode(), peers: [], internet, relays: relaySnapshot(), lastDecision: getLastDecision() };
  try {
    const probes = await probePeers(settings.peers.map((p) => p.key), {
      labels: Object.fromEntries(settings.peers.map((p) => [p.key, p.label])),
    });
    return { self: selfNode(), peers: peerNodes(probes), internet, relays: relaySnapshot(), lastDecision: getLastDecision() };
  } finally {
    await closeSdkWorker();
  }
}
