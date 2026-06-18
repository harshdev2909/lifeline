import type { ReactNode } from "react";

/**
 * ToolLayout — the consistent shell every capability tool sits in: a titled
 * header naming the field use case, then the tool's body in a comfortable
 * reading column. Capability tools compose the rest of the shared vocabulary
 * inside it (run control → output → ToolFooter), so every tool reads the same.
 */
export function ToolLayout({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-reading px-4 py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tightish text-fg">{title}</h1>
          <p className="mt-1 max-w-measure text-pretty text-sm leading-relaxed text-fg-muted">{blurb}</p>
        </header>
        {children}
      </div>
    </div>
  );
}
