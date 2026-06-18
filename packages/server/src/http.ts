/**
 * http.ts — the tiny HTTP API + static hosting for the built UI.
 *
 * Endpoints (all localhost-only):
 *   GET  /api/health            liveness
 *   GET  /api/device            sysinfo for this device
 *   GET  /api/settings          current settings
 *   PUT  /api/settings          patch settings (model, language, peers, …)
 *   GET  /api/mesh              mesh snapshot (no probe)
 *   POST /api/mesh/probe        mesh snapshot with real peer liveness
 *   POST /api/upload            raw bytes → attachment id (kind/name in headers)
 *   GET  /api/audio/:id         stream a generated (or uploaded) audio file
 * Anything else is served from packages/web/dist (with SPA fallback), so the
 * built, fully self-hosted UI loads from the same origin with the network off.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";

import { collectSysInfo } from "@lifeline/core";

import { getSettings, MODEL_REGISTRY, resolvePeerRef, updateSettings, WEB_DIST } from "./config";
import { engineManager } from "./engineManager";
import { buildMeshSnapshot, probeMesh } from "./meshService";
import type { ServerSettings } from "./protocol";
import { tracked } from "./serialize";
import { saveUpload, streamFile } from "./uploads";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(s) });
  res.end(s);
}

function readBody(req: IncomingMessage, limit = 32 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function deviceInfo() {
  const s = collectSysInfo();
  return {
    label: "this device",
    platform: s.platform,
    arch: s.arch,
    cpu: s.cpu_model,
    cores: s.cpu_cores,
    ramGb: s.total_ram_gb,
    accel: s.qvac_accel_backend_expected,
    runtime: s.runtime,
    nodeVersion: s.node_version,
  };
}

function applySettingsPatch(patch: Partial<ServerSettings> & { peers?: { label?: string; ref: string; role?: string; model?: string }[] }): ServerSettings {
  const next: Partial<ServerSettings> = { ...patch };
  if (Array.isArray(patch.peers)) {
    next.peers = patch.peers.filter((p) => p && p.ref?.trim()).map((p) => resolvePeerRef(p.ref, p.label, p.role, p.model));
  }
  return updateSettings(next);
}

/** Returns true if the request was an API request (and was handled). */
async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/api/")) return false;
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,PUT,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,x-kind,x-filename");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  try {
    if (path === "/api/health") return json(res, 200, { ok: true }), true;
    if (path === "/api/device") return json(res, 200, deviceInfo()), true;

    if (path === "/api/settings" && req.method === "GET") return json(res, 200, getSettings()), true;
    if (path === "/api/settings" && req.method === "PUT") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      // A changed model / grounding / peer set changes the warm-slot signature, so
      // the next turn rebuilds it inside the turn lock — no teardown needed here.
      return json(res, 200, applySettingsPatch(body)), true;
    }

    if (path === "/api/mesh" && req.method === "GET") return json(res, 200, await buildMeshSnapshot()), true;
    if (path === "/api/mesh/probe" && req.method === "POST") {
      // Probing closes the SDK worker, so tear the warm slot down first — inside the
      // same lock — then probe; the next turn re-warms.
      return json(res, 200, await tracked(async () => {
        await engineManager.dispose();
        return probeMesh();
      })), true;
    }

    if (path === "/api/models") return json(res, 200, MODEL_REGISTRY), true;

    if (path === "/api/upload" && req.method === "POST") {
      const kindHeader = String(req.headers["x-kind"] ?? "image");
      const kind = (["image", "ocr", "audio"].includes(kindHeader) ? kindHeader : "image") as "image" | "ocr" | "audio";
      const name = decodeURIComponent(String(req.headers["x-filename"] ?? ""));
      const mime = String(req.headers["content-type"] ?? "application/octet-stream");
      const bytes = await readBody(req);
      if (!bytes.length) return json(res, 400, { error: "empty upload" }), true;
      const f = saveUpload(kind, name, mime, bytes);
      return json(res, 200, { id: f.id, name: f.name, kind: f.kind }), true;
    }

    if (path.startsWith("/api/audio/")) {
      const id = path.slice("/api/audio/".length);
      const file = streamFile(id);
      if (!file) return json(res, 404, { error: "not found" }), true;
      res.writeHead(200, { "content-type": file.mime, "cache-control": "no-store" });
      file.stream.pipe(res);
      return true;
    }

    return json(res, 404, { error: `no route ${req.method} ${path}` }), true;
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) }), true;
  }
}

function serveStatic(res: ServerResponse, pathname: string): void {
  if (!existsSync(WEB_DIST)) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end(
      "Lifeline bridge is running, but the web UI has not been built yet.\n" +
        "Run `npm run ui` (builds the UI, then serves it here), or `npm run web` for the dev server.\n",
    );
    return;
  }
  // Resolve within WEB_DIST; fall back to index.html for client-side routes.
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(WEB_DIST, rel);
  if (!file.startsWith(WEB_DIST)) file = join(WEB_DIST, "index.html");
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(WEB_DIST, "index.html");
  const ext = extname(file).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  // Hashed assets are immutable; index.html must always revalidate.
  const cache = ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable";
  res.writeHead(200, { "content-type": mime, "cache-control": cache });
  createReadStream(file).pipe(res);
}

export function createHttpHandler() {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    handleApi(req, res, url)
      .then((handled) => {
        if (!handled) serveStatic(res, url.pathname);
      })
      .catch((err) => {
        if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : String(err) });
        else res.end();
      });
  };
}
