import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-[fade-up_160ms_ease]" />
        <RD.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col",
            "rounded-2xl border border-hairline bg-surface shadow-pop focus:outline-none data-[state=open]:animate-fade-up",
            wide ? "max-w-2xl" : "max-w-lg",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
            <div>
              <RD.Title className="text-lg font-semibold tracking-tightish">{title}</RD.Title>
              {description && <RD.Description className="mt-0.5 text-sm text-fg-muted">{description}</RD.Description>}
            </div>
            <RD.Close
              className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </RD.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
