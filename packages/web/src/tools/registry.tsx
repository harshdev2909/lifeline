/**
 * registry.tsx — the medic's toolset.
 *
 * Every QVAC capability Lifeline exposes is a tool here, named for its field use
 * case (not the raw capability name), and grouped the way a medic reaches for
 * them: Converse, See, Read & Translate, Listen & Speak, Knowledge, Adapt,
 * Network. The tool rail and the active-tool view both read this list, so giving
 * a capability a home is a single entry. Groups with no tools yet are simply not
 * shown — the rail fills in as capabilities land, never with placeholders.
 */
import type { ComponentType } from "react";

import { MessagesSquare, Radio, ScanText } from "lucide-react";

import { Conversation } from "../components/conversation/Conversation";
import { OcrTool } from "../components/tools/OcrTool";
import { NetworkTool } from "../components/workspace/NetworkTool";

export type ToolGroupId = "converse" | "see" | "read" | "listen" | "knowledge" | "adapt" | "network";

/** Display order of the groups in the rail. */
export const TOOL_GROUPS: { id: ToolGroupId; label: string }[] = [
  { id: "converse", label: "Converse" },
  { id: "see", label: "See" },
  { id: "read", label: "Read & Translate" },
  { id: "listen", label: "Listen & Speak" },
  { id: "knowledge", label: "Knowledge" },
  { id: "adapt", label: "Adapt" },
  { id: "network", label: "Network" },
];

export interface ToolDef {
  id: string;
  group: ToolGroupId;
  /** Field name the medic sees in the rail. */
  label: string;
  /** The real field use case, one line — the tool's subtitle and rail tooltip. */
  blurb: string;
  icon: ComponentType<{ className?: string }>;
  Component: ComponentType;
  /** Full-bleed tools own their own scroll/layout (Converse, Network). Capability
   *  tools instead share the consistent ToolLayout shell. */
  bleed?: boolean;
}

export const TOOLS: ToolDef[] = [
  {
    id: "converse",
    group: "converse",
    label: "Triage chat",
    blurb: "Grounded first-aid Q&A — cited from the manual, with voice and translation",
    icon: MessagesSquare,
    Component: Conversation,
    bleed: true,
  },
  {
    id: "ocr",
    group: "read",
    label: "Read text",
    blurb: "Photograph a label or note — read the printed text on-device",
    icon: ScanText,
    Component: OcrTool,
  },
  {
    id: "network",
    group: "network",
    label: "Device mesh",
    blurb: "Offload inference to a peer device and watch routing decide live",
    icon: Radio,
    Component: NetworkTool,
    bleed: true,
  },
];

export const DEFAULT_TOOL = TOOLS[0].id;

export function toolById(id: string): ToolDef {
  return TOOLS.find((t) => t.id === id) ?? TOOLS[0];
}
