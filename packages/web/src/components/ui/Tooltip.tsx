import * as RT from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export const TooltipProvider = RT.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
  mono,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: RT.TooltipContentProps["side"];
  mono?: boolean;
}) {
  return (
    <RT.Root delayDuration={250}>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 max-w-xs rounded-lg border border-hairline-strong bg-raised px-2.5 py-1.5 text-xs text-fg shadow-pop",
            "data-[state=delayed-open]:animate-fade-up",
            mono && "font-mono text-2xs",
          )}
        >
          {content}
          <RT.Arrow className="fill-[var(--bg-raised)]" />
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
