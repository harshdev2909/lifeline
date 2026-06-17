import { AnimatePresence, motion } from "framer-motion";
import { Brain, ChevronRight } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/cn";
import { ms } from "../../lib/format";

/**
 * The reasoning aside — chain-of-thought is shown SEPARATELY from the answer,
 * never inline. While the model reasons it's a calm live indicator; afterwards a
 * quiet collapsible holds the reasoning so it's available without cluttering the
 * answer. Reasoning text is captured by the engine and kept out of the answer.
 */
export function ReasoningAside({ text, active, durationMs }: { text: string; active: boolean; durationMs?: number }) {
  const [open, setOpen] = useState(false);
  if (!text && !active) return null;

  if (active && !text) {
    return (
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <Brain className="h-3.5 w-3.5 text-accent" aria-hidden />
        <span className="animate-pulse">Reasoning…</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-hairline bg-base">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-fg-muted hover:text-fg focus-visible:outline focus-visible:outline-2"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-150", open && "rotate-90")} aria-hidden />
        <Brain className="h-3.5 w-3.5 text-accent" aria-hidden />
        <span className="font-medium">Reasoning</span>
        {active ? (
          <span className="animate-pulse text-accent">· thinking…</span>
        ) : (
          durationMs != null && durationMs > 0 && <span className="font-mono text-2xs text-fg-faint">· {ms(durationMs)}ms, kept out of the answer</span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <p className="whitespace-pre-wrap px-3 pb-3 text-sm leading-relaxed text-fg-muted">{text}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
