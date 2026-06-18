/**
 * ToolBits — the shared vocabulary capability tools compose from, so every tool
 * reads the same: the running/error states, the local-vs-peer run control, the
 * output card, the safety note, and the image/audio pickers.
 */
import { useRef, useState, type ReactNode } from "react";

import { AlertCircle, Cpu, ImageUp, Loader2, Mic, Radio, ShieldPlus, Square, Upload, X, type LucideIcon } from "lucide-react";

import { uploadFile, type UploadResult } from "../../lib/api";
import { cn } from "../../lib/cn";
import { startRecording, type Recorder } from "../../lib/recorder";

export function RunningBar({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-fg-muted">
      <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
      {label || "Working on-device…"}
    </div>
  );
}

/**
 * A labelled progress bar for staged/long tools (image generation, training).
 * With a numeric `value` it fills to that fraction; without one it sweeps an
 * indeterminate bar — honest motion for a run that can't report a percentage,
 * never a fill stuck at zero.
 */
export function ProgressBar({ value, label }: { value?: number; label: string }) {
  const pct = value != null ? Math.round(value * 100) : undefined;
  return (
    <div className="space-y-1.5 rounded-xl border border-hairline bg-surface px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden /> {label}
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-raised"
        role="progressbar"
        aria-label={label}
        aria-valuemin={pct != null ? 0 : undefined}
        aria-valuemax={pct != null ? 100 : undefined}
        aria-valuenow={pct}
      >
        {pct != null ? (
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
        ) : (
          <div className="h-full w-2/5 rounded-full bg-accent animate-indeterminate" />
        )}
      </div>
    </div>
  );
}

export function ErrorBar({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-emergency-line bg-emergency-soft px-3 py-2 text-sm text-emergency">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function DisclaimerNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-fg-faint">
      <ShieldPlus className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/**
 * A neutral notice — information or a caution that is neither an emergency (red)
 * nor about delegation (amber). Same shape as ErrorBar so severity reads from the
 * hue alone, keeping the three state colours meaning exactly one thing each.
 */
export function NoticeBar({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-hairline bg-raised px-3 py-2.5 text-sm text-fg-muted">
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-faint" aria-hidden />}
      <span>{children}</span>
    </div>
  );
}

export function OutputCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface">
      <div className="border-b border-hairline px-4 py-2 text-2xs uppercase tracking-wide text-fg-faint">{title}</div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

/**
 * A boxed mono readout of a run's own metrics (corpus stats, training losses).
 * Same label/value microstructure as the footer telemetry strip, so every
 * number in the app — footer or card — reads identically and stays tabular.
 */
export function MetricStrip({ items }: { items: { k: string; v: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-hairline bg-surface px-4 py-3 font-mono text-2xs text-fg-muted">
      {items.map((m) => (
        <span key={m.k} className="inline-flex items-baseline gap-1">
          <span className="text-fg-faint">{m.k}</span>
          <span className="text-fg">{m.v}</span>
        </span>
      ))}
    </div>
  );
}

export interface SegmentOption {
  value: string;
  label: string;
  icon?: LucideIcon;
  /** Active hue — defaults to the accent. local/remote keep the state-colour meaning. */
  tone?: "accent" | "local" | "remote";
}

/**
 * The one segmented control every tool uses for a small, mutually-exclusive
 * choice (audience, mode, epochs, where-to-run). One set of states and one
 * spacing spec, so a toggle reads the same in every tool.
 */
export function SegmentedControl({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SegmentOption[];
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-hairline" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = o.value === value;
        const tone = o.tone ?? "accent";
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            disabled={disabled}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors duration-150 ease-spring disabled:opacity-45",
              active
                ? tone === "remote"
                  ? "bg-remote-soft text-remote"
                  : tone === "local"
                    ? "bg-local-soft text-local"
                    : "bg-accent-soft text-accent"
                : "text-fg-muted hover:bg-raised hover:text-fg",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Local-vs-peer run control. Heavy tools offer to offload to a mesh peer. */
export function DelegateToggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <SegmentedControl
      ariaLabel="Where to run"
      value={value ? "peer" : "device"}
      onChange={(v) => onChange(v === "peer")}
      disabled={disabled}
      options={[
        { value: "device", label: "On device", icon: Cpu, tone: "local" },
        { value: "peer", label: "Peer", icon: Radio, tone: "remote" },
      ]}
    />
  );
}

/** Click-or-drop image picker; uploads to the bridge and reports the upload + a preview URL. */
export function ImagePicker({
  kind,
  onReady,
  title = "Add a photo",
  hint = "Click to choose, or drop an image here · PNG or JPEG",
}: {
  kind: "image" | "ocr";
  onReady: (up: UploadResult | null, preview: string | null) => void;
  title?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function take(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const preview = URL.createObjectURL(file);
    try {
      const up = await uploadFile(kind, file, file.name);
      onReady(up, preview);
    } catch {
      URL.revokeObjectURL(preview);
      onReady(null, null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center transition-colors",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
          over ? "border-accent-line bg-accent-soft" : "border-hairline-strong bg-surface hover:bg-raised",
        )}
      >
        {busy ? <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden /> : <ImageUp className={cn("h-8 w-8", over ? "text-accent" : "text-fg-faint")} aria-hidden />}
        <div>
          <div className="text-sm font-medium text-fg">{title}</div>
          <div className="mt-1 text-xs text-fg-muted">{hint}</div>
        </div>
      </button>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" className="hidden" onChange={(e) => void take(e.target.files?.[0])} />
    </>
  );
}

/** Record from the mic (16 kHz mono WAV) or upload a clip; reports the upload id + seconds. */
export function AudioPicker({ onReady }: { onReady: (up: UploadResult, seconds?: number) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<Recorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function startRec() {
    setErr(null);
    try {
      recRef.current = await startRecording();
      setRecording(true);
    } catch {
      setErr("Microphone unavailable — check permissions, or upload a clip instead.");
    }
  }

  async function stopRec() {
    const rec = recRef.current;
    if (!rec) return;
    setRecording(false);
    setBusy(true);
    try {
      const { blob, seconds } = await rec.stop();
      const up = await uploadFile("audio", blob, "dictation.wav");
      onReady(up, seconds);
    } catch {
      setErr("Could not capture audio.");
    } finally {
      recRef.current = null;
      setBusy(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const up = await uploadFile("audio", file, file.name);
      onReady(up);
    } catch {
      setErr("Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <button
            type="button"
            onClick={() => void stopRec()}
            className="inline-flex items-center gap-2 rounded-lg border border-emergency-line bg-emergency-soft px-3 py-2 text-sm text-emergency"
          >
            <Square className="h-4 w-4" aria-hidden /> Stop recording
            <span className="ml-1 h-2 w-2 animate-breathe rounded-full bg-emergency" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void startRec()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-fg hover:bg-raised disabled:opacity-45"
          >
            <Mic className="h-4 w-4 text-accent" aria-hidden /> Record
          </button>
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy || recording}
          className="inline-flex items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-fg-muted hover:bg-raised disabled:opacity-45"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />} Upload a clip
        </button>
      </div>
      {err && <p className="text-2xs text-emergency">{err}</p>}
      <input ref={inputRef} type="file" accept="audio/wav,audio/webm,audio/mpeg,audio/mp4,audio/x-m4a" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
    </div>
  );
}

export { X };
