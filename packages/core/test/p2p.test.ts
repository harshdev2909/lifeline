import { test } from "node:test";
import assert from "node:assert/strict";

import { topicToProviderKey, topicToSeedHex, seedHexToProviderKey } from "../src/index";

const HEX64 = /^[0-9a-f]{64}$/;

test("a topic derives a stable 64-hex provider key", () => {
  const a = topicToProviderKey("clinic");
  const b = topicToProviderKey("clinic");
  assert.equal(a, b, "derivation must be deterministic");
  assert.match(a, HEX64);
});

test("the seed is a 64-hex string", () => {
  assert.match(topicToSeedHex("clinic"), HEX64);
});

test("deriving the key directly matches going through the seed", () => {
  const topic = "field-team-7";
  assert.equal(topicToProviderKey(topic), seedHexToProviderKey(topicToSeedHex(topic)));
});

test("different topics derive different keys", () => {
  assert.notEqual(topicToProviderKey("clinic"), topicToProviderKey("clinic2"));
});
