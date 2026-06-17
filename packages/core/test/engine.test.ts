import { test } from "node:test";
import assert from "node:assert/strict";

import { createEngine } from "../src/index";
import type { ChatMsg, InferenceEngine, ModelRef } from "../src/index";

test("createEngine picks an implementation from kind alone", () => {
  assert.equal(createEngine({ kind: "local" }).kind, "local");
  assert.equal(createEngine().kind, "local"); // default
  const k = "a".repeat(64);
  assert.equal(createEngine({ kind: "delegated", providerPublicKey: k }).kind, "delegated");
});

test("a delegated engine requires a peer key or peer list", () => {
  assert.throws(() => createEngine({ kind: "delegated" }), /providerPublicKey|providerKeys/);
});

test("an engine that satisfies the contract can be driven without knowing its kind", async () => {
  // A stand-in for a delegated engine: the consumer only sees the interface.
  class MockEngine implements InferenceEngine {
    readonly kind = "delegated" as const;
    loaded = false;
    async loadModel(_: { model: ModelRef }) {
      this.loaded = true;
      return "mock-model-id";
    }
    async *complete(opts: { modelId: string; messages: ChatMsg[]; stream?: boolean }) {
      assert.equal(opts.modelId, "mock-model-id");
      for (const tok of ["Cool ", "the ", "burn."]) yield tok;
    }
    async unload() {
      this.loaded = false;
    }
  }

  const engine: InferenceEngine = new MockEngine();
  const id = await engine.loadModel({ model: { label: "x", src: "x", type: "llamacpp-completion" } });
  let out = "";
  const stream = engine.complete({ modelId: id, messages: [{ role: "user", content: "burn?" }], stream: true });
  for await (const tok of stream as AsyncIterable<string>) out += tok;
  assert.equal(out, "Cool the burn.");
  await engine.unload(id);
});
