#!/usr/bin/env node
/**
 * Dev utility: prefetch and smoke-test the RAG embedding model
 * (EMBEDDINGGEMMA_300M_Q8_0) so it is cached and available offline.
 *
 * Standalone — imports @qvac/sdk directly. This is a one-off prefetch tool, not
 * part of the node-app CLI (which depends only on @lifeline/core). Run:
 *   node scripts/prefetch-embeddings.mjs
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Same storage routing as the CLI: shared weights cache on the SSD, off the full home disk.
process.env.QVAC_CONFIG_PATH ??= join(repoRoot, "qvac.config.js");
process.env.SNAP_USER_COMMON ??= join(repoRoot, ".qvac-home");

const { loadModel, embed, unloadModel, close, EMBEDDINGGEMMA_300M_Q8_0 } = await import("@qvac/sdk");

let modelId;
try {
  const mb = (EMBEDDINGGEMMA_300M_Q8_0.expectedSize / 1e6).toFixed(0);
  process.stderr.write(`Prefetching embedding model ${EMBEDDINGGEMMA_300M_Q8_0.name} (~${mb} MB)…\n`);
  modelId = await loadModel({
    modelSrc: EMBEDDINGGEMMA_300M_Q8_0,
    modelType: "llamacpp-embedding",
    onProgress: (p) => {
      if (p && typeof p.percentage === "number") process.stderr.write(`\r  ⬇ ${p.percentage}%        `);
    },
  });
  process.stderr.write(`\n  ✓ loaded (modelId=${modelId})\n`);
  const { embedding, stats } = await embed({ modelId, text: "heat stroke first aid steps" });
  process.stderr.write(`  ✓ embed OK — vector dims=${embedding.length}\n`);
  process.stdout.write(JSON.stringify({ model: EMBEDDINGGEMMA_300M_Q8_0.name, dims: embedding.length, stats }) + "\n");
} finally {
  if (modelId) await unloadModel({ modelId }).catch(() => {});
  await close().catch(() => {});
}
