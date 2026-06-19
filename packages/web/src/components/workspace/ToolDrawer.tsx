/**
 * ToolDrawer — the medic's toolset on phones, where the persistent rail would eat
 * the screen. A left slide-over (hamburger in the header opens it) listing every
 * tool with its label and one-line use case, grouped exactly like the rail.
 * Picking a tool selects it and closes the sheet. Accessible via Radix Dialog;
 * only mounts below md, where the rail is hidden.
 */
import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "../../lib/cn";
import { TOOL_GROUPS, TOOLS, type ToolDef } from "../../tools/registry";
import { Wordmark } from "../brand/Logo";

export function ToolDrawer({
  open,
  onOpenChange,
  active,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  active: string;
  onSelect: (id: string) => void;
}) {
  const groups = TOOL_GROUPS.map((g) => ({ ...g, tools: TOOLS.filter((t) => t.group === g.id) })).filter((g) => g.tools.length > 0);

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-overlay-in md:hidden" />
        <RD.Content
          aria-label="Tools"
          className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] flex-col border-r border-hairline bg-surface shadow-pop focus:outline-none data-[state=open]:animate-drawer-in md:hidden"
        >
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3.5">
            <RD.Title className="sr-only">Tools</RD.Title>
            <Wordmark size={22} />
            <RD.Close
              aria-label="Close"
              className="-mr-1 inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2"
            >
              <X className="h-4 w-4" />
            </RD.Close>
          </div>

          <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
            {groups.map((g) => (
              <div key={g.id} className="flex flex-col gap-0.5">
                <div className="px-2 pb-1 text-2xs font-medium uppercase tracking-wider text-fg-faint">{g.label}</div>
                {g.tools.map((t) => (
                  <DrawerItem
                    key={t.id}
                    tool={t}
                    active={active === t.id}
                    onSelect={(id) => {
                      onSelect(id);
                      onOpenChange(false);
                    }}
                  />
                ))}
              </div>
            ))}
          </nav>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

function DrawerItem({ tool, active, onSelect }: { tool: ToolDef; active: boolean; onSelect: (id: string) => void }) {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(tool.id)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        active ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-raised hover:text-fg",
      )}
    >
      <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{tool.label}</span>
        <span className="mt-0.5 block text-2xs leading-snug text-fg-faint">{tool.blurb}</span>
      </span>
    </button>
  );
}
