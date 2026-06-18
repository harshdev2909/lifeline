/**
 * useToolRun — the shared state machine every capability tool drives. It starts
 * a tool run on the bridge and folds the streamed events (stage → token →
 * telemetry → done | error) into simple state, so each tool view stays small and
 * every tool behaves identically.
 */
import { useCallback, useRef, useState } from "react";

import type { ToolEvent, ToolId, ToolOutput, ToolTelemetry, ToolUpload } from "../../lib/protocol";
import { useBridge } from "../../state/bridge";

export type RunPhase = "idle" | "running" | "done" | "error";

export interface ToolRunReq {
  tool: ToolId;
  uploads?: ToolUpload[];
  params?: Record<string, unknown>;
  options?: { delegate?: boolean };
}

export function useToolRun() {
  const { runTool, status } = useBridge();
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [stage, setStage] = useState("");
  const [stream, setStream] = useState("");
  const [output, setOutput] = useState<ToolOutput | null>(null);
  const [telemetry, setTelemetry] = useState<ToolTelemetry | undefined>(undefined);
  const [evidence, setEvidence] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const handle = useRef<{ cancel: () => void } | null>(null);

  const run = useCallback(
    (req: ToolRunReq) => {
      setPhase("running");
      setStage("");
      setStream("");
      setOutput(null);
      setTelemetry(undefined);
      setEvidence(undefined);
      setError(undefined);
      handle.current = runTool(req, (ev: ToolEvent) => {
        switch (ev.type) {
          case "tool_stage":
            setStage(ev.status === "done" ? "" : ev.detail ?? "Working…");
            break;
          case "tool_token":
            setStream((s) => s + ev.delta);
            break;
          case "tool_telemetry":
            setTelemetry(ev.telemetry);
            break;
          case "tool_done":
            setOutput(ev.output);
            setEvidence(ev.evidence);
            setPhase("done");
            break;
          case "tool_error":
            setError(ev.message);
            setPhase("error");
            break;
        }
      });
    },
    [runTool],
  );

  const reset = useCallback(() => {
    handle.current?.cancel();
    handle.current = null;
    setPhase("idle");
    setStage("");
    setStream("");
    setOutput(null);
    setTelemetry(undefined);
    setEvidence(undefined);
    setError(undefined);
  }, []);

  return { phase, stage, stream, output, telemetry, evidence, error, run, reset, ready: status === "open" };
}
