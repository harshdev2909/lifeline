import * as RSwitch from "@radix-ui/react-switch";
import * as RSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export function Toggle({
  checked,
  onCheckedChange,
  label,
  hint,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  hint?: string;
  id?: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-4 py-1.5">
      <span className="min-w-0">
        <span className="block text-sm text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-fg-muted">{hint}</span>}
      </span>
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border border-hairline transition-colors duration-150",
          "data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=unchecked]:bg-raised",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        )}
      >
        <RSwitch.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-fg shadow transition-transform duration-150 ease-spring data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-contrast" />
      </RSwitch.Root>
    </label>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
  align = "start",
  side,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  ariaLabel: string;
  className?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
}) {
  return (
    <RSelect.Root value={value} onValueChange={onValueChange}>
      <RSelect.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-9 min-w-0 items-center justify-between gap-2 rounded-lg border border-hairline bg-surface px-3 text-sm text-fg",
          "hover:border-hairline-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 data-[placeholder]:text-fg-muted",
          className,
        )}
      >
        <RSelect.Value className="min-w-0 flex-1 truncate text-left" />
        <RSelect.Icon className="shrink-0">
          <ChevronDown className="h-4 w-4 text-fg-muted" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-h-[min(60vh,22rem)] w-max min-w-[14rem] max-w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-hairline-strong bg-raised shadow-pop data-[state=open]:animate-fade-up"
        >
          <RSelect.Viewport className="max-h-[inherit] overflow-y-auto p-1">
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-start gap-2 rounded-lg py-1.5 pl-8 pr-3 text-sm text-fg outline-none data-[highlighted]:bg-surface data-[state=checked]:text-accent"
              >
                <RSelect.ItemIndicator className="absolute left-2 top-2">
                  <Check className="h-4 w-4" />
                </RSelect.ItemIndicator>
                <span className="min-w-0">
                  <RSelect.ItemText className="whitespace-nowrap">{o.label}</RSelect.ItemText>
                  {o.hint && <span className="mt-0.5 block text-xs text-fg-muted">{o.hint}</span>}
                </span>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

export function FieldRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="min-w-0">
        <span className="block text-sm text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-fg-muted">{hint}</span>}
      </span>
      {children}
    </div>
  );
}
