/**
 * config.ts — paths, QVAC environment, the model registry, and persisted
 * settings for the bridge. Like the CLI, the bridge is a CONSUMER: it routes
 * QVAC storage off the home disk and uses the consumer corestore so it never
 * collides with a long-lived provider on the same machine.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MODELS, topicToProviderKey } from "@lifeline/core";

import type { ModelKey, ServerSettings } from "./protocol";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const WEB_DIST = join(REPO_ROOT, "packages", "web", "dist");
export const DEFAULT_CORPUS = join(REPO_ROOT, "corpus", "field-first-aid.md");
const SETTINGS_FILE = join(REPO_ROOT, ".lifeline-ui.json");

export const PORT = Number(process.env.LIFELINE_BRIDGE_PORT ?? 8787);
export const HOST = process.env.LIFELINE_BRIDGE_HOST ?? "127.0.0.1";

/** Route QVAC storage off the (full) home disk; use the consumer corestore. */
export function setupQvacEnv(): void {
  if (!process.env.QVAC_CONFIG_PATH) {
    process.env.QVAC_CONFIG_PATH = join(REPO_ROOT, "qvac.config.js");
  }
  if (!process.env.SNAP_USER_COMMON) {
    process.env.SNAP_USER_COMMON = join(REPO_ROOT, ".qvac-home-consumer");
  }
}

/** Human labels for the models the UI can pick (sourced from core's registry). */
export const MODEL_REGISTRY: { key: ModelKey; label: string }[] = (
  Object.keys(MODELS) as ModelKey[]
).map((key) => ({ key, label: MODELS[key].label }));

export function isModelKey(k: string): k is ModelKey {
  return k in MODELS;
}

const DEFAULTS: ServerSettings = {
  defaultModel: "medgemma4b",
  grounded: true,
  delegate: false,
  lang: "",
  speak: false,
  corpusLabel: "Field First-Aid Manual (CC0)",
  peers: [],
};

/** Resolve a peer "[label@]topic-or-key" spec into a stored peer with its hex key. */
export function resolvePeerRef(ref: string, label?: string, role?: string, model?: string) {
  const trimmed = ref.trim();
  const isHex = /^[0-9a-f]{64}$/i.test(trimmed);
  const key = isHex ? trimmed.toLowerCase() : topicToProviderKey(trimmed);
  return { label: label?.trim() || (isHex ? trimmed.slice(0, 8) : trimmed), ref: trimmed, key, role, model };
}

let current: ServerSettings = loadSettings();

function loadSettings(): ServerSettings {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as Partial<ServerSettings>;
      return normalize({ ...DEFAULTS, ...raw });
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULTS };
}

/** Re-derive peer keys and clamp invalid values, so persisted data stays consistent. */
function normalize(s: ServerSettings): ServerSettings {
  const peers = (s.peers ?? [])
    .filter((p) => p && typeof p.ref === "string" && p.ref.trim())
    .map((p) => resolvePeerRef(p.ref, p.label, p.role, p.model));
  const defaultModel = isModelKey(s.defaultModel) ? s.defaultModel : DEFAULTS.defaultModel;
  return { ...DEFAULTS, ...s, defaultModel, peers };
}

export function getSettings(): ServerSettings {
  return current;
}

export function updateSettings(patch: Partial<ServerSettings>): ServerSettings {
  current = normalize({ ...current, ...patch });
  try {
    writeFileSync(SETTINGS_FILE, JSON.stringify(current, null, 2));
  } catch {
    /* settings persistence is best-effort */
  }
  return current;
}
