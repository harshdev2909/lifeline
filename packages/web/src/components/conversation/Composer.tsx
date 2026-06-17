import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { BookOpen, Eye, ImagePlus, Mic, Radio, ScanText, Send, Square, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { uploadFile } from "../../lib/api";
import type { Lang, ModelKey, TurnAttachment } from "../../lib/protocol";
import { startRecording, type Recorder } from "../../lib/recorder";
import { useBridge } from "../../state/bridge";
import { IconButton } from "../ui/Button";
import { Select } from "../ui/Field";
import { Tooltip } from "../ui/Tooltip";

interface Pending extends TurnAttachment {
  name: string;
}

const LANGS: { value: Lang; label: string }[] = [
  { value: "", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
];

export function Composer() {
  const { settings, models, mesh, busy, sendTurn, cancel, exchanges } = useBridge();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Pending[]>([]);
  const [model, setModel] = useState<ModelKey>("medgemma4b");
  const [lang, setLang] = useState<Lang>("");
  const [grounded, setGrounded] = useState(true);
  const [delegate, setDelegate] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<"image" | "ocr">("image");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Seed per-turn options from saved settings once they arrive.
  useEffect(() => {
    if (!settings) return;
    setModel(settings.defaultModel);
    setLang(settings.lang);
    setGrounded(settings.grounded);
    setDelegate(settings.delegate);
    setSpeak(settings.speak);
  }, [settings]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [text]);

  const hasPeers = (mesh?.peers.length ?? 0) > 0;
  const activeTurn = exchanges.find((ex) => ex.assistant.status === "pending" || ex.assistant.status === "streaming");
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !busy && !uploading;

  function submit(extra?: Pending[]) {
    const atts = [...attachments, ...(extra ?? [])];
    const prompt = text.trim();
    if (!prompt && atts.length === 0) return;
    sendTurn({
      prompt,
      attachments: atts.map((a) => ({ kind: a.kind, id: a.id, name: a.name })),
      userAttachments: atts.map((a) => ({ kind: a.kind, name: a.name })),
      options: { model, grounded, delegate: delegate && hasPeers, lang, speak },
    });
    setText("");
    setAttachments([]);
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const r = await uploadFile(pendingKind.current, file, file.name);
      setAttachments((a) => [...a, { kind: r.kind, id: r.id, name: r.name }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function toggleRecording() {
    setError(null);
    if (recorder) {
      const rec = recorder;
      setRecorder(null);
      try {
        const { blob, seconds } = await rec.stop();
        if (seconds < 0.3) return;
        setUploading(true);
        const r = await uploadFile("audio", blob, "voice-note.wav");
        submit([{ kind: "audio", id: r.id, name: `voice note · ${seconds.toFixed(1)}s` }]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Recording failed");
      } finally {
        setUploading(false);
      }
      return;
    }
    try {
      setRecorder(await startRecording());
    } catch {
      setError("Microphone unavailable — check permissions.");
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="px-1 text-xs text-emergency">{error}</p>}

      <div
        className={cn(
          "rounded-2xl border bg-surface shadow-raised transition-colors",
          recorder ? "border-emergency-line" : "border-hairline focus-within:border-hairline-strong",
        )}
      >
        {recorder ? (
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emergency opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emergency" />
            </span>
            <span className="text-sm text-fg">Listening… speak your question</span>
            <button onClick={toggleRecording} className="ml-auto inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover">
              <Square className="h-3.5 w-3.5" aria-hidden /> Stop &amp; ask
            </button>
          </div>
        ) : (
          <>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                {attachments.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-raised px-2 py-1 text-2xs text-fg-muted">
                    {a.kind === "ocr" ? <ScanText className="h-3 w-3" /> : a.kind === "audio" ? <Mic className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {a.name}
                    <button onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${a.name}`} className="text-fg-faint hover:text-fg">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) submit();
                }
              }}
              rows={1}
              placeholder="Describe the situation, or ask a first-aid question…"
              aria-label="Message"
              className="block max-h-[200px] w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-[0.95rem] leading-relaxed text-fg placeholder:text-fg-faint focus:outline-none"
            />

            <div className="flex items-center gap-1 px-2.5 pb-2.5">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <span>
                    <Tooltip content="Attach a photo">
                      <IconButton label="Attach a photo">
                        <ImagePlus className="h-[18px] w-[18px]" />
                      </IconButton>
                    </Tooltip>
                  </span>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content sideOffset={6} className="z-50 w-56 rounded-xl border border-hairline-strong bg-raised p-1 text-sm shadow-pop data-[state=open]:animate-fade-up">
                    <MenuItem icon={Eye} title="Describe a photo" hint="Vision — observable findings" onSelect={() => { pendingKind.current = "image"; fileRef.current?.click(); }} />
                    <MenuItem icon={ScanText} title="Read text from a photo" hint="OCR — a label or sheet" onSelect={() => { pendingKind.current = "ocr"; fileRef.current?.click(); }} />
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>

              <Tooltip content={recorder ? "Stop" : "Ask by voice"}>
                <IconButton label="Ask by voice" onClick={toggleRecording} tone="accent" active={Boolean(recorder)}>
                  <Mic className="h-[18px] w-[18px]" />
                </IconButton>
              </Tooltip>

              <div className="mx-1 h-5 w-px bg-hairline" />

              <Select
                ariaLabel="Answer language"
                value={lang}
                onValueChange={(v) => setLang(v as Lang)}
                options={LANGS}
                className="h-8"
              />

              <Toggle active={grounded} onClick={() => setGrounded((g) => !g)} icon={BookOpen} label="Ground in the field manual" />
              {hasPeers && <Toggle active={delegate} onClick={() => setDelegate((d) => !d)} icon={Radio} label="Delegate to a peer" tone="remote" />}
              <Toggle active={speak} onClick={() => setSpeak((s) => !s)} icon={Volume2} label="Speak the answer" />

              <div className="ml-auto flex items-center gap-2">
                <Select
                  ariaLabel="Model"
                  value={model}
                  onValueChange={(v) => setModel(v as ModelKey)}
                  options={models.map((m) => ({ value: m.key, label: m.label }))}
                  className="h-8 max-w-[12rem]"
                />
                {busy && activeTurn ? (
                  <button onClick={() => cancel(activeTurn.id)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-hairline bg-surface px-3 text-sm text-fg-muted hover:text-fg">
                    <Square className="h-3.5 w-3.5" /> Stop
                  </button>
                ) : (
                  <button
                    onClick={() => submit()}
                    disabled={!canSend}
                    aria-label="Send"
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-contrast shadow-raised transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    Ask <Send className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
    </div>
  );
}

function Toggle({ active, onClick, icon: Icon, label, tone = "accent" }: { active: boolean; onClick: () => void; icon: typeof BookOpen; label: string; tone?: "accent" | "remote" }) {
  return (
    <Tooltip content={`${label}${active ? " · on" : " · off"}`}>
      <button
        onClick={onClick}
        aria-pressed={active}
        aria-label={label}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2",
          active ? (tone === "remote" ? "bg-remote-soft text-remote" : "bg-accent-soft text-accent") : "text-fg-faint hover:bg-raised hover:text-fg-muted",
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
      </button>
    </Tooltip>
  );
}

function MenuItem({ icon: Icon, title, hint, onSelect }: { icon: typeof Eye; title: string; hint: string; onSelect: () => void }) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-fg outline-none data-[highlighted]:bg-surface"
    >
      <Icon className="mt-0.5 h-4 w-4 text-fg-muted" aria-hidden />
      <span>
        <span className="block text-sm">{title}</span>
        <span className="block text-2xs text-fg-faint">{hint}</span>
      </span>
    </DropdownMenu.Item>
  );
}
