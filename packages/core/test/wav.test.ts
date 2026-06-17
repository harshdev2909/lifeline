import { test } from "node:test";
import assert from "node:assert/strict";

import { wavBuffer } from "../src/index";

test("wraps PCM samples in a well-formed 16-bit mono WAV", () => {
  const samples = [0, 100, -100, 32767, -32768];
  const buf = wavBuffer(samples, 44100);
  const dataLen = samples.length * 2;

  assert.equal(buf.length, 44 + dataLen);
  assert.equal(buf.toString("ascii", 0, 4), "RIFF");
  assert.equal(buf.toString("ascii", 8, 12), "WAVE");
  assert.equal(buf.toString("ascii", 12, 16), "fmt ");
  assert.equal(buf.toString("ascii", 36, 40), "data");

  assert.equal(buf.readUInt32LE(4), 36 + dataLen, "RIFF chunk size");
  assert.equal(buf.readUInt16LE(20), 1, "PCM format");
  assert.equal(buf.readUInt16LE(22), 1, "mono");
  assert.equal(buf.readUInt32LE(24), 44100, "sample rate");
  assert.equal(buf.readUInt32LE(28), 44100 * 2, "byte rate");
  assert.equal(buf.readUInt16LE(32), 2, "block align");
  assert.equal(buf.readUInt16LE(34), 16, "bits per sample");
  assert.equal(buf.readUInt32LE(40), dataLen, "data chunk size");
});

test("encodes samples little-endian and clamps out-of-range values", () => {
  const buf = wavBuffer([0, 32767, -32768, 40000, -40000], 16000);
  assert.equal(buf.readInt16LE(44 + 0), 0);
  assert.equal(buf.readInt16LE(44 + 2), 32767);
  assert.equal(buf.readInt16LE(44 + 4), -32768);
  assert.equal(buf.readInt16LE(44 + 6), 32767, "clamped to max");
  assert.equal(buf.readInt16LE(44 + 8), -32768, "clamped to min");
  assert.equal(buf.readUInt32LE(24), 16000, "respects the given sample rate");
});
