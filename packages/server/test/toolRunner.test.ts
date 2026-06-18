import assert from "node:assert/strict";
import { test } from "node:test";

import { runTool } from "../src/toolRunner";
import type { ServerEvent } from "../src/protocol";

const noEmit = (_ev: ServerEvent): void => {};
const signal = (): AbortSignal => new AbortController().signal;

test("runTool rejects an unknown tool", async () => {
  await assert.rejects(
    () => runTool({ runId: "r1", tool: "nope" as unknown as "ocr" }, noEmit, signal()),
    /Unknown tool/,
  );
});

test("the OCR tool requires an image attachment", async () => {
  await assert.rejects(() => runTool({ runId: "r2", tool: "ocr", uploads: [] }, noEmit, signal()), /Attach a photo/);
});

test("a bad upload role does not start a run (guard fires before any model load)", async () => {
  const events: string[] = [];
  await runTool({ runId: "r3", tool: "ocr", uploads: [{ role: "audio", id: "x" }] }, (ev) => events.push(ev.type), signal()).catch(
    () => {},
  );
  assert.equal(events.length, 0);
});
