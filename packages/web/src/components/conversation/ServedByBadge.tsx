import { Cpu, Radio, CornerDownLeft } from "lucide-react";

import { cn } from "../../lib/cn";
import { ms, shortKey } from "../../lib/format";
import type { ServedBy } from "../../state/types";
import { Tooltip } from "../ui/Tooltip";

/**
 * A quiet indicator of where an answer actually ran — the trust layer's
 * progressive disclosure. Blue = this device, amber = a delegated peer, and a
 * reroute glyph when a delegated request fell back home. The hover reveals the
 * peer key and transport setup time in mono.
 */
export function ServedByBadge({ served }: { served: ServedBy }) {
  if (served.fallback) {
    return (
      <Tooltip content={<span>{served.reason ?? "Peer unavailable — answered on this device instead."}</span>}>
        <span className={chip("local")}>
          <CornerDownLeft className="h-3 w-3" aria-hidden />
          Rerouted to this device
        </span>
      </Tooltip>
    );
  }
  if (served.servedBy === "remote") {
    return (
      <Tooltip
        mono
        content={
          <span>
            peer {shortKey(served.peerKey)}
            {served.transportMs != null && <> · link {ms(served.transportMs)} ms</>}
          </span>
        }
      >
        <span className={chip("remote")}>
          <Radio className="h-3 w-3" aria-hidden />
          Delegated to a peer
        </span>
      </Tooltip>
    );
  }
  return (
    <span className={chip("local")}>
      <Cpu className="h-3 w-3" aria-hidden />
      Answered on this device
    </span>
  );
}

function chip(tone: "local" | "remote"): string {
  return cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium",
    tone === "local" ? "border-local-line bg-local-soft text-local" : "border-remote-line bg-remote-soft text-remote",
  );
}
