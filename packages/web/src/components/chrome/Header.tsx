import { Info, Menu, Network, Settings } from "lucide-react";

import { Wordmark } from "../brand/Logo";
import { IconButton } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { OfflineIndicator } from "./OfflineIndicator";
import { ThemeToggle } from "./ThemeToggle";

export function Header({
  onMenu,
  onSettings,
  onAbout,
  onMesh,
}: {
  onMenu: () => void;
  onSettings: () => void;
  onAbout: () => void;
  onMesh: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-[color-mix(in_srgb,var(--bg-base)_82%,transparent)] px-3 backdrop-blur sm:gap-3 sm:px-4">
      {/* Phones have no persistent rail — this opens the tool drawer. */}
      <div className="md:hidden">
        <IconButton label="Open tools menu" onClick={onMenu}>
          <Menu className="h-[18px] w-[18px]" />
        </IconButton>
      </div>
      <Wordmark size={24} textClassName="hidden xs:inline" />
      <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
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
