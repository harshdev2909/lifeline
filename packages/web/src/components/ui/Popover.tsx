import * as RP from "@radix-ui/react-popover";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export function Popover({
  trigger,
  children,
  side = "top",
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  side?: RP.PopoverContentProps["side"];
  className?: string;
}) {
  return (
    <RP.Root>
      <RP.Trigger asChild>{trigger}</RP.Trigger>
      <RP.Portal>
        <RP.Content
          side={side}
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            "z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-hairline-strong bg-raised p-3.5 text-sm shadow-pop",
            "focus:outline-none data-[state=open]:animate-fade-up",
            className,
          )}
        >
          {children}
          <RP.Arrow className="fill-[var(--bg-raised)]" />
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
