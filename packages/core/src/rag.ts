/**
 * rag.ts — KnowledgeBase over QVAC's built-in RAG (HyperDB workspace).
 *
 * Retrieval runs LOCALLY (embeddings + vector search on this device); the LLM
 * completion that consumes the retrieved passages honors the existing engine
 * seam (local OR delegated). QVAC's `RagSearchResult` carries no metadata, so we
 * encode the source/section into the document `id` (which IS returned) via the
 * segregated flow: JS-chunk → embed() → ragSaveEmbeddings() with custom ids.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { performance } from "node:perf_hooks";

import {
  loadModel,
  unloadModel,
  embed,
  ragSaveEmbeddings,
  ragSearch,
  ragCloseWorkspace,
  EMBEDDINGGEMMA_300M_Q8_0,
} from "@qvac/sdk";
import type { LoadModelOptions, ModelProgressUpdate } from "@qvac/sdk";

import type { ModelSrc, ProgressUpdate } from "./types";

const SEP = "||";

export interface RetrievedPassage {
  id: string;
  source: string;
  section: string;
  content: string;
  score: number;
  /** Best-effort [start,end) char offsets of this passage within its source file. */
  charRange?: [number, number];
  /** Truncated grounding snippet (first ~120 chars of the passage). */
  snippet: string;
}

interface ChunkMeta {
  source: string;
  section: string;
  charRange?: [number, number];
  snippet: string;
}

export interface IngestStats {
  workspace: string;
  doc_count: number;
  chunk_count: number;
  embed_model: string;
  ingest_ms: number;
}

export interface SearchStats {
  query: string;
  topK: number;
  results: Array<{ source: string; section: string; score: number; chars: number }>;
  search_ms: number;
}

export interface KnowledgeBaseOptions {
  embedSrc?: ModelSrc;
  embedLabel?: string;
  workspace?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  onProgress?: (p: ProgressUpdate) => void;
}

interface Chunk {
  id: string;
  content: string;
  source: string;
  section: string;
}

