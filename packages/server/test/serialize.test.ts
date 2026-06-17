import { test } from "node:test";
import assert from "node:assert/strict";

import { withLock } from "../src/serialize";

test("withLock runs tasks strictly in order, never overlapping", async () => {
  const order: number[] = [];
  let active = 0;
  let maxActive = 0;
  const task = (id: number, delay: number) =>
    withLock(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, delay));
      order.push(id);
      active--;
    });

  // Start a slow task first, then faster ones — order must still be FIFO.
  await Promise.all([task(1, 30), task(2, 5), task(3, 1)]);

  assert.deepEqual(order, [1, 2, 3]);
  assert.equal(maxActive, 1, "only one locked task may run at a time");
});

test("a throwing task does not break the lock chain", async () => {
  await assert.rejects(withLock(async () => {
    throw new Error("boom");
  }));
  const result = await withLock(async () => "ok");
  assert.equal(result, "ok");
});
