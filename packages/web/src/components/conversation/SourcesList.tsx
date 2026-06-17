import { ChevronRight, FileText } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/cn";
import type { SourceChip } from "../../lib/protocol";

/** The full retrieved-sources footer — progressive disclosure beyond the inline chips. */
export function SourcesList({ sources, cited, hallucinated }: { sources: SourceChip[]; cited: string[]; hallucinated: string[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  return (
    <div className="rounded-lg border border-hairline">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-fg-muted hover:text-fg focus-visible:outline focus-visible:outline-2"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-150", open && "rotate-90")} aria-hidden />
        <FileText className="h-3.5 w-3.5 text-fg-faint" aria-hidden />
        <span className="font-medium">
          {sources.length} source{sources.length > 1 ? "s" : ""}
        </span>
        <span className="font-mono text-2xs text-fg-faint">retrieved locally</span>
        {hallucinated.length > 0 && (
          <span className="ml-auto font-mono text-2xs text-emergency">flagged: {hallucinated.join(", ")}</span>
        )}
      </button>
      {open && (
        <ul className="space-y-2 border-t border-hairline px-3 py-2.5">
          {sources.map((s) => (
            <li key={s.tag} className="text-xs">
              <div className="flex items-baseline gap-2">
                <span className={cn("font-mono", cited.includes(s.tag) ? "text-accent" : "text-fg-faint")}>[{s.tag}]</span>
                <span className="text-fg">
                  {s.source} <span className="text-fg-faint">§</span> {s.section}
                </span>
                <span className="ml-auto font-mono text-2xs text-fg-faint">score {s.score.toFixed(2)}</span>
              </div>
              <p className="mt-1 border-l-2 border-hairline-strong pl-2.5 leading-relaxed text-fg-muted">“{s.snippet}…”</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
