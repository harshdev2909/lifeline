/**
 * api.ts — the tiny HTTP client for the local bridge. Same-origin, localhost
 * only. The WebSocket (see state/bridge.tsx) carries the streaming turns; this
 * covers settings, the mesh snapshot/probe, uploads, and audio.
 */
import type { IncidentInput, IncidentReport, IncidentSummary, MeshSnapshot, ModelKey, ServerSettings } from "./protocol";

async function jsonReq<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function getSettings(): Promise<ServerSettings> {
  return jsonReq<ServerSettings>("/api/settings");
}

export function putSettings(patch: Partial<ServerSettings>): Promise<ServerSettings> {
  return jsonReq<ServerSettings>("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function getMesh(): Promise<MeshSnapshot> {
  return jsonReq<MeshSnapshot>("/api/mesh");
}

export function probeMesh(): Promise<MeshSnapshot> {
  return jsonReq<MeshSnapshot>("/api/mesh/probe", { method: "POST" });
}

export interface ProviderStatus {
  serving: boolean;
  publicKey?: string;
  topic?: string;
  model?: ModelKey;
  modelLabel?: string;
  error?: string;
}

export function getProvider(): Promise<ProviderStatus> {
  return jsonReq<ProviderStatus>("/api/provider");
}

export function startProvider(topic: string, model: ModelKey): Promise<ProviderStatus> {
  return jsonReq<ProviderStatus>("/api/provider/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic, model }),
  });
}

export function stopProvider(): Promise<ProviderStatus> {
  return jsonReq<ProviderStatus>("/api/provider/stop", { method: "POST" });
}

export interface UploadResult {
  id: string;
  name: string;
  kind: "image" | "ocr" | "audio";
}

/** Upload raw bytes; the bridge writes a temp file and returns an attachment id. */
export async function uploadFile(kind: UploadResult["kind"], data: Blob, name: string): Promise<UploadResult> {
  return jsonReq<UploadResult>("/api/upload", {
    method: "POST",
    headers: {
      "content-type": data.type || "application/octet-stream",
      "x-kind": kind,
      "x-filename": encodeURIComponent(name),
    },
    body: data,
  });
}

// --- Incident reports ---
export function listIncidents(): Promise<IncidentSummary[]> {
  return jsonReq<IncidentSummary[]>("/api/incidents");
}

export function getIncident(id: string): Promise<IncidentReport> {
  return jsonReq<IncidentReport>(`/api/incidents/${encodeURIComponent(id)}`);
}

export function createIncident(input: IncidentInput): Promise<IncidentReport> {
  return jsonReq<IncidentReport>("/api/incidents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function handoffIncident(id: string, to: string): Promise<IncidentReport> {
  return jsonReq<IncidentReport>(`/api/incidents/${encodeURIComponent(id)}/handoff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to }),
  });
}

/** Same-origin download URL for an incident export (md | json). */
export function incidentExportUrl(id: string, format: "md" | "json"): string {
  return `/api/incidents/${encodeURIComponent(id)}/export?format=${format}`;
}
