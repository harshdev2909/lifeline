import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Cpu, RefreshCw, Radio, Server } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { shortKey } from "../../lib/format";
import type { MeshPeer, MeshSnapshot } from "../../lib/protocol";
import { useBridge } from "../../state/bridge";
import { IconButton } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";

const W = 320;
const H = 300;
const CENTER = { x: W / 2, y: 134 };
const RADIUS = 102;

interface Placed {
  peer: MeshPeer;
  x: number;
  y: number;
}

function placePeers(peers: MeshPeer[]): Placed[] {
  const n = peers.length;
  return peers.map((peer, i) => {
    // Spread around the circle, biased so a lone peer sits to the upper-right.
    const angle = (-Math.PI / 2) + (n === 1 ? Math.PI / 5 : (i / n) * Math.PI * 2) + (n > 1 ? Math.PI / 6 : 0);
    return { peer, x: CENTER.x + Math.cos(angle) * RADIUS, y: CENTER.y + Math.sin(angle) * RADIUS };
  });
}

interface Travel {
  id: number;
  to: { x: number; y: number };
  mode: "delegate" | "fallback";
}

export function MeshVisualizer({ compact }: { compact?: boolean }) {
  const { mesh, meshPulse, lastDelegation, exchanges, refreshMesh } = useBridge();
  const reduce = useReducedMotion();
  const [probing, setProbing] = useState(false);
  const [travel, setTravel] = useState<Travel | null>(null);
  const seenPulse = useRef(0);

  const placed = useMemo(() => placePeers(mesh?.peers ?? []), [mesh?.peers]);

  // When a real delegation/fallback occurs, fire the travelling pulse to that peer.
  useEffect(() => {
    if (!mesh || meshPulse === seenPulse.current || !lastDelegation) return;
    seenPulse.current = meshPulse;
    const target = placed.find((p) => p.peer.key === lastDelegation.peerKey) ?? placed[0];
    if (!target) return;
    setTravel({ id: meshPulse, to: { x: target.x, y: target.y }, mode: lastDelegation.fallback ? "fallback" : "delegate" });
  }, [meshPulse, lastDelegation, placed, mesh]);

  const activeKey = exchanges.find((ex) => ex.assistant.status === "streaming")?.assistant.servedBy?.peerKey;

  async function probe() {
    setProbing(true);
    try {
      await refreshMesh();
    } finally {
      setProbing(false);
    }
  }

  if (!mesh) return <MeshSkeleton compact={compact} />;

  return (
    <section className={cn("flex flex-col", compact ? "" : "h-full")} aria-label="Device mesh">
      <header className="flex items-center justify-between gap-2 px-1 pb-2">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-fg-muted" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tightish text-fg">Device mesh</h2>
        </div>
        <Tooltip content="Heartbeat each peer for live status">
          <IconButton label="Probe peers" onClick={probe} disabled={probing}>
            <RefreshCw className={cn("h-4 w-4", probing && "animate-spin")} />
          </IconButton>
        </Tooltip>
      </header>

      <div className="relative rounded-xl border border-hairline bg-base bg-grid">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={describeMesh(mesh)}>
          {/* Edges. */}
          {placed.map((p) => {
            const active = p.peer.key === activeKey;
            return (
              <line
                key={`e-${p.peer.key}`}
                x1={CENTER.x}
                y1={CENTER.y}
                x2={p.x}
                y2={p.y}
                stroke={active ? "var(--remote)" : "var(--border-strong)"}
                strokeWidth={active ? 1.6 : 1}
                strokeDasharray={p.peer.status === "live" || active ? undefined : "3 4"}
                className="transition-[stroke] duration-300"
              />
            );
          })}

          {/* Travelling request/response pulse — real delegation/fallback. */}
          <AnimatePresence>
            {travel && !reduce && (
              <TravelPulse
                key={travel.id}
                from={CENTER}
                to={travel.to}
                mode={travel.mode}
                onDone={() => setTravel(null)}
              />
            )}
          </AnimatePresence>

          {/* Peer nodes. */}
          {placed.map((p) => (
            <Node key={p.peer.key} x={p.x} y={p.y} kind="peer" peer={p.peer} active={p.peer.key === activeKey} reduce={reduce} />
          ))}

          {/* Self node (always on top, centered). */}
          <Node
            x={CENTER.x}
            y={CENTER.y}
            kind="self"
            label={mesh.self.label}
            sub={mesh.self.model}
            meta={`${mesh.self.platform} · ${mesh.self.accel}`}
            status="active"
            reduce={reduce}
            fallback={reduce ? false : travel?.mode === "fallback"}
          />
        </svg>
      </div>

      <MeshLegend mesh={mesh} lastDelegation={lastDelegation} />
    </section>
  );
}

