import { Loader2, PlugZap, WifiOff } from "lucide-react";

import { cn } from "../../lib/cn";
import { useBridge } from "../../state/bridge";
import { Tooltip } from "../ui/Tooltip";

/**
 * Connection + reachability status. The bridge link is what matters (the UI
 * talks only to localhost); internet-down is shown as a calm, expected state —
 * "Working offline" — not an error, because everything still runs on-device.
 */
export function OfflineIndicator() {
  const { status, mesh } = useBridge();

  if (status !== "open") {
    const reconnecting = status === "connecting";
    return (
      <Badge tone="warn" tooltip={reconnecting ? "Connecting to the local bridge…" : "Lost the local bridge — retrying. Start it with `npm run bridge`."}>
        {reconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlugZap className="h-3 w-3" />}
        {reconnecting ? "Connecting" : "Reconnecting"}
      </Badge>
    );
  }

  const online = mesh?.internet ?? true;
  return online ? (
    <Badge tone="ok" tooltip="Connected to the on-device bridge. Inference runs locally; peer discovery can use the network.">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-breathe rounded-full bg-accent opacity-70" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
      On-device
    </Badge>
  ) : (
    <Badge tone="muted" tooltip="No internet — and that's fine. Everything runs on this device; only cross-device delegation needs a network.">
      <WifiOff className="h-3 w-3" />
      Working offline
    </Badge>
  );
}

function Badge({ tone, tooltip, children }: { tone: "ok" | "warn" | "muted"; tooltip: string; children: React.ReactNode }) {
  return (
    <Tooltip content={<span className="text-xs">{tooltip}</span>}>
      <span
        className={cn(
          "inline-flex cursor-default items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium",
          tone === "ok" && "border-accent-line bg-accent-soft text-accent",
          tone === "warn" && "border-remote-line bg-remote-soft text-remote",
          tone === "muted" && "border-hairline bg-raised text-fg-muted",
        )}
      >
        {children}
      </span>
    </Tooltip>
  );
}
