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
import type { ClientMessage, ServerEvent } from "./protocol";
import { tracked } from "./serialize";
import { cleanupUploads } from "./uploads";
import { VoiceSession } from "./voice";

setupQvacEnv();

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
  // Dispose the warm engine/worker so it never outlives the process.
  engineManager
    .dispose()
    .catch(() => {})
    .finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
