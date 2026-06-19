import { useState } from "react";

import { AboutDialog } from "./components/chrome/AboutDialog";
import { Header } from "./components/chrome/Header";
import { SettingsDialog } from "./components/chrome/SettingsDialog";
import { MeshVisualizer } from "./components/mesh/MeshVisualizer";
import { ToolDrawer } from "./components/workspace/ToolDrawer";
import { ToolRail } from "./components/workspace/ToolRail";
import { DEFAULT_TOOL, toolById } from "./tools/registry";

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [tool, setTool] = useState<string>(DEFAULT_TOOL);

  const active = toolById(tool);
  const ActiveTool = active.Component;

  return (
    <div className="flex h-dvh flex-col bg-base text-fg">
      <Header
        onMenu={() => setNavOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onAbout={() => setAboutOpen(true)}
        onMesh={() => setTool("network")}
      />

      <div className="flex min-h-0 flex-1">
        {/* Persistent labelled rail from md up; on phones the same tools live in
            the ToolDrawer, opened from the header's menu button. */}
        <ToolRail active={tool} onSelect={setTool} />

        <main className="min-w-0 flex-1">
          <ActiveTool />
        </main>

        {/* On the conversation, the mesh stays a persistent live showpiece on wide
            screens. Narrower screens reach it via the Network tool. */}
        {active.id === "converse" && (
          <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-hairline bg-surface p-4 xl:block">
            <MeshVisualizer />
          </aside>
        )}
      </div>

      <ToolDrawer open={navOpen} onOpenChange={setNavOpen} active={tool} onSelect={setTool} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </div>
  );
}
