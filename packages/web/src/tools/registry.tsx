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

import { Clapperboard, Database, Eye, FileText, GraduationCap, Languages, MessagesSquare, Mic, PencilRuler, Radio, ScanSearch, ScanText, Search, Volume2 } from "lucide-react";

import { Conversation } from "../components/conversation/Conversation";
import { AdaptTool } from "../components/tools/AdaptTool";
import { ClassifyTool } from "../components/tools/ClassifyTool";
import { CorpusTool } from "../components/tools/CorpusTool";
import { IllustrateTool } from "../components/tools/IllustrateTool";
import { VideoTool } from "../components/tools/VideoTool";
import { DictateTool } from "../components/tools/DictateTool";
import { OcrTool } from "../components/tools/OcrTool";
import { SearchTool } from "../components/tools/SearchTool";
import { SoapTool } from "../components/tools/SoapTool";
import { SpeakTool } from "../components/tools/SpeakTool";
import { TranslateTool } from "../components/tools/TranslateTool";
import { VisionTool } from "../components/tools/VisionTool";
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
    id: "soap",
    group: "converse",
    label: "Clinical note",
    blurb: "Turn rough case notes into a SOAP summary or a plain-language explainer",
    icon: FileText,
    Component: SoapTool,
  },
  {
    id: "vision",
    group: "see",
    label: "Analyze a photo",
    blurb: "Describe observable findings in a photo — triage support, not a diagnosis",
    icon: Eye,
    Component: VisionTool,
  },
  {
    id: "classify",
    group: "see",
    label: "Screening aid",
    blurb: "Capture-triage a document, or screen an image against a fixed label set",
    icon: ScanSearch,
    Component: ClassifyTool,
  },
  {
    id: "illustrate",
    group: "see",
    label: "Illustrate",
    blurb: "Generate a simple instructional first-aid diagram — a teaching aid, on-device",
    icon: PencilRuler,
    Component: IllustrateTool,
  },
  {
    id: "video",
    group: "see",
    label: "Animate",
    blurb: "Generate a short instructional motion clip on-device — heavy and slow, a teaching aid",
    icon: Clapperboard,
    Component: VideoTool,
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
    id: "translate",
    group: "read",
    label: "Translate",
    blurb: "Offline two-way translation between English and the patient's language",
    icon: Languages,
    Component: TranslateTool,
  },
  {
    id: "dictate",
    group: "listen",
    label: "Dictate",
    blurb: "Speak a case note or memo and transcribe it on-device",
    icon: Mic,
    Component: DictateTool,
  },
  {
    id: "speak",
    group: "listen",
    label: "Read aloud",
    blurb: "Turn written guidance into speech, generated on-device",
    icon: Volume2,
    Component: SpeakTool,
  },
  {
    id: "search",
    group: "knowledge",
    label: "Search the manual",
    blurb: "Find the right passage by meaning, with source and similarity score",
    icon: Search,
    Component: SearchTool,
  },
  {
    id: "corpus",
    group: "knowledge",
    label: "Knowledge base",
    blurb: "Re-index the manual and inspect the chunks that ground answers",
    icon: Database,
    Component: CorpusTool,
  },
  {
    id: "adapt",
    group: "adapt",
    label: "Adapt the model",
    blurb: "Train a LoRA adapter on a local set, eval it, and see before/after",
    icon: GraduationCap,
    Component: AdaptTool,
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
