import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { TooltipProvider } from "./components/ui/Tooltip";
import { BridgeProvider } from "./state/bridge";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BridgeProvider>
      <TooltipProvider delayDuration={250} skipDelayDuration={400}>
        <App />
      </TooltipProvider>
    </BridgeProvider>
  </StrictMode>,
);
