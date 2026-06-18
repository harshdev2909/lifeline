import { test } from "node:test";
import assert from "node:assert/strict";

import { topicToProviderKey } from "@lifeline/core";

import { isModelKey, normalizeRelays, resolvePeerRef } from "../src/config";

test("resolvePeerRef derives a provider key from a topic, matching core", () => {
  const r = resolvePeerRef("demo", "laptop", "Laptop peer", "MedGemma 4B");
  assert.equal(r.key, topicToProviderKey("demo"));
  assert.equal(r.label, "laptop");
  assert.equal(r.role, "Laptop peer");
  assert.equal(r.model, "MedGemma 4B");
});

test("resolvePeerRef passes a 64-hex key through verbatim (lowercased)", () => {
  const key = "5B361A251B63F8AB6125F3A844FAE0F5CD568BEB3202A9CAEF09ABF8FB7B271A";
  const r = resolvePeerRef(key);
  assert.equal(r.key, key.toLowerCase());
  // No label given → first 8 chars of the key.
  assert.equal(r.label, key.toLowerCase().slice(0, 8));
});

test("resolvePeerRef defaults the label to the topic word", () => {
  assert.equal(resolvePeerRef("clinic").label, "clinic");
});

test("isModelKey accepts known models and rejects others", () => {
  assert.equal(isModelKey("medgemma4b"), true);
  assert.equal(isModelKey("medpsy4b"), true);
  assert.equal(isModelKey("vision"), true);
  assert.equal(isModelKey("gpt"), false);
});

test("normalizeRelays keeps only 64-hex keys, lowercased and deduped", () => {
  const good = "a".repeat(64);
  const out = normalizeRelays([good.toUpperCase(), good, "tooshort", "", "z".repeat(64)]);
  assert.deepEqual(out, [good]);
});
