// QVAC SDK config (auto-discovered from project root; also set via QVAC_CONFIG_PATH by the CLI).
//
// SHARED model-weights cache for every role/process (provider + consumers + bench).
// Weights download once and are reused, so delegated fallback-to-local is instant and we
// never re-pull the GGUF. Per-role registry corestores live under each role's own
// SNAP_USER_COMMON home (set by the CLI) so a long-lived provider's corestore lock never
// collides with a consumer process. Path is computed from this file's location (portable).
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default {
  cacheDirectory: join(here, ".qvac-home", ".qvac", "models"),
};
