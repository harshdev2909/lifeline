import { CircleCheck, HardDrive, Languages, Lock, RadioTower, ShieldAlert } from "lucide-react";

import { useBridge } from "../../state/bridge";
import { Wordmark } from "../brand/Logo";
import { Dialog } from "../ui/Dialog";

export function AboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { device } = useBridge();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="About & safety" wide>
      <div className="space-y-6">
        <div className="space-y-2">
          <Wordmark size={24} />
          <p className="text-sm leading-relaxed text-fg-muted">
            Lifeline answers first-aid questions on-device. Retrieval, reasoning, and safety all run locally; a model can
            optionally be delegated to a nearby peer over an encrypted peer-to-peer link. There is no cloud.
          </p>
        </div>

        <section className="rounded-xl border border-emergency-line bg-emergency-soft px-4 py-3">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-emergency" aria-hidden />
            <div>
              <h3 className="text-sm font-semibold text-emergency">This is triage support, not a diagnosis</h3>
              <p className="mt-1 text-sm leading-relaxed text-fg">
                Lifeline gives first-aid education and triage support. It can be wrong or incomplete. In any emergency,
                call your local emergency number immediately. Emergency-implying questions lead with that, before any guidance.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">How it stays safe</h3>
          <Guarantee icon={CircleCheck} title="Refuses below the grounding threshold">
            Answers cite passages retrieved from the field manual. When the best match scores under a fixed cutoff, it declines rather than guessing.
          </Guarantee>
          <Guarantee icon={Languages} title="Cross-lingual retrieval">
            A question in Spanish or French is translated to the corpus language to retrieve English sources, then answered back in the original language — one language's question, grounded in another's manual.
          </Guarantee>
          <Guarantee icon={Lock} title="Untrusted text is fenced">
            Image, OCR, and retrieved text are treated as data, never instructions; planted prompt-injection is detected and ignored.
          </Guarantee>
          <Guarantee icon={HardDrive} title="On-device & auditable">
            The browser never runs a model — it talks only to a local bridge. Every turn writes an auditable evidence log on disk.
            The network is used only for optional peer discovery, which is fully disclosed.
          </Guarantee>
        </section>

        <section className="space-y-2.5 border-t border-hairline pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">Field readiness &amp; the mesh</h3>
          <Guarantee icon={RadioTower} title="Responder &amp; incident handoff">
            QVAC's peer link carries model inference, not arbitrary messages — so an incoming question to the responder and a case handed to a reviewer are an app-layer protocol over this local bridge (the only network the browser uses). On a multi-node setup they ride the mesh; the heavy model work always delegates over the real encrypted channel.
          </Guarantee>
          <Guarantee icon={CircleCheck} title="Constrained-link mode">
            A resilience mode for a narrow, lossy channel: terse, byte-budgeted answers split into UTF-8-safe chunks with per-chunk retry. Off by default — the link readout shows the bytes, chunks, and retries.
          </Guarantee>
        </section>

        <section className="space-y-2 border-t border-hairline pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">Heavy, and deliberately off</h3>
          <p className="text-sm leading-relaxed text-fg-muted">
            <span className="text-fg">Video generation</span> (Animate) is included but heavy — ~14.5 GB of models and several minutes per
            short clip — so it's labelled clearly and kept opt-in. Two SDK capabilities are left off entirely:
          </p>
          <ul className="space-y-1.5 text-sm leading-relaxed text-fg-muted">
            <li>
              <span className="text-fg">BCI</span> (neural signal → text) — present in <span className="font-mono text-2xs">@qvac/sdk</span> 0.13.3, but it
              needs EEG-class hardware and has no field-medic use case here.
            </li>
            <li>
              <span className="text-fg">VLA</span> (vision-language-action) — present in <span className="font-mono text-2xs">@qvac/sdk</span> 0.13.3, but it
              drives a robot, not a triage workflow.
            </li>
          </ul>
        </section>

        {device && (
          <section className="space-y-2 border-t border-hairline pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">This device</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-2xs text-fg-muted">
              <Row k="cpu" v={device.cpu} />
              <Row k="cores" v={String(device.cores)} />
              <Row k="memory" v={`${device.ramGb} GB`} />
              <Row k="accel" v={device.accel} />
              <Row k="platform" v={`${device.platform}/${device.arch}`} />
              <Row k="runtime" v={`${device.runtime} ${device.nodeVersion}`} />
            </dl>
          </section>
        )}
      </div>
    </Dialog>
  );
}

function Guarantee({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{children}</p>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-hairline pb-1">
      <dt className="text-fg-faint">{k}</dt>
      <dd className="truncate text-fg">{v}</dd>
    </div>
  );
}
