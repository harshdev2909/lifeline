#!/usr/bin/env node
// Thin launcher so `lifeline ask "..."` works after `npm install` (bin link),
// and so `./lifeline` at the repo root works during development.
// It runs the TypeScript CLI through tsx without a separate build step.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../src/cli.ts");

const res = spawnSync(
  process.execPath,
  ["--import", "tsx", cli, ...process.argv.slice(2)],
  { stdio: "inherit" }
);
process.exit(res.status ?? 1);
