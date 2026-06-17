#!/usr/bin/env node
/**
 * ui.mjs — the one documented command for the web interface.
 *
 *   npm run ui
 *
 * Builds the web app (fully self-hosted: fonts and assets bundled, no runtime
 * CDN) and then starts the local bridge serving it. Open the printed URL — it
 * loads and runs with the network off. For live development use `npm run web`
 * (Vite dev server) alongside `npm run bridge`.
 */
import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(repoRoot, "packages", "web", "dist");
const skipBuild = process.argv.includes("--no-build") && existsSync(dist);

if (!skipBuild) {
  process.stdout.write("\nBuilding the Lifeline UI (offline bundle)…\n");
  const build = spawnSync("npm", ["run", "build", "--workspace", "@lifeline/web"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

process.stdout.write("\nStarting the Lifeline bridge…\n");
const bridge = spawn("npx", ["tsx", join("packages", "server", "src", "main.ts")], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});
bridge.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => bridge.kill("SIGINT"));
process.on("SIGTERM", () => bridge.kill("SIGTERM"));
