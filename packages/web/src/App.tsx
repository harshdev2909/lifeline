import { useState } from "react";

import { AboutDialog } from "./components/chrome/AboutDialog";
import { Header } from "./components/chrome/Header";
import { SettingsDialog } from "./components/chrome/SettingsDialog";
import { Conversation } from "./components/conversation/Conversation";
import { MeshVisualizer } from "./components/mesh/MeshVisualizer";
import { Dialog } from "./components/ui/Dialog";

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [meshOpen, setMeshOpen] = useState(false);

  return (
    <div className="flex h-dvh flex-col bg-base text-fg">
      <Header onSettings={() => setSettingsOpen(true)} onAbout={() => setAboutOpen(true)} onMesh={() => setMeshOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          <Conversation />
        </main>

        {/* The mesh visualizer is a persistent showpiece on wide screens. */}
        <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-hairline bg-surface p-4 xl:block">
          <MeshVisualizer />
        </aside>
      </div>

      {/* On narrow screens the mesh opens on demand. */}
      <Dialog open={meshOpen} onOpenChange={setMeshOpen} title="Device mesh">
        <MeshVisualizer compact />
      </Dialog>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </div>
  );
}
