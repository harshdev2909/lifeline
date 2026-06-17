import { ImageIcon, Mic, ScanText } from "lucide-react";

import type { UserMsg } from "../../state/types";

const ICON = { image: ImageIcon, ocr: ScanText, audio: Mic } as const;

export function UserMessage({ m }: { m: UserMsg }) {
  const text = m.transcript ?? m.text;
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-1.5">
        {m.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {m.attachments.map((att, i) => {
              const Icon = ICON[att.kind];
              return (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-2 py-1 text-2xs text-fg-muted">
                  <Icon className="h-3 w-3" aria-hidden />
                  {att.name}
                </span>
              );
            })}
          </div>
        )}
        {text && (
          <div className="rounded-2xl rounded-tr-md border border-hairline bg-raised px-3.5 py-2.5 text-[0.95rem] leading-relaxed text-fg">
            {m.transcript && <Mic className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px text-accent" aria-hidden />}
            {text}
          </div>
        )}
      </div>
    </div>
  );
}
