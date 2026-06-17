/**
 * provider.ts — the host role: advertise QVAC capabilities to peers over Holepunch.
 *
 * A provider is just the SDK client calling `startQVACProvider()`; the internal
 * Bare worker listens on the Hyperswarm DHT under a keypair derived from
 * QVAC_HYPERSWARM_SEED (the CLI sets that from `--topic`/`--seed`). Consumers
 * then `loadModel({ delegate: { providerPublicKey } })`. Pre-loading ("warming")
 * the model means the first delegated completion isn't waiting on a cold load.
 *
 * SDK specifics stay in here so the CLI/`node-app` never imports `@qvac/sdk`.
 */
import {
  loadModel,
  unloadModel,
  startQVACProvider,
  stopQVACProvider,
  close,
  profiler,
} from "@qvac/sdk";
import type { LoadModelOptions, ModelProgressUpdate } from "@qvac/sdk";

import type { ModelRef, ProgressUpdate } from "./types";

export interface FirewallConfig {
  mode: "allow" | "deny";
  publicKeys: string[];
}

export interface ProviderOptions {
  onProgress?: (p: ProgressUpdate) => void;
  profile?: boolean;
}

export class Provider {
  private readonly progressCb?: (p: ProgressUpdate) => void;
  private warmedModelId?: string;
  private started = false;

  constructor(opts: ProviderOptions = {}) {
    this.progressCb = opts.onProgress;
    if (opts.profile !== false) profiler.enable({ mode: "verbose" });
  }

  /** Start advertising on the DHT. Returns the provider's public key (hex). */
  async start(opts: { firewall?: FirewallConfig } = {}): Promise<{ publicKey: string }> {
    const res = await startQVACProvider(opts.firewall ? { firewall: opts.firewall } : undefined);
    if (!res.success || !res.publicKey) {
      throw new Error(`startQVACProvider failed: ${res.error ?? "no public key returned"}`);
    }
    this.started = true;
    return { publicKey: res.publicKey };
  }

  /** Pre-load a model locally so delegated requests hit a warm model. Returns the modelId. */
  async warm(model: ModelRef): Promise<string> {
    const opts = {
      modelSrc: model.src,
      modelType: model.type,
      ...(model.config ? { modelConfig: model.config } : {}),
      onProgress: (p: ModelProgressUpdate) => this.progressCb?.(p),
    } as unknown as LoadModelOptions;
    this.warmedModelId = await loadModel(opts);
    return this.warmedModelId;
  }

  /** Stop serving, unload the warmed model, and shut the worker down. Safe to call once. */
  async stop(): Promise<void> {
    try {
      if (this.started) await stopQVACProvider();
    } catch {
      /* ignore */
    }
    try {
      if (this.warmedModelId) await unloadModel({ modelId: this.warmedModelId });
    } catch {
      /* ignore */
    }
    try {
      profiler.disable();
    } catch {
      /* ignore */
    }
    await close().catch(() => {});
  }

  profilerSnapshot(): unknown {
    return profiler.isEnabled() ? profiler.exportJSON({ includeRecentEvents: true }) : null;
  }
}
