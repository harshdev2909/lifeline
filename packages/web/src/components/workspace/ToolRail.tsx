/**
 * ToolRail — the left navigation of the medic's tools, grouped by how they're
 * reached. Labelled, with a clear active state; the active tool is marked
 * aria-current. Shown from md up, where there is room for labels (touch tablets
 * included); on phones it is hidden and the same tools live in the ToolDrawer.
 * Motion is colour-only, so it respects reduced-motion.
 */
import { cn } from "../../lib/cn";
import { TOOL_GROUPS, TOOLS, type ToolDef } from "../../tools/registry";
import { Tooltip } from "../ui/Tooltip";

export function ToolRail({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  const groups = TOOL_GROUPS.map((g) => ({ ...g, tools: TOOLS.filter((t) => t.group === g.id) })).filter((g) => g.tools.length > 0);

  return (
    <nav
      aria-label="Tools"
      className="hidden w-52 shrink-0 flex-col gap-3 overflow-y-auto overflow-x-hidden border-r border-hairline bg-surface px-3 py-3 md:flex"
    >
      {groups.map((g) => (
        <div key={g.id} className="flex flex-col gap-0.5">
          <div className="px-2 pb-1 text-2xs font-medium uppercase tracking-wider text-fg-faint">{g.label}</div>
          {g.tools.map((t) => (
            <RailItem key={t.id} tool={t} active={active === t.id} onSelect={onSelect} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function RailItem({ tool, active, onSelect }: { tool: ToolDef; active: boolean; onSelect: (id: string) => void }) {
  const Icon = tool.icon;
  return (
    <Tooltip
      side="right"
      content={
        <div className="max-w-[15rem]">
          <div className="font-medium">{tool.label}</div>
          <div className="text-fg-muted">{tool.blurb}</div>
        </div>
      }
    >
      <button
        type="button"
        onClick={() => onSelect(tool.id)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-10 w-full items-center justify-start gap-2.5 rounded-lg px-2.5 transition-colors duration-150 ease-spring",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
          active ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-raised hover:text-fg",
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span className="min-w-0 truncate text-sm">{tool.label}</span>
      </button>
    </Tooltip>
  );
}