function Node({
  x,
  y,
  kind,
  peer,
  label,
  sub,
  meta,
  status,
  active,
  reduce,
  fallback,
}: {
  x: number;
  y: number;
  kind: "self" | "peer";
  peer?: MeshPeer;
  label?: string;
  sub?: string;
  meta?: string;
  status?: MeshPeer["status"];
  active?: boolean;
  reduce?: boolean | null;
  fallback?: boolean;
}) {
  const st = peer?.status ?? status ?? "unknown";
  const name = peer?.label ?? label ?? "";
  const model = peer?.model ?? sub ?? "";
  const role = peer?.role ?? (kind === "self" ? "this device" : undefined);
  const r = kind === "self" ? 24 : 19;
  const color =
    fallback ? "var(--emergency)" : active || st === "active" || (kind === "self") ? (kind === "self" ? "var(--local)" : "var(--remote)") : st === "live" ? "var(--accent)" : st === "down" ? "var(--emergency)" : "var(--text-tertiary)";
  const breathe = !reduce && (st === "live" || st === "active" || kind === "self");

  const Icon = kind === "self" ? Cpu : Server;

  return (
    <g>
      {/* Breathing halo. */}
      {breathe && (
        <circle cx={x} cy={y} r={r + 6} fill={color} opacity={0.14} className="animate-breathe" style={{ transformOrigin: `${x}px ${y}px` }} />
      )}
      <circle cx={x} cy={y} r={r} fill="var(--bg-surface)" stroke={color} strokeWidth={active || kind === "self" ? 2 : 1.4} className="transition-[stroke] duration-300" />
      <foreignObject x={x - r} y={y - r} width={r * 2} height={r * 2}>
        <div className="flex h-full w-full items-center justify-center" style={{ color }}>
          <Icon style={{ width: kind === "self" ? 18 : 15, height: kind === "self" ? 18 : 15 }} aria-hidden />
        </div>
      </foreignObject>

      {/* Status dot for peers. */}
      {kind === "peer" && (
        <circle cx={x + r - 3} cy={y - r + 3} r={3.2} fill={st === "live" ? "var(--accent)" : st === "down" ? "var(--emergency)" : "var(--text-tertiary)"} stroke="var(--bg-base)" strokeWidth={1.4} />
      )}

      {/* Label stack — name, then role/model/meta, each on its own line. */}
      <text x={x} y={y + r + 13} textAnchor="middle" className="fill-[var(--text-primary)] text-[10px] font-medium" style={{ fontFamily: "Geist Sans, sans-serif" }}>
        {truncate(name, 16)}
      </text>
      {[role, model && truncate(model, 22), kind === "self" ? meta && truncate(meta, 24) : undefined]
        .filter((line): line is string => Boolean(line))
        .map((line, i) => (
          <text
            key={i}
            x={x}
            y={y + r + 24 + i * 10}
            textAnchor="middle"
            className={i === 0 && role ? "fill-[var(--text-tertiary)] text-[8px]" : "fill-[var(--text-secondary)] text-[8px]"}
            style={{ fontFamily: "Geist Mono, monospace" }}
          >
            {line}
          </text>
        ))}
    </g>
  );
}

function TravelPulse({ from, to, mode, onDone }: { from: { x: number; y: number }; to: { x: number; y: number }; mode: "delegate" | "fallback"; onDone: () => void }) {
  // delegate: request out then response back (out-and-return).
  // fallback: request out, then it returns red (rerouted home).
  const color = mode === "fallback" ? "var(--emergency)" : "var(--accent)";
  return (
    <motion.circle
      r={4}
      fill={color}
      initial={{ cx: from.x, cy: from.y, opacity: 0 }}
      animate={{
        cx: [from.x, to.x, from.x],
        cy: [from.y, to.y, from.y],
        opacity: [0, 1, 1, 1],
      }}
      transition={{ duration: 1.4, ease: "easeInOut", times: [0, 0.5, 1] }}
      onAnimationComplete={onDone}
      style={{ filter: "drop-shadow(0 0 4px " + color + ")" }}
    />
  );
}

function MeshLegend({ mesh, lastDelegation }: { mesh: MeshSnapshot; lastDelegation?: { servedBy: string; fallback?: boolean; peerKey?: string } }) {
  const live = mesh.peers.filter((p) => p.status === "live").length;
  return (
    <div className="mt-2.5 space-y-2 px-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs text-fg-faint">
        <span className="inline-flex items-center gap-1">
          <Dot c="var(--accent)" /> live
        </span>
        <span className="inline-flex items-center gap-1">
          <Dot c="var(--remote)" /> serving
        </span>
        <span className="inline-flex items-center gap-1">
          <Dot c="var(--emergency)" /> down
        </span>
        <span className="inline-flex items-center gap-1">
          <Dot c="var(--text-tertiary)" /> unknown
        </span>
      </div>
      {mesh.peers.length === 0 ? (
        <p className="text-xs leading-relaxed text-fg-muted">
          No peers configured. Add one in Settings (a shared topic or a peer key) to delegate heavy models to another device — answers still fall back here if it's unreachable.
        </p>
      ) : (
        <p className="font-mono text-2xs text-fg-muted">
          {mesh.peers.length} peer{mesh.peers.length > 1 ? "s" : ""} · {live} live
          {lastDelegation && (
            <>
              {" · "}
              {lastDelegation.fallback ? "last: rerouted home" : lastDelegation.servedBy === "remote" ? `last: ${shortKey(lastDelegation.peerKey)}` : "last: local"}
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />;
}

function MeshSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-hairline bg-base", compact ? "h-48" : "h-full min-h-[300px]")}>
      <div className="flex h-full items-center justify-center text-xs text-fg-faint">connecting to the mesh…</div>
    </div>
  );
}

function describeMesh(mesh: MeshSnapshot): string {
  const peers = mesh.peers.map((p) => `${p.label} (${p.status})`).join(", ");
  return `This device ${mesh.self.label} running ${mesh.self.model}. ${mesh.peers.length ? `Peers: ${peers}.` : "No peers configured."}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
