import { test } from "node:test";
import assert from "node:assert/strict";

import { extractCitations } from "../src/index";

const retrieved = ["S1", "S2", "S3"];

test("collects the tags an answer actually cites", () => {
  const r = extractCitations("Cool the burn [S1]. Cover it [S3].", retrieved);
  assert.deepEqual(r.cited, ["S1", "S3"]);
  assert.equal(r.attached, undefined);
  assert.deepEqual(r.hallucinated, []);
});

test("recognises image and OCR tags too", () => {
  const r = extractCitations("The image shows a burn [IMG]. The label says cool it [OCR].", ["IMG", "OCR", "S1"]);
  assert.deepEqual(r.cited, ["IMG", "OCR"]);
});

test("attaches the top source when a grounded answer cited nothing", () => {
  const r = extractCitations("Cool the burn under running water for twenty minutes.", retrieved);
  assert.equal(r.attached, "S1");
  assert.deepEqual(r.cited, ["S1"]);
});

test("does not attach a source to an empty answer", () => {
  const r = extractCitations("   ", retrieved);
  assert.equal(r.attached, undefined);
  assert.deepEqual(r.cited, []);
});

test("flags a citation that was not retrieved", () => {
  const r = extractCitations("Per the manual [S9], do this.", retrieved);
  assert.deepEqual(r.hallucinated, ["S9"]);
});

test("deduplicates repeated citations", () => {
  const r = extractCitations("[S1] ... [S1] ... [S2]", retrieved);
  assert.deepEqual(r.cited, ["S1", "S2"]);
});
