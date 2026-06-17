import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

import { getFile, registerFile, saveUpload, streamFile } from "../src/uploads";

test("saveUpload writes bytes and round-trips by id", () => {
  const bytes = Buffer.from("RIFF....WAVEfmt ", "utf8");
  const f = saveUpload("audio", "voice.wav", "audio/wav", bytes);
  assert.equal(f.kind, "audio");
  assert.equal(f.name, "voice.wav");
  assert.equal(extname(f.path), ".wav");
  assert.deepEqual(readFileSync(f.path), bytes);

  const got = getFile(f.id);
  assert.ok(got);
  assert.equal(got?.path, f.path);
});

test("saveUpload infers an extension from the MIME type when the name has none", () => {
  const f = saveUpload("image", "", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.equal(extname(f.path), ".png");
});

test("streamFile returns a readable stream for a stored file, undefined otherwise", () => {
  const f = saveUpload("ocr", "label.jpg", "image/jpeg", Buffer.from("jpegbytes"));
  const s = streamFile(f.id);
  assert.ok(s);
  assert.equal(s?.mime, "image/jpeg");
  s?.stream.destroy();
  assert.equal(streamFile("does-not-exist"), undefined);
});

test("registerFile exposes an already-written file by a new id", () => {
  const f = saveUpload("tts", "answer.wav", "audio/wav", Buffer.from("pcm"));
  const reg = registerFile(f.path, "tts", "audio/wav");
  assert.notEqual(reg.id, f.id);
  assert.equal(getFile(reg.id)?.path, f.path);
});
