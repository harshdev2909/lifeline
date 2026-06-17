import { Fragment, type ReactNode } from "react";

import { cn } from "../../lib/cn";
import type { SourceChip } from "../../lib/protocol";
import { Popover } from "../ui/Popover";

const TAG_RE = /\[(S\d+|IMG|OCR)\]/g;

/** An inline citation chip; click to expand the exact source snippet. */
export function CitationChip({ source }: { source: SourceChip }) {
  return (
    <Popover
      trigger={
        <button
          className="mx-0.5 inline-flex translate-y-[-1px] items-center rounded-md border border-accent-line bg-accent-soft px-1.5 align-baseline font-mono text-[0.7em] font-medium leading-snug text-accent transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2"
          aria-label={`Source ${source.tag}: ${source.source}, ${source.section}`}
        >
          {source.tag}
        </button>
      }
    >
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-2xs text-accent">{source.tag}</span>
          <span className="font-mono text-2xs text-fg-faint">score {source.score.toFixed(2)}</span>
        </div>
        <div className="text-sm font-medium text-fg">
          {source.source} <span className="text-fg-faint">§</span> {source.section}
        </div>
        <p className="border-l-2 border-hairline-strong pl-3 text-sm leading-relaxed text-fg-muted">“{source.snippet}…”</p>
        <p className="text-2xs text-fg-faint">Retrieved locally from the field manual.</p>
      </div>
    </Popover>
  );
}

/** A non-interactive marker for a tag while sources are still loading. */
function PendingTag({ tag }: { tag: string }) {
  return (
    <span className="mx-0.5 inline-flex items-center rounded-md border border-hairline bg-raised px-1.5 align-baseline font-mono text-[0.7em] leading-snug text-fg-faint">
      {tag}
    </span>
  );
}

/**
 * Render answer text with `[S#]`/`[IMG]`/`[OCR]` tags turned into citation chips.
 * Tags with a known source become interactive chips; while streaming (sources not
 * yet delivered) they render as quiet markers.
 */
export function AnswerText({ text, sources, streaming }: { text: string; sources?: SourceChip[]; streaming?: boolean }) {
  const byTag = new Map((sources ?? []).map((s) => [s.tag, s]));
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TAG_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(<Fragment key={`t${i}`}>{text.slice(last, idx)}</Fragment>);
    const tag = m[1];
    const src = byTag.get(tag);
    parts.push(src ? <CitationChip key={`c${i}`} source={src} /> : <PendingTag key={`p${i}`} tag={tag} />);
    last = idx + m[0].length;
    i++;
  }
  if (last < text.length) parts.push(<Fragment key="tail">{text.slice(last)}</Fragment>);

  return (
    <span className={cn("whitespace-pre-wrap")}>
      {parts}
      {streaming && <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-accent align-baseline" aria-hidden />}
    </span>
  );
}
