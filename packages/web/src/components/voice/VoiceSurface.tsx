import { motion, useReducedMotion } from "framer-motion";
import { Loader2, Mic, X } from "lucide-react";

import { cn } from "../../lib/cn";
import type { VoiceState } from "../../lib/protocol";
import { useBridge } from "../../state/bridge";

/**
 * The live voice surface — a calm turn-taking state machine, not a glowing orb.
 * idle → listening → thinking → speaking → interrupted, each a distinct, quiet
 * treatment. The mic ring scales with the real VAD level; while speaking, a tap
 * (or Space) interrupts. Captions live in the conversation above (the answer text
 * is always shown), so this works with the sound off.
 */
const COPY: Record<VoiceState, { title: string; hint: string }> = {
  idle: { title: "Warming up", hint: "Loading speech models on this device…" },
  listening: { title: "Listening", hint: "Speak naturally — it ends your turn on a pause." },
  thinking: { title: "Thinking", hint: "Finding grounded guidance…" },
  speaking: { title: "Speaking", hint: "Talk over it any time to interrupt." },
  interrupted: { title: "Go ahead", hint: "Listening again." },
};

export function VoiceSurface() {
  const { voice, stopVoice } = useBridge();
  const reduce = useReducedMotion();
  const { state, level, speaking } = voice;
  const copy = COPY[state];
  const accentState = state === "listening" || state === "speaking";

  return (
    <div className="rounded-2xl border border-hairline bg-surface px-4 py-5 shadow-raised">
      <div className="flex items-center gap-4">
        {/* The live indicator. */}
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center" aria-hidden>
          {/* VAD-driven ring (listening), breathing halo (speaking). */}
          {state === "listening" && !reduce && (
            <span
              className="absolute inset-0 rounded-full bg-accent-soft transition-transform duration-100"
              style={{ transform: `scale(${1 + Math.min(0.6, level * 0.9)})`, opacity: 0.35 + Math.min(0.5, level) }}
            />
          )}
          {state === "speaking" && !reduce && <span className="absolute inset-0 animate-breathe rounded-full bg-accent-soft" />}
          {state === "thinking" && <span className="absolute inset-0 animate-pulse rounded-full bg-accent-soft opacity-50" />}
          <span
            className={cn(
              "relative flex h-12 w-12 items-center justify-center rounded-full border",
              accentState ? "border-accent text-accent" : "border-hairline-strong text-fg-muted",
            )}
          >
            {state === "idle" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : state === "speaking" ? (
              <SpeakingBars reduce={Boolean(reduce)} />
            ) : (
              <Mic className={cn("h-5 w-5", state === "listening" && speaking && "text-accent")} />
            )}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("h-1.5 w-1.5 rounded-full", accentState ? "bg-accent" : "bg-fg-faint")} />
            <p className="text-sm font-semibold text-fg" aria-live="polite">
              {copy.title}
            </p>
            <span className="font-mono text-2xs text-fg-faint">· {voice.mode === "live" ? "live · on-device" : "turn-based"}</span>
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">{copy.hint}</p>
          {/* Level meter (real VAD level). */}
          <div className="mt-2 h-1 w-full max-w-48 overflow-hidden rounded-full bg-raised">
            <motion.div
              className="h-full rounded-full bg-accent"
              animate={{ width: `${Math.round(Math.min(1, level) * 100)}%` }}
              transition={{ duration: 0.08 }}
            />
          </div>
        </div>

        <button
          onClick={stopVoice}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-hairline bg-surface px-3 text-sm text-fg-muted hover:border-hairline-strong hover:text-fg focus-visible:outline focus-visible:outline-2"
        >
          <X className="h-4 w-4" /> End voice
        </button>
      </div>
    </div>
  );
}

function SpeakingBars({ reduce }: { reduce: boolean }) {
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="w-0.5 rounded-full bg-accent"
          animate={reduce ? { height: 7 } : { height: [4, 12, 6, 14, 5][i % 5] }}
          transition={reduce ? undefined : { duration: 0.5 + i * 0.12, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
          style={{ height: 7 }}
        />
      ))}
    </span>
  );
}

/** A compact "start live voice" control for the composer toolbar. */
export function VoiceStartButton() {
  const { startVoice, settings, status } = useBridge();
  return (
    <button
      onClick={() =>
        startVoice(
          settings
            ? { model: settings.defaultModel, grounded: settings.grounded, delegate: settings.delegate, lang: settings.lang }
            : { grounded: true },
        )
      }
      disabled={status !== "open"}
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-hairline bg-surface px-3 text-sm text-fg-muted transition-colors hover:border-accent-line hover:text-accent focus-visible:outline focus-visible:outline-2 disabled:opacity-40"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-breathe rounded-full bg-accent opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
      Live voice
    </button>
  );
}
