import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { putSettings } from "../../lib/api";
import { MODEL_NOTES, type Lang, type ModelKey, type ServerSettings } from "../../lib/protocol";
import { useBridge } from "../../state/bridge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Select, Toggle } from "../ui/Field";

interface PeerRow {
  label: string;
  ref: string;
  role: string;
  model: string;
}

const inputCls =
  "h-9 w-full rounded-lg border border-hairline bg-base px-2.5 text-sm text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { settings, models, applySettings, refreshMesh } = useBridge();
  const [draft, setDraft] = useState<ServerSettings | null>(settings);
  const [peers, setPeers] = useState<PeerRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && settings) {
      setDraft(settings);
      setPeers(settings.peers.map((p) => ({ label: p.label, ref: p.ref, role: p.role ?? "", model: p.model ?? "" })));
      setError(null);
    }
  }, [open, settings]);

  if (!draft) return null;

  const set = <K extends keyof ServerSettings>(k: K, v: ServerSettings[K]) => setDraft({ ...draft, [k]: v });

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const cleaned = peers.filter((p) => p.ref.trim()).map((p) => ({ label: p.label.trim(), ref: p.ref.trim(), role: p.role.trim() || undefined, model: p.model.trim() || undefined }));
      const next = await putSettings({ ...draft, peers: cleaned as ServerSettings["peers"] });
      applySettings(next);
      void refreshMesh();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Defaults for new conversations. Stored on this device."
      wide
      footer={
        <>
          {error && <span className="mr-auto self-center text-xs text-emergency">{error}</span>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-1">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-faint">Answers</h3>
          <div className="flex items-center justify-between gap-4 py-1.5">
            <span className="text-sm text-fg">Default model</span>
            <Select
              ariaLabel="Default model"
              value={draft.defaultModel}
              onValueChange={(v) => set("defaultModel", v as ModelKey)}
              options={models.map((m) => ({ value: m.key, label: m.label, hint: MODEL_NOTES[m.key] }))}
              className="min-w-[14rem]"
            />
          </div>
          <div className="flex items-center justify-between gap-4 py-1.5">
            <span className="text-sm text-fg">Default language</span>
            <Select
              ariaLabel="Default language"
              value={draft.lang}
              onValueChange={(v) => set("lang", v as Lang)}
              options={[
                { value: "", label: "English" },
                { value: "es", label: "Español (round-trip)" },
                { value: "fr", label: "Français (round-trip)" },
              ]}
              className="min-w-[14rem]"
            />
          </div>
          <Toggle label="Ground answers in the field manual" hint="Retrieve passages, cite sources, and refuse when nothing relevant is found." checked={draft.grounded} onCheckedChange={(v) => set("grounded", v)} />
          <Toggle label="Speak answers aloud" hint="Synthesize each answer to speech on-device." checked={draft.speak} onCheckedChange={(v) => set("speak", v)} />
        </section>

        <section className="space-y-2 border-t border-hairline pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">Mesh peers</h3>
            <button onClick={() => setPeers((p) => [...p, { label: "", ref: "", role: "", model: "" }])} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              <Plus className="h-3.5 w-3.5" /> Add peer
            </button>
          </div>
          <Toggle label="Delegate to a peer by default" hint="Offload completion to a peer when one is configured; always falls back to this device." checked={draft.delegate} onCheckedChange={(v) => set("delegate", v)} />

          {peers.length === 0 ? (
            <p className="rounded-lg border border-dashed border-hairline px-3 py-3 text-xs text-fg-muted">
              No peers yet. A peer is another device running <span className="font-mono">lifeline serve</span>. Identify it by a shared topic word (both sides type the same) or by its public key.
            </p>
          ) : (
            <div className="space-y-2">
              {peers.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-lg border border-hairline p-2">
                  <input className={inputCls} placeholder="label (e.g. laptop)" value={p.label} onChange={(e) => updateRow(setPeers, i, { label: e.target.value })} />
                  <input className={inputCls} placeholder="topic or 64-hex key" value={p.ref} onChange={(e) => updateRow(setPeers, i, { ref: e.target.value })} />
                  <button onClick={() => setPeers((x) => x.filter((_, j) => j !== i))} aria-label="Remove peer" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg-faint hover:bg-raised hover:text-emergency">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <input className={inputCls} placeholder="role (e.g. Raspberry Pi)" value={p.role} onChange={(e) => updateRow(setPeers, i, { role: e.target.value })} />
                  <input className={inputCls} placeholder="model (e.g. MedGemma 4B)" value={p.model} onChange={(e) => updateRow(setPeers, i, { model: e.target.value })} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2 border-t border-hairline pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">Blind relays</h3>
          <p className="text-2xs text-fg-muted">
            Hyperswarm relay public keys (one 64-hex key per line). They help a delegated link reach a peer through strict
            NAT/firewalls — relay and discovery only, never your prompts or weights. Applied on restart.
          </p>
          <textarea
            className="h-24 w-full rounded-lg border border-hairline bg-base px-2.5 py-2 font-mono text-xs text-fg placeholder:text-fg-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            placeholder="0000000000000000000000000000000000000000000000000000000000000001"
            value={(draft.relays ?? []).join("\n")}
            onChange={(e) => set("relays", e.target.value.split(/\s+/).map((s) => s.trim()).filter(Boolean))}
          />
        </section>
      </div>
    </Dialog>
  );
}

function updateRow(setPeers: React.Dispatch<React.SetStateAction<PeerRow[]>>, i: number, patch: Partial<PeerRow>) {
  setPeers((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
}
