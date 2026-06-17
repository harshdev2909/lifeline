import { Info, Network, Settings } from "lucide-react";

import { Wordmark } from "../brand/Logo";
import { IconButton } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { OfflineIndicator } from "./OfflineIndicator";
import { ThemeToggle } from "./ThemeToggle";

export function Header({
  onSettings,
  onAbout,
  onMesh,
}: {
  onSettings: () => void;
  onAbout: () => void;
  onMesh: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-[color-mix(in_srgb,var(--bg-base)_82%,transparent)] px-4 backdrop-blur">
      <Wordmark size={24} />
      <div className="ml-auto flex items-center gap-1.5">
        <OfflineIndicator />
        <div className="mx-1 hidden h-5 w-px bg-hairline sm:block" />
        <div className="xl:hidden">
          <Tooltip content="Device mesh">
            <IconButton label="Device mesh" onClick={onMesh}>
              <Network className="h-[18px] w-[18px]" />
            </IconButton>
          </Tooltip>
        </div>
        <Tooltip content="About & safety">
          <IconButton label="About and safety" onClick={onAbout}>
            <Info className="h-[18px] w-[18px]" />
          </IconButton>
        </Tooltip>
        <Tooltip content="Settings">
          <IconButton label="Settings" onClick={onSettings}>
            <Settings className="h-[18px] w-[18px]" />
          </IconButton>
        </Tooltip>
        <ThemeToggle />
      </div>
    </header>
  );
}
