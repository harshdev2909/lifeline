import assert from "node:assert/strict";
import { test } from "node:test";

import { budgetText, chunkUtf8, frameChunks, reassemble, simulateTransmit, utf8Bytes } from "../src/constrainedLink";

// Mixed-width text: ASCII (1B), accented (2B), CJK (3B), emoji (4B, surrogate pair).
const MIXED = "Apply pressure — presión 圧迫 🚑 now é🩹";

test("chunkUtf8 never splits a multibyte code point, at any small budget", () => {
  for (const max of [1, 2, 3, 4, 5, 7, 8, 16]) {
    const chunks = chunkUtf8(MIXED, max);
    // Reassembly is the strong invariant: a split codepoint could never round-trip.
    assert.equal(chunks.join(""), MIXED, `budget ${max} round-trips`);
    for (const c of chunks) {
      // Each chunk decodes cleanly (no lone surrogate / partial sequence).
      assert.equal(Buffer.from(c, "utf8").toString("utf8"), c, `budget ${max}: clean chunk`);
      // A chunk may exceed the budget ONLY when it is a single code point too big to split.
      if (utf8Bytes(c) > max) assert.equal([...c].length, 1, `budget ${max}: oversize chunk is one code point`);
    }
  }
});

test("each chunk fits the budget when chars are smaller than it", () => {
  const chunks = chunkUtf8("圧迫圧迫圧迫", 6); // 3 bytes each → 2 per 6-byte chunk
  assert.deepEqual(chunks, ["圧迫", "圧迫", "圧迫"]);
  for (const c of chunks) assert.ok(utf8Bytes(c) <= 6);
});

test("a single code point larger than the budget is emitted alone, intact", () => {
  const chunks = chunkUtf8("a🚑b", 2); // 🚑 is 4 bytes > 2
  assert.equal(chunks.join(""), "a🚑b");
  assert.ok(chunks.includes("🚑"));
});

test("frame + reassemble round-trips and numbers the chunks", () => {
  const chunks = chunkUtf8(MIXED, 8);
  const frames = frameChunks(chunks);
  assert.equal(frames[0].seq, 1);
  assert.equal(frames[0].total, chunks.length);
  assert.equal(frames.at(-1)!.seq, chunks.length);
  assert.equal(reassemble(frames), MIXED);
  // Out-of-order frames still reassemble correctly.
  assert.equal(reassemble([...frames].reverse()), MIXED);
});

test("budgetText trims at a code-point boundary, never mid-character", () => {
  const r = budgetText("圧迫圧迫", 5); // 4 chars × 3B = 12B; cap 5 → fits one (3B), not two (6B)
  assert.equal(r.text, "圧");
  assert.equal(r.truncated, true);
  assert.equal(Buffer.from(r.text, "utf8").toString("utf8"), r.text);
  assert.deepEqual(budgetText("hi", 99), { text: "hi", truncated: false });
});

test("simulateTransmit is deterministic with an injected rng", () => {
  // No loss → every chunk delivered on the first try, no retries.
  assert.deepEqual(simulateTransmit(5, { loss: 0.5, rng: () => 1 }), { attempts: 5, retries: 0, delivered: 5, dropped: 0 });
  // Total loss → each chunk exhausts its retries and is dropped.
  const r = simulateTransmit(2, { loss: 0.5, maxRetries: 3, rng: () => 0 });
  assert.equal(r.delivered, 0);
  assert.equal(r.dropped, 2);
  assert.equal(r.attempts, 2 * 4); // (1 initial + 3 retries) per chunk
  assert.equal(r.retries, 2 * 3);
});
