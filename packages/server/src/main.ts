/**
 * main.ts — the Lifeline local bridge.
 *
 * Binds an HTTP server (tiny API + static UI hosting) and a WebSocket endpoint
 * (/ws) for streaming turns, both on localhost only. On connect it sends a
 * `hello` with device info, settings, the model list, and a mesh snapshot; then
 * each `start` message runs one turn through the orchestrator and streams the
 * results back. It does no inference itself — every model call goes through
 * @lifeline/core — and it never imports @qvac/sdk.
 */
import { createServer } from "node:http";

import { WebSocketServer, type WebSocket } from "ws";

import { HOST, MODEL_REGISTRY, PORT, getSettings, setupQvacEnv } from "./config";
import { engineManager } from "./engineManager";
import { createHttpHandler, deviceInfo } from "./http";
import { buildMeshSnapshot } from "./meshService";
import { runTurn } from "./orchestrator";
import { stopProvider } from "./providerService";
import type { ClientMessage, ServerEvent } from "./protocol";
import { tracked } from "./serialize";
import { runTool } from "./toolRunner";
import { cleanupUploads } from "./uploads";
import { VoiceSession } from "./voice";

setupQvacEnv();

// Safety net: tearing the SDK worker down aborts any in-flight RPC, and the SDK
// surfaces that as an unhandled stream 'error' (WORKER_SHUTDOWN, code 50206). It
// is benign — the teardown is intentional — so swallow exactly that and keep the
// bridge alive; anything else still crashes loudly.
process.on("uncaughtException", (err: unknown) => {
  const e = err as { code?: number; message?: string };
  const msg = e?.message ?? String(err);
  if (e?.code === 50206 || /WORKER_SHUTDOWN|shutting down/i.test(msg)) {
    process.stderr.write(`  (ignored benign worker-shutdown RPC abort)\n`);
    return;
  }
  // A worker crash (e.g. the OS OOM-killing a too-large generation like Wan
  // video on a small device) surfaces as a rejected RPC the caller already
  // turns into a tool_error — keep the bridge alive rather than exiting.
  if (e?.code === 50205 || /WORKER_CRASHED|SIGKILL|worker exited/i.test(msg)) {
    process.stderr.write(`  (ignored worker crash — surfaced to the client as an error)\n`);
    return;
  }
  process.stderr.write(`\nUncaught: ${msg}\n${(err as Error)?.stack ?? ""}\n`);
  process.exit(1);
});

const httpServer = createServer(createHttpHandler());
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

function send(ws: WebSocket, ev: ServerEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev));
}

wss.on("connection", (ws) => {
  // Per-connection turn registry, so `cancel` can abort the right turn.
  const turns = new Map<string, AbortController>();
  // Live voice loop for this connection (binary frames carry PCM both ways).
  const voice = new VoiceSession(
    (ev) => send(ws, ev),
    (pcm) => {
      if (ws.readyState === ws.OPEN) ws.send(pcm, { binary: true });
    },
  );

  // Attach listeners synchronously FIRST — the client sends `start` as soon as
  // the socket opens, and any await here would drop that message.
  ws.on("message", (raw, isBinary) => {
    // Binary frames are mic PCM for the voice loop.
    if (isBinary) {
      voice.audio(raw as Buffer);
      return;
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "cancel":
        turns.get(msg.turnId)?.abort();
        break;
      case "tool_cancel":
        turns.get(msg.runId)?.abort();
        break;
      case "tool_run": {
        const run = msg.run;
        const controller = new AbortController();
        turns.set(run.runId, controller);
        send(ws, { type: "tool_accepted", runId: run.runId });
        // Serialize against turns/probes; stream the capability's events as they happen.
        tracked(() => runTool(run, (ev) => send(ws, ev), controller.signal))
          .catch((err) => send(ws, { type: "tool_error", runId: run.runId, message: err instanceof Error ? err.message : String(err) }))
          .finally(() => turns.delete(run.runId));
        break;
      }
      case "voice_start":
        void voice.start(msg.options ?? {});
        break;
      case "voice_stop":
        void voice.stop();
        break;
      case "start": {
        const turn = msg.turn;
        const controller = new AbortController();
        turns.set(turn.id, controller);
        send(ws, { type: "turn_accepted", turnId: turn.id });
        // Serialize against other turns/probes; stream events as they happen.
        tracked(() => runTurn(turn, (ev) => send(ws, ev), controller.signal))
          .catch((err) => send(ws, { type: "error", turnId: turn.id, message: err instanceof Error ? err.message : String(err) }))
          .finally(() => turns.delete(turn.id));
        break;
      }
    }
  });

  ws.on("close", () => {
    for (const c of turns.values()) c.abort();
    turns.clear();
    void voice.stop();
  });

  // Now greet the client (mesh snapshot may probe internet reachability, so this
  // is async — but the message handler above is already live).
  void (async () => {
    try {
      send(ws, {
        type: "hello",
        device: deviceInfo(),
        settings: getSettings(),
        models: MODEL_REGISTRY,
        mesh: await buildMeshSnapshot(),
      });
    } catch {
      /* a failed hello shouldn't drop the socket */
    }
  })();
});

httpServer.listen(PORT, HOST, () => {
  process.stdout.write(
    `\nLifeline bridge · http://${HOST}:${PORT}  ·  ws://${HOST}:${PORT}/ws\n` +
      `  100% local — no inference here, no cloud. Open the URL above once the UI is built (npm run ui).\n\n`,
  );
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write("\n  shutting down bridge…\n");
  cleanupUploads();
  wss.close();
  httpServer.close();
  // Stop serving and dispose the warm engine/worker so nothing outlives the process.
  Promise.allSettled([stopProvider(), engineManager.dispose()]).finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
