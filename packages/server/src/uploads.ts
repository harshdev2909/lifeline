/**
 * uploads.ts — tiny file store for attachments and generated audio.
 *
 * The browser POSTs raw bytes (octet-stream) to /api/upload with the kind and
 * filename in headers; we write them to a temp dir and hand back an id the turn
 * request can reference. TTS output is registered the same way and streamed back
 * from /api/audio/:id. No multipart parsing, no dependencies — everything stays
 * on local disk and is cleaned up on process exit.
 */
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

const DIR = join(tmpdir(), "lifeline-bridge");
mkdirSync(DIR, { recursive: true });

export interface StoredFile {
  id: string;
  path: string;
  kind: "image" | "ocr" | "audio" | "tts" | "video";
  name: string;
  mime: string;
}

const store = new Map<string, StoredFile>();

function extFor(kind: StoredFile["kind"], name: string, mime: string): string {
  const fromName = extname(name);
  if (fromName) return fromName;
  if (kind === "audio") return mime.includes("wav") ? ".wav" : mime.includes("webm") ? ".webm" : ".audio";
  if (mime.includes("png")) return ".png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  return ".bin";
}

export function saveUpload(kind: StoredFile["kind"], name: string, mime: string, bytes: Buffer): StoredFile {
  const id = randomUUID();
  const path = join(DIR, `${id}${extFor(kind, name, mime)}`);
  writeFileSync(path, bytes);
  const file: StoredFile = { id, path, kind, name: name || `${kind}${extFor(kind, name, mime)}`, mime };
  store.set(id, file);
  return file;
}

/** Register an already-written file (e.g. a TTS wav) so it can be served. */
export function registerFile(path: string, kind: StoredFile["kind"], mime: string): StoredFile {
  const id = randomUUID();
  const file: StoredFile = { id, path, kind, name: path.split("/").pop() ?? id, mime };
  store.set(id, file);
  return file;
}

export function getFile(id: string): StoredFile | undefined {
  return store.get(id);
}

export function streamFile(id: string) {
  const f = store.get(id);
  if (!f || !existsSync(f.path)) return undefined;
  return { mime: f.mime, stream: createReadStream(f.path) };
}

export function cleanupUploads(): void {
  try {
    rmSync(DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