/** Split text into ~chunkSize-char chunks on paragraph boundaries, with char overlap. */
function chunkText(text: string, size: number, overlap: number): string[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > size) {
      chunks.push(cur);
      cur = overlap > 0 ? cur.slice(-overlap) + "\n\n" + p : p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

/** Parse a markdown-ish file into [sectionTitle, body] pairs (whole file if no headings). */
function splitSections(text: string): Array<{ title: string; body: string }> {
  const lines = text.split("\n");
  const sections: Array<{ title: string; body: string }> = [];
  let title = "intro";
  let body: string[] = [];
  const flush = () => {
    const b = body.join("\n").trim();
    if (b) sections.push({ title, body: b });
    body = [];
  };
  for (const line of lines) {
    const h = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (h) {
      flush();
      title = h[1].trim().slice(0, 60);
    } else {
      body.push(line);
    }
  }
  flush();
  return sections.length ? sections : [{ title: "intro", body: text.trim() }];
}

export class KnowledgeBase {
  readonly workspace: string;
  private readonly embedSrc: ModelSrc;
  readonly embedLabel: string;
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly progressCb?: (p: ProgressUpdate) => void;
  private embedModelId?: string;
  /** Persisted chunk metadata — retrieval reads this, never re-parses the id. */
  private readonly idMap = new Map<string, ChunkMeta>();

  constructor(opts: KnowledgeBaseOptions = {}) {
    this.embedSrc = opts.embedSrc ?? EMBEDDINGGEMMA_300M_Q8_0;
    this.embedLabel = opts.embedLabel ?? "EmbeddingGemma-300M (Q8_0)";
    this.workspace = opts.workspace ?? "lifeline-medical";
    this.chunkSize = opts.chunkSize ?? 900;
    this.chunkOverlap = opts.chunkOverlap ?? 120;
    this.progressCb = opts.onProgress;
  }

  get embeddingModelId(): string {
    if (!this.embedModelId) throw new Error("KnowledgeBase not open()'d");
    return this.embedModelId;
  }

  /** Load the embedding model locally. */
  async open(): Promise<void> {
    const opts = {
      modelSrc: this.embedSrc,
      modelType: "llamacpp-embedding",
      onProgress: (p: ModelProgressUpdate) => this.progressCb?.(p),
    } as unknown as LoadModelOptions;
    this.embedModelId = await loadModel(opts);
  }

  private collectChunks(path: string): { chunks: Chunk[]; docCount: number } {
    const files: string[] = [];
    const st = statSync(path);
    if (st.isDirectory()) {
      for (const name of readdirSync(path)) {
        // Skip metadata files (license/source/readme) — they aren't medical knowledge.
        if (/^(SOURCE|README|LICENSE)\b/i.test(name)) continue;
        if (/\.(txt|md|markdown)$/i.test(name)) files.push(join(path, name));
      }
    } else {
      files.push(path);
    }
    const chunks: Chunk[] = [];
    for (const file of files.sort()) {
      const source = basename(file, extname(file));
      const text = readFileSync(file, "utf8");
      for (const { title, body } of splitSections(text)) {
        const pieces = chunkText(body, this.chunkSize, this.chunkOverlap);
        pieces.forEach((content, i) => {
          const id = [source, title, i].join(SEP);
          chunks.push({ id, content, source, section: title });
          // Best-effort char range: locate a verbatim tail of the chunk in the file.
          const tail = content.slice(-50);
          const ti = text.indexOf(tail);
          const charRange: [number, number] | undefined =
            ti >= 0 ? [Math.max(0, ti + tail.length - content.length), ti + tail.length] : undefined;
          const snippet = content.replace(/\s+/g, " ").trim().slice(0, 120);
          this.idMap.set(id, { source, section: title, charRange, snippet });
        });
      }
    }
    return { chunks, docCount: files.length };
  }

  /** Chunk + embed + save a corpus file or directory into the workspace. */
  async ingest(pathOrDir: string): Promise<IngestStats> {
    const t0 = performance.now();
    const { chunks, docCount } = this.collectChunks(pathOrDir);
    if (chunks.length === 0) throw new Error(`No .txt/.md content found at ${pathOrDir}`);

    const modelId = this.embeddingModelId;
    const { embedding } = await embed({ modelId, text: chunks.map((c) => c.content) });
    const vectors = embedding as number[][];

    await ragSaveEmbeddings({
      modelId,
      workspace: this.workspace,
      documents: chunks.map((c, i) => ({
        id: c.id,
        content: c.content,
        embedding: vectors[i],
        embeddingModelId: modelId,
        metadata: { source: c.source, section: c.section },
      })),
    });

    return {
      workspace: this.workspace,
      doc_count: docCount,
      chunk_count: chunks.length,
      embed_model: this.embedLabel,
      ingest_ms: Math.round(performance.now() - t0),
    };
  }

  /** Retrieve topK passages for a query (local vector search). */
  async retrieve(query: string, topK = 4): Promise<{ passages: RetrievedPassage[]; stats: SearchStats }> {
    const t0 = performance.now();
    const results = await ragSearch({ modelId: this.embeddingModelId, query, topK, workspace: this.workspace });
    const passages: RetrievedPassage[] = results.map((r) => {
      // Read the persisted metadata map (do NOT re-parse the id); fall back only if absent.
      const meta = this.idMap.get(r.id);
      const [source = "?", section = ""] = r.id.split(SEP);
      return {
        id: r.id,
        source: meta?.source ?? source,
        section: meta?.section ?? section,
        content: r.content,
        score: r.score,
        charRange: meta?.charRange,
        snippet: meta?.snippet ?? r.content.replace(/\s+/g, " ").trim().slice(0, 120),
      };
    });
    const stats: SearchStats = {
      query,
      topK,
      results: passages.map((p) => ({ source: p.source, section: p.section, score: p.score, chars: p.content.length })),
      search_ms: Math.round(performance.now() - t0),
    };
    return { passages, stats };
  }

  /** Close the workspace (deleting its data) and unload the embedding model. */
  async close(): Promise<void> {
    try {
      await ragCloseWorkspace({ workspace: this.workspace, deleteOnClose: true });
    } catch {
      /* ignore */
    }
    if (this.embedModelId) {
      try {
        await unloadModel({ modelId: this.embedModelId });
      } catch {
        /* ignore */
      }
      this.embedModelId = undefined;
    }
  }
}
