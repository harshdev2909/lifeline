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

test("translate needs text and a supported language", async () => {
  await assert.rejects(() => runTool({ runId: "t1", tool: "translate", params: { text: "" } }, noEmit, signal()), /Enter some text/);
  await assert.rejects(
    () => runTool({ runId: "t2", tool: "translate", params: { text: "hola", lang: "zz" } }, noEmit, signal()),
    /Unsupported language/,
  );
});

test("search needs a query", async () => {
  await assert.rejects(() => runTool({ runId: "s1", tool: "search", params: { query: "  " } }, noEmit, signal()), /Enter a search query/);
});

test("dictate needs an audio clip", async () => {
  await assert.rejects(() => runTool({ runId: "d1", tool: "dictate", uploads: [] }, noEmit, signal()), /Record or attach/);
});

test("speak needs text", async () => {
  await assert.rejects(() => runTool({ runId: "k1", tool: "speak", params: {} }, noEmit, signal()), /Enter the text/);
});

test("vision needs an image and the note tool needs notes", async () => {
  await assert.rejects(() => runTool({ runId: "v1", tool: "vision", uploads: [] }, noEmit, signal()), /Attach a photo/);
  await assert.rejects(() => runTool({ runId: "n1", tool: "soap", params: { text: "" } }, noEmit, signal()), /Paste the case notes/);
});
