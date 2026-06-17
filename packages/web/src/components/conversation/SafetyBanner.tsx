import { AlertTriangle, ShieldQuestion } from "lucide-react";

/**
 * Designed safety moments. On a red flag the UI shifts to calm-urgent: the
 * reserved red, the "seek emergency care now" lead surfaced first, above the
 * guidance. An ungrounded refusal is a distinct, honest treatment — the tool
 * declines rather than inventing guidance.
 */
export function EmergencyBanner({ notice, terms }: { notice: string; terms: string[] }) {
  return (
    <div role="alert" className="overflow-hidden rounded-xl border border-emergency-line bg-emergency-soft">
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emergency text-emergency-contrast">
          <AlertTriangle className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emergency">Seek emergency care now</p>
          <p className="mt-1 text-sm leading-relaxed text-fg">{notice}</p>
          {terms.length > 0 && (
            <p className="mt-2 font-mono text-2xs text-emergency">
              detected: {terms.join(" · ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function RefusalBlock({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-hairline bg-raised px-4 py-3">
      <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted" aria-hidden />
      <div>
        <p className="text-sm font-medium text-fg">No grounded guidance found</p>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">{text}</p>
      </div>
    </div>
  );
}
