/**
 * providerService.ts — let this device SERVE a model to peers (provider mode),
 * making the mesh bidirectional.
 *
 * A deterministic provider identity needs QVAC_HYPERSWARM_SEED set before the
 * worker spawns, so starting the provider first disposes the warm consumer
 * engine (closing the worker), sets the seed from the serve topic, then starts a
 * fresh provider on that worker and warms the model. Verified: the advertised
 * key matches topicToProviderKey(topic). Consumer turns afterwards re-warm on
 * the same worker. Serialized with turns/probes via the lock by the caller.
 */
import { MODELS, Provider, topicToProviderKey, topicToSeedHex } from "@lifeline/core";

import { isModelKey } from "./config";
import { engineManager } from "./engineManager";
import type { ModelKey } from "./protocol";

export interface ProviderStatus {
  serving: boolean;
  publicKey?: string;
  topic?: string;
  model?: ModelKey;
  modelLabel?: string;
  error?: string;
}

let provider: Provider | null = null;
let status: ProviderStatus = { serving: false };

export function providerStatus(): ProviderStatus {
  return status;
}

export async function startProvider(topic: string, modelKey: ModelKey): Promise<ProviderStatus> {
  if (status.serving) return status;
  const t = topic.trim();
  if (!t) throw new Error("a serve topic is required");
  const key = isModelKey(modelKey) ? modelKey : "medgemma4b";

  // Free the worker so the provider can spawn one bound to the serve identity.
  await engineManager.dispose();
  process.env.QVAC_HYPERSWARM_SEED = topicToSeedHex(t);

  provider = new Provider({ profile: false });
  try {
    const { publicKey } = await provider.start();
    await provider.warm(MODELS[key]);
    status = { serving: true, publicKey, topic: t, model: key, modelLabel: MODELS[key].label };
    if (publicKey !== topicToProviderKey(t)) status.error = "advertised key differs from the topic derivation";
    return status;
  } catch (err) {
    provider = null;
    status = { serving: false, error: err instanceof Error ? err.message : String(err) };
    return status;
  }
}

export async function stopProvider(): Promise<ProviderStatus> {
  if (provider) {
    try {
      await provider.stop();
    } catch {
      /* ignore */
    }
  }
  provider = null;
  status = { serving: false };
  return status;
}
