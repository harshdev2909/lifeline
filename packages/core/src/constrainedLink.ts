/**
 * constrainedLink.ts — software resilience for a narrow, lossy link (the LoRa
 * lesson, no radio). Pure and SDK-free: byte-budget an answer, split it into
 * UTF-8-safe chunks that never break a codepoint, frame them for reassembly, and
 * simulate chunk-level ACK/retry so a long reply survives a noisy channel.
 *
 * The model layer instructs a terse answer (terseSystemSuffix); everything here
 * is deterministic and unit-testable (inject an rng for the transmit sim).
 */
const ENC = new TextEncoder();

export function utf8Bytes(s: string): number {
  return ENC.encode(s).length;
}

export interface LinkProfile {
  id: string;
  label: string;
  /** Max UTF-8 bytes per chunk on this link. */
  chunkBytes: number;
}

export const LINK_PROFILES: LinkProfile[] = [
  { id: "lora", label: "LoRa-class · 200 B", chunkBytes: 200 },
  { id: "sms", label: "SMS-class · 140 B", chunkBytes: 140 },
  { id: "tiny", label: "Very narrow · 64 B", chunkBytes: 64 },
];

/**
 * Split text into chunks of at most `maxBytes` UTF-8 bytes, never splitting a
 * code point. `for…of` iterates by code point (surrogate pairs stay whole), so a
 * multibyte character is always kept intact. A single code point larger than
 * `maxBytes` is emitted alone (it cannot be split further).
 */
export function chunkUtf8(text: string, maxBytes: number): string[] {
  if (!Number.isFinite(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be >= 1");
  const chunks: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const cp of text) {
    const b = ENC.encode(cp).length;
    if (curBytes + b > maxBytes && cur !== "") {
      chunks.push(cur);
      cur = "";
      curBytes = 0;
    }
    cur += cp;
    curBytes += b;
  }
  if (cur !== "") chunks.push(cur);
  return chunks;
}

export interface ChunkFrame {
  seq: number;
  total: number;
  bytes: number;
  text: string;
}

/** Frame chunks with a compact seq/total header so the receiver can reassemble + ACK. */
export function frameChunks(chunks: string[]): ChunkFrame[] {
  const total = chunks.length;
  return chunks.map((text, i) => ({ seq: i + 1, total, bytes: utf8Bytes(text), text }));
}

/** Reassemble framed chunks in order; the inverse of chunk+frame. */
export function reassemble(frames: ChunkFrame[]): string {
  return [...frames].sort((a, b) => a.seq - b.seq).map((f) => f.text).join("");
}

/** Trim text to a total byte cap at a code-point boundary (never mid-character). */
export function budgetText(text: string, maxTotalBytes: number): { text: string; truncated: boolean } {
  if (utf8Bytes(text) <= maxTotalBytes) return { text, truncated: false };
  let out = "";
  let bytes = 0;
  for (const cp of text) {
    const b = ENC.encode(cp).length;
    if (bytes + b > maxTotalBytes) break;
    out += cp;
    bytes += b;
  }
  return { text: out, truncated: true };
}

export interface TransmitResult {
  /** Total send attempts across all chunks. */
  attempts: number;
  /** Re-sends caused by simulated loss. */
  retries: number;
  delivered: number;
  /** Chunks that exhausted their retries (lost). */
  dropped: number;
}

/**
 * Simulate sending `chunkCount` chunks over a channel with per-send loss
 * probability `loss`, retrying each chunk up to `maxRetries` times. Deterministic
 * when an `rng` is injected (used by the tests); defaults to Math.random.
 */
export function simulateTransmit(
  chunkCount: number,
  opts: { loss?: number; maxRetries?: number; rng?: () => number } = {},
): TransmitResult {
  const loss = Math.max(0, Math.min(0.95, opts.loss ?? 0));
  const maxRetries = opts.maxRetries ?? 5;
  const rng = opts.rng ?? Math.random;
  let attempts = 0;
  let retries = 0;
  let delivered = 0;
  let dropped = 0;
  for (let i = 0; i < chunkCount; i++) {
    let tries = 0;
    let ok = false;
    while (tries <= maxRetries) {
      attempts++;
      if (tries > 0) retries++;
      if (rng() >= loss) {
        ok = true;
        break;
      }
      tries++;
    }
    if (ok) delivered++;
    else dropped++;
  }
  return { attempts, retries, delivered, dropped };
}

/** Appended to the system prompt in constrained-link mode: answer tersely. */
export function terseSystemSuffix(): string {
  return (
    "The link to this device is very narrow, so every byte counts. Answer in the fewest words that still help: " +
    "the single most important action first, then only the essential steps. No preamble and no restating the question — short, plain lines."
  );
}
