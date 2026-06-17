/**
 * sysinfo.ts — capture hardware + runtime metadata for the evidence log.
 *
 * Runnable directly:  npm run sysinfo   (prints JSON + a human table)
 * Importable:         collectSysInfo()  (used by the CLI to stamp each run)
 */
import os from "node:os";
import { pathToFileURL } from "node:url";

export interface SysInfo {
  ts: string;
  runtime: "node" | "bare";
  node_version: string;
  v8_version: string;
  platform: NodeJS.Platform;
  arch: string;
  os_release: string;
  cpu_model: string;
  cpu_cores: number;
  cpu_speed_mhz: number;
  total_ram_gb: number;
  free_ram_gb: number;
  /**
   * GPU/accel backend QVAC is EXPECTED to use on this platform (per QVAC docs:
   * Metal on macOS/iOS, Vulkan on Linux/Windows/Android, OpenCL on some Android,
   * CPU fallback otherwise). The AUTHORITATIVE value is captured per-inference
   * from QVAC's reported `backendDevice` in the evidence log.
   */
  qvac_accel_backend_expected: "Metal" | "Vulkan" | "CPU";
  qvac_accel_note: string;
}

function expectedAccelBackend(platform: NodeJS.Platform): SysInfo["qvac_accel_backend_expected"] {
  if (platform === "darwin") return "Metal";
  if (platform === "linux" || platform === "win32") return "Vulkan";
  return "CPU";
}

export function collectSysInfo(): SysInfo {
  const cpus = os.cpus();
  const round = (n: number, d = 2) => Number(n.toFixed(d));
  // `Bare` exposes a global `Bare`; plain Node does not.
  const runtime: SysInfo["runtime"] =
    typeof (globalThis as Record<string, unknown>).Bare !== "undefined" ? "bare" : "node";

  return {
    ts: new Date().toISOString(),
    runtime,
    node_version: process.version,
    v8_version: process.versions.v8 ?? "unknown",
    platform: process.platform,
    arch: process.arch,
    os_release: os.release(),
    cpu_model: cpus[0]?.model?.trim() ?? "unknown",
    cpu_cores: cpus.length,
    cpu_speed_mhz: cpus[0]?.speed ?? 0,
    total_ram_gb: round(os.totalmem() / 1024 ** 3),
    free_ram_gb: round(os.freemem() / 1024 ** 3),
    qvac_accel_backend_expected: expectedAccelBackend(process.platform),
    qvac_accel_note:
      "Expected from platform; authoritative backend (cpu/gpu) is recorded per-inference from QVAC's reported backendDevice.",
  };
}

export function formatSysInfoTable(s: SysInfo): string {
  const rows: Array<[string, string]> = [
    ["Runtime", `${s.runtime} ${s.node_version} (V8 ${s.v8_version})`],
    ["Platform", `${s.platform} / ${s.arch} (release ${s.os_release})`],
    ["CPU", `${s.cpu_model}`],
    ["CPU cores", `${s.cpu_cores} @ ${s.cpu_speed_mhz} MHz`],
    ["RAM", `${s.total_ram_gb} GB total, ${s.free_ram_gb} GB free`],
    ["QVAC accel (expected)", s.qvac_accel_backend_expected],
  ];
  const w = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `  ${k.padEnd(w)} : ${v}`).join("\n");
}

// --- run-as-script entrypoint ------------------------------------------------
const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  const info = collectSysInfo();
  // Human-readable table to stderr, machine JSON to stdout (pipe-friendly).
  process.stderr.write("\nLifeline — system info\n");
  process.stderr.write(formatSysInfoTable(info) + "\n\n");
  process.stdout.write(JSON.stringify(info, null, 2) + "\n");
}
