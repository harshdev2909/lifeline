import { Check, ClipboardList, Copy, Cpu, Loader2, Plus, Radio, Server, Trash2, Wifi } from "lucide-react";
import { useState } from "react";

import { putSettings, startProvider, stopProvider } from "../../lib/api";
import { cn } from "../../lib/cn";
import { ms, shortKey, toks } from "../../lib/format";
import type { MeshPeer, ModelKey } from "../../lib/protocol";
import { useBridge } from "../../state/bridge";
import { Select } from "../ui/Field";

const inputCls =
  "h-8 w-full rounded-lg border border-hairline bg-base px-2.5 text-sm text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2";

export function MeshControls() {
  const { mesh, settings, models, applySettings, refreshMesh } = useBridge();
  const [serveTopic, setServeTopic] = useState("");
  const [serveModel, setServeModel] = useState<ModelKey>("medgemma4b");
  const [serveBusy, setServeBusy] = useState(false);
  const [peerLabel, setPeerLabel] = useState("");
  const [peerRef, setPeerRef] = useState("");
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!mesh || !settings) return null;
  const self = mesh.self;

  async function saveSettings(patch: Parameters<typeof putSettings>[0]) {
    setErr(null);
    try {
      applySettings(await putSettings(patch));
      await refreshMesh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function toggleServe() {
    setServeBusy(true);
    setErr(null);
    try {
      if (self.serving) {
        await stopProvider();
      } else {
        const topic = serveTopic.trim() || "lifeline";
        const r = await startProvider(topic, serveModel);
        if (r.error) setErr(r.error);
      }
      await refreshMesh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Provider error");
    } finally {
      setServeBusy(false);
    }
  }

  function addPeer() {
    const ref = peerRef.trim();
    if (!ref) return;
    void saveSettings({ peers: [...settings!.peers, { label: peerLabel.trim(), ref } as never] });
    setPeerLabel("");
    setPeerRef("");
  }

  function removePeer(key: string) {
    void saveSettings({ peers: settings!.peers.filter((p) => p.key !== key) });
  }

  function copyKey() {
    if (!self.publicKey) return;
    void navigator.clipboard?.writeText(self.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="mt-4 space-y-4 border-t border-hairline pt-4">
      {err && <p className="text-xs text-emergency">{err}</p>}

      {/* Routing policy — the real local-vs-delegate control. */}
      <Section icon={Wifi} title="Routing">
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-hairline p-1">
          <PolicyButton active={!settings.delegate} onClick={() => saveSettings({ delegate: false })} icon={Cpu} label="This device" />
          <PolicyButton active={settings.delegate} onClick={() => saveSettings({ delegate: true })} icon={Radio} label="Delegate" tone="remote" />
        </div>
        <p className="mt-1.5 text-2xs text-fg-faint">
          {settings.delegate
            ? "Turns try a live peer first and fall back to this device automatically."
            : "Every turn runs on this device."}
        </p>
      </Section>

      {/* This device — identity + serve toggle (bidirectional mesh). */}
      <Section icon={Server} title="This device">
        <button
          onClick={toggleServe}
          disabled={serveBusy}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50",
            self.serving ? "border-accent-line bg-accent-soft text-accent" : "border-hairline bg-surface text-fg hover:border-hairline-strong",
          )}
        >
          <span className="inline-flex items-center gap-2">
            {serveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
            {self.serving ? "Serving to peers" : "Serve a model to peers"}
          </span>
          <span className="font-mono text-2xs text-fg-faint">{self.serving ? "stop" : "start"}</span>
        </button>

        {self.serving ? (
          <div className="mt-2 space-y-1.5">
            <Row k="topic" v={self.serveTopic ?? "—"} />
            <Row k="model" v={self.serveModel ?? "—"} />
            <button onClick={copyKey} className="flex w-full items-center gap-2 rounded-lg border border-hairline bg-base px-2.5 py-1.5 text-left hover:border-hairline-strong">
              <span className="min-w-0 flex-1 truncate font-mono text-2xs text-fg">{self.publicKey}</span>
              {copied ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-fg-faint" />}
            </button>
            <p className="text-2xs text-fg-faint">Peers join with this topic word or key. Discovery uses the DHT; prompts and weights never cross it.</p>
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
            <input className={inputCls} placeholder="serve topic (e.g. clinic)" value={serveTopic} onChange={(e) => setServeTopic(e.target.value)} />
            <Select ariaLabel="Model to serve" value={serveModel} onValueChange={(v) => setServeModel(v as ModelKey)} options={models.map((m) => ({ value: m.key, label: m.label }))} className="h-8" align="end" side="top" />
          </div>
        )}
      </Section>

      {/* Peers — add / remove + real served readouts. */}
      <Section icon={Radio} title={`Peers (${mesh.peers.length})`}>
        {mesh.peers.length > 0 && (
          <ul className="mb-2 space-y-1.5">
            {mesh.peers.map((p) => (
              <PeerRow key={p.key} peer={p} onRemove={() => removePeer(p.key)} />
            ))}
          </ul>
        )}
        <div className="grid grid-cols-[5.5rem_1fr_auto] gap-1.5">
          <input className={inputCls} placeholder="label" value={peerLabel} onChange={(e) => setPeerLabel(e.target.value)} />
          <input className={inputCls} placeholder="topic or 64-hex key" value={peerRef} onChange={(e) => setPeerRef(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPeer()} />
          <button onClick={addPeer} aria-label="Add peer" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-accent hover:border-accent-line">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </Section>

      {/* Blind relays — relay-assist for delegated links across strict NAT/firewalls. */}
      <Section icon={Radio} title={`Relays (${mesh.relays.count})`}>
        {mesh.relays.count > 0 ? (
          <>
            <ul className="space-y-0.5 font-mono text-2xs text-fg-muted">
              {mesh.relays.keys.map((k) => (
                <li key={k} className="truncate">
                  {shortKey(k)}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-2xs text-fg-faint">
              When a direct peer link can't punch through NAT/firewall, the delegated connection routes through a blind relay. Relay + discovery only — prompts and weights stay end-to-end encrypted.
            </p>
          </>
        ) : (
          <p className="text-2xs text-fg-faint">
            None configured — delegated links use direct Holepunch only. Add relay public keys in Settings to traverse strict NAT/firewalls (applied on restart).
          </p>
        )}
      </Section>

      {/* Case handoffs — incident reports handed to a reviewer (app-layer, bridge-brokered). */}
      {mesh.caseHandoffs && (
        <Section icon={ClipboardList} title="Case handoffs">
          {mesh.caseHandoffs.count > 0 ? (
            <p className="text-2xs text-fg-muted">
              {mesh.caseHandoffs.count} report{mesh.caseHandoffs.count > 1 ? "s" : ""} handed to a reviewer
              {mesh.caseHandoffs.lastTo ? ` · last: ${mesh.caseHandoffs.lastTo}` : ""}
            </p>
          ) : (
            <p className="text-2xs text-fg-faint">No cases handed off yet. Hand one off from Incident reports.</p>
          )}
        </Section>
      )}

      {/* Last routing decision — explainable, from real probe results. */}
      {mesh.lastDecision && (
        <Section icon={Wifi} title="Last route">
          <div className="rounded-lg border border-hairline bg-base p-2.5 font-mono text-2xs text-fg-muted">
            {mesh.lastDecision.candidates.length > 0 ? (
              <ul className="space-y-0.5">
                {mesh.lastDecision.candidates.map((c) => (
                  <li key={c.peerKey} className="flex items-center justify-between gap-2">
                    <span className={c.peerKey === mesh.lastDecision!.chosen ? "text-accent" : ""}>
                      {c.label ?? shortKey(c.peerKey)} {c.ok ? "ok" : "down"}
                    </span>
                    <span className="text-fg-faint">{ms(c.probeMs)}ms</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span>no peers probed</span>
            )}
            <div className={cn("mt-1.5 border-t border-hairline pt-1.5", mesh.lastDecision.servedBy === "remote" ? "text-remote" : "text-local")}>
              → {mesh.lastDecision.servedBy === "remote" ? "served by peer" : "served on this device"}
              {mesh.lastDecision.fallbackReason && <span className="text-fg-faint"> · {mesh.lastDecision.fallbackReason}</span>}
            </div>
            {mesh.lastDecision.servedBy === "remote" && (
              <div className="mt-1 text-fg-faint">path: peer link · relay-assist {mesh.relays.count > 0 ? "on" : "off"}</div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

function PeerRow({ peer, onRemove }: { peer: MeshPeer; onRemove: () => void }) {
  const dot = peer.status === "live" ? "var(--accent)" : peer.status === "down" ? "var(--emergency)" : "var(--text-tertiary)";
  return (
    <li className="rounded-lg border border-hairline px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
        <span className="truncate text-sm text-fg">{peer.label}</span>
        <span className="ml-auto font-mono text-2xs text-fg-faint">{peer.status}{peer.probeMs != null ? ` ${ms(peer.probeMs)}ms` : ""}</span>
        <button onClick={onRemove} aria-label={`Remove ${peer.label}`} className="text-fg-faint hover:text-emergency">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {(peer.role || peer.model) && <div className="mt-0.5 truncate font-mono text-2xs text-fg-faint">{[peer.role, peer.model].filter(Boolean).join(" · ")}</div>}
      {peer.served && (
        <div className="mt-0.5 font-mono text-2xs text-remote">
          {peer.served.turns} served · {toks(peer.served.lastTps)} tok/s · {ms(peer.served.lastTtftMs)}ms ttft
        </div>
      )}
    </li>
  );
}

function PolicyButton({ active, onClick, icon: Icon, label, tone = "accent" }: { active: boolean; onClick: () => void; icon: typeof Cpu; label: string; tone?: "accent" | "remote" }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
        active ? (tone === "remote" ? "bg-remote-soft text-remote" : "bg-accent-soft text-accent") : "text-fg-muted hover:bg-raised",
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Cpu; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-faint">
        <Icon className="h-3 w-3" /> {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2 font-mono text-2xs">
      <span className="text-fg-faint">{k}</span>
      <span className="truncate text-fg">{v}</span>
    </div>
  );
}
