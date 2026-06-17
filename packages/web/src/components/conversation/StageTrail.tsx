import { BookOpen, Check, Cpu, Eye, Languages, Loader2, Mic, ScanText, Volume2, type LucideIcon } from "lucide-react";

import { cn } from "../../lib/cn";
import type { TurnStage } from "../../lib/protocol";
import type { StageEntry } from "../../state/types";

const META: Record<TurnStage, { icon: LucideIcon; label: string }> = {
  stt: { icon: Mic, label: "Transcribing speech" },
  translate_in: { icon: Languages, label: "Translating to English" },
  vision: { icon: Eye, label: "Describing the image" },
  ocr: { icon: ScanText, label: "Reading printed text" },
  retrieval: { icon: BookOpen, label: "Searching the field manual" },
  load: { icon: Cpu, label: "Loading the model" },
  translate_out: { icon: Languages, label: "Translating the answer" },
  tts: { icon: Volume2, label: "Synthesizing speech" },
};

/** The live on-device pipeline — each stage runs locally (or on a peer for vision/load). */
export function StageTrail({ stages }: { stages: StageEntry[] }) {
  if (!stages.length) return null;
  return (
    <ul className="space-y-1.5">
      {stages.map((s) => {
        const meta = META[s.stage];
        const Icon = meta.icon;
        const done = s.status === "done";
        return (
          <li key={s.stage} className="flex items-center gap-2.5 text-xs">
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                done ? "border-accent-line bg-accent-soft text-accent" : "border-hairline bg-raised text-fg-muted",
              )}
            >
              {done ? <Check className="h-3 w-3" aria-hidden /> : <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            </span>
            <Icon className="h-3.5 w-3.5 text-fg-faint" aria-hidden />
            <span className={cn(done ? "text-fg-muted" : "text-fg")}>{meta.label}</span>
            {s.detail && <span className="truncate font-mono text-2xs text-fg-faint">· {s.detail}</span>}
            {s.servedBy === "remote" && <span className="font-mono text-2xs text-remote">· peer</span>}
            {done && s.ms != null && <span className="ml-auto shrink-0 font-mono text-2xs text-fg-faint">{s.ms}ms</span>}
          </li>
        );
      })}
    </ul>
  );
}
